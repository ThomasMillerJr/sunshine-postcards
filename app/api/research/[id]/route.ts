import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, researchResults } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = "caffein.dev/ebay-sold-listings";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// --- Types ---

interface ScoredComp {
  title: string;
  soldPrice: number;
  totalPrice: number;
  shippingPrice: number;
  url: string | null;
  endedAt: string | null;
  relevance: number; // 0-10
  matchReason: string;
}

interface PricingResult {
  verdict: "common" | "moderate" | "collector" | "unknown";
  verdictLabel: string;
  quick: number;
  recommended: number;
  collector: number;
  reasoning: string;
  bestCompMatch: string | null;
}

// --- Tiered Query Builder ---

function buildTieredQueries(
  postcard: { title: string; era: string; locationDepicted: string | null; category: string; publisher: string | null },
  ai: Record<string, unknown> | null
): string[] {
  const queries: string[] = [];
  const c = ai?.classification as Record<string, unknown> | undefined;

  if (c) {
    const cardType = c.card_type as { value?: string } | undefined;
    const loc = c.location as { city?: string; state?: string; specific_place?: string } | undefined;
    const pub = c.publisher as { name?: string; card_number?: string } | undefined;
    const subject = c.primary_subject as string | undefined;
    const tags = c.subject_tags as string[] | undefined;
    const era = c.era as { date_range?: string } | undefined;

    const typeStr = cardType?.value?.replace(/_/g, " ") || "";
    const isUncertain = typeStr.startsWith("UNCERTAIN") || typeStr.startsWith("Cannot");

    // Tier 1: Most specific — publisher + card number + location, or exact subject + location
    const t1Parts: string[] = [];
    if (pub?.name) t1Parts.push(pub.name);
    if (pub?.card_number) t1Parts.push(pub.card_number);
    if (loc?.specific_place) t1Parts.push(loc.specific_place);
    else if (loc?.city) t1Parts.push(loc.city);
    if (loc?.state) t1Parts.push(loc.state);
    if (!isUncertain && typeStr) t1Parts.push(typeStr);
    if (subject) {
      const cleaned = subject.replace(/postcard|featuring|multiple|various|showing/gi, "").trim().split(/\s+/).slice(0, 4).join(" ");
      if (cleaned) t1Parts.push(cleaned);
    }
    if (t1Parts.length >= 2) {
      queries.push("vintage postcard " + t1Parts.join(" "));
    }

    // Tier 2: Card type + location + broad subject
    const t2Parts: string[] = [];
    if (!isUncertain && typeStr) t2Parts.push(typeStr);
    if (loc?.state) t2Parts.push(loc.state);
    if (loc?.city) t2Parts.push(loc.city);
    if (tags && tags.length > 0) {
      const specific = tags.filter((t) => !["exterior", "landscape", "nature", "horizontal", "vertical"].includes(t));
      t2Parts.push(specific.slice(0, 2).join(" "));
    }
    if (t2Parts.length >= 2) {
      queries.push("vintage postcard " + t2Parts.join(" "));
    }

    // Tier 3: Broadest — card type + era + general category
    const t3Parts: string[] = [];
    if (!isUncertain && typeStr) t3Parts.push(typeStr);
    if (era?.date_range) t3Parts.push(era.date_range);
    if (tags && tags.length > 0) t3Parts.push(tags[0]);
    if (t3Parts.length >= 2) {
      queries.push("vintage postcard " + t3Parts.join(" "));
    }
  }

  // Fallback if AI didn't produce enough queries
  if (queries.length === 0) {
    const parts = ["vintage postcard"];
    if (postcard.locationDepicted) parts.push(postcard.locationDepicted);
    else if (postcard.title) {
      const cleaned = postcard.title.replace(/postcard|vintage|antique|greetings from/gi, "").trim();
      if (cleaned) parts.push(cleaned);
    }
    if (postcard.era) parts.push(postcard.era);
    queries.push(parts.join(" "));
  }

  // Deduplicate and clean
  return [...new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()))];
}

// --- Apify eBay Search ---

async function fetchEbayComps(query: string, count: number = 15): Promise<Record<string, unknown>[]> {
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ACTOR)}/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: query,
        count,
        daysToScrape: 90,
        sortOrder: "endedRecently",
        ebaySite: "ebay.com",
        itemCondition: "any",
        currencyMode: "USD",
      }),
    }
  );

  if (!runRes.ok) throw new Error(`Apify run failed: ${runRes.status}`);

  const run = await runRes.json();
  const runId = run.data?.id;
  if (!runId) throw new Error("No run ID returned from Apify");

  const maxWait = 120_000;
  const start = Date.now();
  let status = run.data?.status;

  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
    if (Date.now() - start > maxWait) throw new Error("Apify run timed out");
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const statusData = await statusRes.json();
    status = statusData.data?.status;
  }

  if (status !== "SUCCEEDED") throw new Error(`Apify run ${status}`);

  const datasetId = run.data?.defaultDatasetId;
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${count}`
  );

  if (!dataRes.ok) throw new Error(`Failed to fetch dataset: ${dataRes.status}`);
  return dataRes.json();
}

// --- Google Lens Visual Search ---

async function uploadImageToApify(filePath: string): Promise<string> {
  const buffer = await readFile(path.join(UPLOADS_DIR, filePath));
  const ext = filePath.split(".").pop() || "jpg";
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] || "image/jpeg";

  // Create a temporary key-value store
  const storeRes = await fetch(`https://api.apify.com/v2/key-value-stores?token=${APIFY_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `postcard-tmp-${Date.now()}` }),
  });
  if (!storeRes.ok) throw new Error("Failed to create KV store");
  const store = await storeRes.json();
  const storeId = store.data?.id;

  // Upload the image
  const uploadRes = await fetch(
    `https://api.apify.com/v2/key-value-stores/${storeId}/records/image?token=${APIFY_TOKEN}`,
    { method: "PUT", headers: { "Content-Type": contentType }, body: buffer }
  );
  if (!uploadRes.ok) throw new Error("Failed to upload image to KV store");

  // Public URL
  return `https://api.apify.com/v2/key-value-stores/${storeId}/records/image`;
}

async function googleLensSearch(imageUrl: string): Promise<Record<string, unknown>[]> {
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/borderline~google-lens/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchTypes: ["exact-match", "visual-match"],
        imageUrls: [{ url: imageUrl }],
        language: "en",
      }),
    }
  );

  if (!runRes.ok) throw new Error(`Google Lens run failed: ${runRes.status}`);

  const run = await runRes.json();
  const runId = run.data?.id;
  if (!runId) throw new Error("No run ID from Google Lens");

  // Poll for completion (Lens can take up to 3 minutes)
  const maxWait = 180_000;
  const start = Date.now();
  let status = run.data?.status;

  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
    if (Date.now() - start > maxWait) throw new Error("Google Lens timed out");
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const statusData = await statusRes.json();
    status = statusData.data?.status;
  }

  if (status !== "SUCCEEDED") throw new Error(`Google Lens ${status}`);

  const datasetId = run.data?.defaultDatasetId;
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=50`
  );
  if (!dataRes.ok) throw new Error("Failed to fetch Lens results");

  const results = await dataRes.json();

  // Filter for eBay results and normalize
  // Lens returns: [{  "exact-match": { results: [...] } }, { "visual-match": { results: [...] } }]
  const ebayResults: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const item of results) {
    const matchSets = [
      ...(item["exact-match"]?.results || []),
      ...(item["visual-match"]?.results || []),
    ];

    for (const match of matchSets) {
      const url = (match.link || match.url || "") as string;
      const title = (match.title || "") as string;

      if (url.includes("ebay.com") && title && !seen.has(url)) {
        seen.add(url);
        ebayResults.push({
          title,
          url,
          source: match.source || "Google Lens",
          thumbnail: match.thumbnail || null,
          price: match.price || null,
          lensMatch: true,
        });
      }
    }
  }

  return ebayResults;
}

// --- Run tiered search and deduplicate ---

async function tieredSearch(queries: string[]): Promise<Record<string, unknown>[]> {
  const seen = new Set<string>();
  const allResults: Record<string, unknown>[] = [];

  for (const query of queries) {
    try {
      const results = await fetchEbayComps(query, 15);
      for (const item of results) {
        const key = (item.title as string || "") + "|" + (item.price as number || 0);
        if (!seen.has(key)) {
          seen.add(key);
          allResults.push(item);
        }
      }
      // If first tier already found 10+ results, skip broader tiers
      if (allResults.length >= 10) break;
    } catch (err) {
      console.error(`Apify search failed for "${query}":`, err);
    }
  }

  return allResults;
}

// --- AI Relevance Scoring + Pricing ---

async function scoreAndPrice(
  postcard: {
    title: string; era: string; condition: string;
    locationDepicted: string | null; publisher: string | null; category: string;
  },
  aiAnalysis: Record<string, unknown> | null,
  comps: Record<string, unknown>[]
): Promise<{ scored: ScoredComp[]; pricing: PricingResult }> {
  const anthropic = new Anthropic();

  // Build a concise summary of the AI analysis for the prompt
  let analysisContext = "";
  if (aiAnalysis) {
    const c = aiAnalysis.classification as Record<string, unknown> | undefined;
    const v = aiAnalysis.visual_inventory as Record<string, unknown> | undefined;
    const front = v?.front as Record<string, unknown> | undefined;

    if (c) {
      const cardType = c.card_type as { value?: string } | undefined;
      const era = c.era as { date_range?: string } | undefined;
      const loc = c.location as { city?: string; state?: string; specific_place?: string } | undefined;
      const pub = c.publisher as { name?: string } | undefined;
      const cond = c.condition as { grade?: string } | undefined;
      const tags = c.subject_tags as string[] | undefined;

      analysisContext = [
        `Card Type: ${cardType?.value || "unknown"}`,
        `Era: ${era?.date_range || "unknown"}`,
        `Location: ${[loc?.specific_place, loc?.city, loc?.state].filter(Boolean).join(", ") || "unknown"}`,
        `Publisher: ${pub?.name || "unknown"}`,
        `Condition: ${cond?.grade || "unknown"}`,
        `Subject: ${c.primary_subject || "unknown"}`,
        `Tags: ${tags?.join(", ") || "none"}`,
        front?.image_description ? `Image: ${(front.image_description as string).slice(0, 200)}` : null,
      ].filter(Boolean).join("\n");
    }
  }

  const compsForPrompt = comps.slice(0, 25).map((c, i) => {
    const title = (c.title || c.name || "Unknown") as string;
    const soldPrice = parseFloat(String(c.soldPrice || c.price || 0)) || 0;
    const totalPrice = parseFloat(String(c.totalPrice || 0)) || 0;
    const isLens = c.lensMatch === true;
    const priceStr = soldPrice > 0 ? `$${soldPrice.toFixed(2)}` : totalPrice > 0 ? `$${totalPrice.toFixed(2)} (incl. shipping)` : (isLens ? "ACTIVE LISTING (no sold price)" : "$0.00");
    const tag = isLens ? " [VISUAL MATCH]" : " [KEYWORD SEARCH]";
    return `${i + 1}. "${title}" — ${priceStr}${tag}`;
  }).join("\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are a vintage postcard pricing expert. Score each comparable for relevance to MY postcard, then recommend pricing.

IMPORTANT: Comparables tagged [VISUAL MATCH] come from Google Lens image search — they are ACTIVE LISTINGS, not sold items. Use them for RELEVANCE SCORING (they confirm the card exists on eBay and show market supply) but NOT for pricing. Comparables tagged [KEYWORD SEARCH] are SOLD listings with actual sale prices — use these for pricing.

MY POSTCARD:
${analysisContext || `Title: ${postcard.title}\nEra: ${postcard.era}\nCondition: ${postcard.condition}\nLocation: ${postcard.locationDepicted || "unknown"}\nPublisher: ${postcard.publisher || "unknown"}\nCategory: ${postcard.category}`}

EBAY SOLD COMPARABLES:
${compsForPrompt || "No comparables found."}

Respond in this exact JSON format only, no markdown fences, no other text:
{
  "scored_comps": [
    {"index": 1, "relevance": 8, "reason": "Same location and era, similar subject"},
    ...for each comparable, 0-10 where 10=exact same card, 7+=very similar, 4-6=somewhat related, 0-3=not relevant
  ],
  "verdict": "common|moderate|collector|unknown",
  "verdict_label": "Common ($1-3)|Moderate ($5-15)|Collector Interest ($15+)|Needs More Research",
  "quick": 1.50,
  "recommended": 3.00,
  "collector": 5.00,
  "reasoning": "1-2 sentence explanation citing specific comps",
  "best_comp_match": "title of the single most relevant comparable, or null"
}

Verdict guide:
- "common": recommended price under $5. Mass-produced, many similar available. Many visual matches = high supply.
- "moderate": recommended $5-15. Some collector interest, decent condition, identifiable location/subject.
- "collector": recommended $15+. Scarce subject, notable publisher, RPPC, identified photographer, pre-1907, or cross-collectible appeal. Few or no visual matches = low supply.
- "unknown": not enough data to judge. Use this sparingly.

Price based ONLY on [KEYWORD SEARCH] comps with relevance 6+ (these have actual sold prices). Use [VISUAL MATCH] comps for relevance scoring and supply assessment only. If no keyword comps score 6+, estimate based on card characteristics and note low confidence.`,
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      scored: comps.slice(0, 15).map((c) => ({
        title: (c.title || c.name || "Unknown") as string,
        soldPrice: parseFloat(String(c.soldPrice || c.price || 0)) || 0,
        totalPrice: parseFloat(String(c.totalPrice || 0)) || 0,
        shippingPrice: parseFloat(String(c.shippingPrice || 0)) || 0,
        url: (c.url || c.itemUrl || null) as string | null,
        endedAt: (c.endedAt as string) || null,
        relevance: 5,
        matchReason: "Scoring unavailable",
      })),
      pricing: {
        verdict: "unknown",
        verdictLabel: "Needs More Research",
        quick: 0,
        recommended: 0,
        collector: 0,
        reasoning: raw || "Unable to generate pricing.",
        bestCompMatch: null,
      },
    };
  }

  // Map scored comps back to original data
  const scoredMap = new Map<number, { relevance: number; reason: string }>();
  const scoredComps = parsed.scored_comps as Array<{ index: number; relevance: number; reason: string }> | undefined;
  if (scoredComps) {
    for (const sc of scoredComps) {
      scoredMap.set(sc.index, { relevance: sc.relevance, reason: sc.reason });
    }
  }

  const scored: ScoredComp[] = comps.slice(0, 25).map((c, i) => {
    const score = scoredMap.get(i + 1);
    return {
      title: (c.title || c.name || "Unknown") as string,
      soldPrice: parseFloat(String(c.soldPrice || c.price || 0)) || 0,
      totalPrice: parseFloat(String(c.totalPrice || 0)) || 0,
      shippingPrice: parseFloat(String(c.shippingPrice || 0)) || 0,
      url: (c.url || c.itemUrl || null) as string | null,
      endedAt: (c.endedAt as string) || null,
      relevance: score?.relevance ?? 5,
      matchReason: score?.reason ?? "",
    };
  }).sort((a, b) => b.relevance - a.relevance);

  const pricing: PricingResult = {
    verdict: (parsed.verdict as PricingResult["verdict"]) || "unknown",
    verdictLabel: (parsed.verdict_label as string) || "Needs More Research",
    quick: (parsed.quick as number) || 0,
    recommended: (parsed.recommended as number) || 0,
    collector: (parsed.collector as number) || 0,
    reasoning: (parsed.reasoning as string) || "",
    bestCompMatch: (parsed.best_comp_match as string) || null,
  };

  return { scored, pricing };
}

// --- Main Handler ---

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth: accept session cookie OR webhook secret (for internal calls from ingest)
  const secret = request.headers.get("x-webhook-secret");
  const cookie = request.cookies.get("sunshine-session")?.value;
  if (!cookie && secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  const postcard = db
    .select()
    .from(postcards)
    .where(eq(postcards.id, parseInt(id)))
    .all()[0];

  if (!postcard) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  try {
    // Load AI analysis
    const aiResearch = db
      .select()
      .from(researchResults)
      .where(eq(researchResults.postcardId, parseInt(id)))
      .all()
      .find((r) => r.source === "ai_analysis");

    let aiAnalysis: Record<string, unknown> | null = null;
    if (aiResearch) {
      try { aiAnalysis = JSON.parse(aiResearch.data); } catch { /* ignore */ }
    }

    // Step 0: Google Lens visual search (Tier 0 — image-based exact/visual match)
    let lensResults: Record<string, unknown>[] = [];
    const images = db
      .select()
      .from(postcardImages)
      .where(eq(postcardImages.postcardId, parseInt(id)))
      .all();
    const frontImage = images.find((img) => img.side === "front") || images[0];

    if (frontImage) {
      try {
        console.log(`Google Lens: uploading image for postcard #${id}...`);
        const imageUrl = await uploadImageToApify(frontImage.filePath);
        console.log(`Google Lens: searching...`);
        lensResults = await googleLensSearch(imageUrl);
        console.log(`Google Lens: found ${lensResults.length} eBay results`);
      } catch (err) {
        console.error("Google Lens search failed:", err);
        // Continue with keyword search — Lens is a bonus, not required
      }
    }

    // Step 1: Build tiered queries and run keyword searches
    const queries = buildTieredQueries(postcard, aiAnalysis);
    const keywordComps = await tieredSearch(queries);

    // Merge: Lens results first (they're visual matches), then keyword results, deduped
    const seen = new Set<string>();
    const allComps: Record<string, unknown>[] = [];

    for (const item of lensResults) {
      const key = ((item.title as string) || "").toLowerCase().slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        allComps.push(item);
      }
    }
    for (const item of keywordComps) {
      const key = ((item.title as string) || "").toLowerCase().slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        allComps.push(item);
      }
    }

    // Step 2: AI scoring and pricing
    const { scored, pricing } = await scoreAndPrice(postcard, aiAnalysis, allComps);

    // Step 3: Store results (delete old first)
    const existingResearch = db
      .select()
      .from(researchResults)
      .where(eq(researchResults.postcardId, parseInt(id)))
      .all();

    for (const r of existingResearch) {
      if (r.source === "ebay_sold" || r.source === "price_recommendation") {
        db.delete(researchResults).where(eq(researchResults.id, r.id)).run();
      }
    }

    db.insert(researchResults)
      .values({
        postcardId: parseInt(id),
        source: "ebay_sold",
        data: JSON.stringify(scored),
      })
      .run();

    db.insert(researchResults)
      .values({
        postcardId: parseInt(id),
        source: "price_recommendation",
        data: JSON.stringify(pricing),
      })
      .run();

    // Step 4: Backfill estimatedValue if not set
    if (!postcard.estimatedValue && pricing.recommended > 0) {
      db.update(postcards)
        .set({ estimatedValue: pricing.recommended, updatedAt: sql`(datetime('now'))` })
        .where(eq(postcards.id, parseInt(id)))
        .run();
    }

    return NextResponse.json({
      success: true,
      queries,
      lensMatches: lensResults.length,
      compsFound: scored.length,
      relevantComps: scored.filter((s) => s.relevance >= 6).length,
      pricing,
    });
  } catch (err) {
    console.error("Research failed:", err);
    return NextResponse.json(
      { error: "Research failed", details: String(err) },
      { status: 500 }
    );
  }
}
