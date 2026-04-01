import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, researchResults } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = "caffein.dev/ebay-sold-listings";

// --- Types ---

interface ScoredComp {
  title: string;
  price: number;
  url: string | null;
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
    const price = (c.price || c.soldPrice || c.totalPrice || 0) as number;
    const url = (c.url || c.itemUrl || null) as string | null;
    return `${i + 1}. "${title}" — $${typeof price === "number" ? price.toFixed(2) : "0.00"}${url ? ` — ${url}` : ""}`;
  }).join("\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are a vintage postcard pricing expert. Score each eBay sold comparable for relevance to MY postcard, then recommend pricing.

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
- "common": recommended price under $5. Mass-produced, many similar available.
- "moderate": recommended $5-15. Some collector interest, decent condition, identifiable location/subject.
- "collector": recommended $15+. Scarce subject, notable publisher, RPPC, identified photographer, pre-1907, or cross-collectible appeal.
- "unknown": not enough data to judge. Use this sparingly.

Price based ONLY on highly relevant comps (relevance 6+). Ignore low-relevance comps for pricing. If no comps score 6+, estimate based on card characteristics and note low confidence.`,
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
        price: (c.price || c.soldPrice || 0) as number,
        url: (c.url || c.itemUrl || null) as string | null,
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
      price: (c.price || c.soldPrice || c.totalPrice || 0) as number,
      url: (c.url || c.itemUrl || null) as string | null,
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

    // Step 1: Build tiered queries and run searches
    const queries = buildTieredQueries(postcard, aiAnalysis);
    const comps = await tieredSearch(queries);

    // Step 2: AI scoring and pricing
    const { scored, pricing } = await scoreAndPrice(postcard, aiAnalysis, comps);

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
