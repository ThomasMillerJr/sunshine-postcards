import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, researchResults } from "@/lib/schema";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = "caffein.dev/ebay-sold-listings";

// Build a search query using AI analysis + postcard fields
function buildSearchQuery(
  postcard: { title: string; era: string; locationDepicted: string | null; category: string },
  aiAnalysis: Record<string, unknown> | null
): string {
  // If AI analysis exists, build a much better query from classification
  if (aiAnalysis) {
    const c = aiAnalysis.classification as Record<string, unknown> | undefined;
    if (c) {
      const parts: string[] = [];

      // Card type (e.g., "RPPC", "linen", "chrome")
      const cardType = c.card_type as { value?: string } | undefined;
      if (cardType?.value && !cardType.value.startsWith("UNCERTAIN")) {
        parts.push(cardType.value.replace(/_/g, " "));
      }

      // Location
      const loc = c.location as { state?: string; city?: string } | undefined;
      if (loc?.state) parts.push(loc.state);
      if (loc?.city) parts.push(loc.city);

      // Primary subject
      const subject = c.primary_subject as string | undefined;
      if (subject) {
        // Strip overly long AI descriptions down to key terms
        const cleaned = subject
          .replace(/postcard|featuring|multiple|various|showing/gi, "")
          .trim()
          .split(/\s+/)
          .slice(0, 6)
          .join(" ");
        if (cleaned) parts.push(cleaned);
      }

      // Subject tags (pick most specific ones)
      const tags = c.subject_tags as string[] | undefined;
      if (tags && tags.length > 0) {
        const specific = tags.filter(
          (t) => !["exterior", "landscape", "nature"].includes(t)
        );
        if (specific.length > 0) parts.push(specific.slice(0, 2).join(" "));
      }

      if (parts.length > 0) {
        return ("vintage postcard " + parts.join(" ")).replace(/\s+/g, " ").trim();
      }
    }
  }

  // Fallback: use postcard fields
  const parts = ["vintage postcard"];
  if (postcard.locationDepicted) {
    parts.push(postcard.locationDepicted);
  } else if (postcard.title) {
    const cleaned = postcard.title
      .replace(/postcard|vintage|antique|greetings from/gi, "")
      .trim();
    if (cleaned) parts.push(cleaned);
  }
  if (postcard.era) parts.push(postcard.era);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Call Apify to get eBay sold listings
async function fetchEbayComps(query: string): Promise<unknown[]> {
  // Start the actor run
  const runRes = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ACTOR)}/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: query,
        count: 20,
        daysToScrape: 90,
        sortOrder: "endedRecently",
        ebaySite: "ebay.com",
        itemCondition: "any",
        currencyMode: "USD",
      }),
    }
  );

  if (!runRes.ok) {
    throw new Error(`Apify run failed: ${runRes.status} ${await runRes.text()}`);
  }

  const run = await runRes.json();
  const runId = run.data?.id;
  if (!runId) throw new Error("No run ID returned from Apify");

  // Poll for completion (max 2 minutes)
  const maxWait = 120_000;
  const start = Date.now();
  let status = run.data?.status;

  while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
    if (Date.now() - start > maxWait) throw new Error("Apify run timed out");
    await new Promise((r) => setTimeout(r, 3000));

    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`
    );
    const statusData = await statusRes.json();
    status = statusData.data?.status;
  }

  if (status !== "SUCCEEDED") {
    throw new Error(`Apify run ${status}`);
  }

  // Fetch results from dataset
  const datasetId = run.data?.defaultDatasetId;
  const dataRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=20`
  );

  if (!dataRes.ok) {
    throw new Error(`Failed to fetch dataset: ${dataRes.status}`);
  }

  return dataRes.json();
}

// Call Claude for pricing recommendation
async function getPricingRecommendation(
  postcard: {
    title: string;
    era: string;
    condition: string;
    locationDepicted: string | null;
    publisher: string | null;
    category: string;
  },
  comps: unknown[]
): Promise<{ quick: number; recommended: number; collector: number; reasoning: string }> {
  const anthropic = new Anthropic();

  const compsText = (comps as Array<Record<string, unknown>>)
    .slice(0, 15)
    .map((c) => `- "${c.title || c.name}" sold for $${c.price || c.soldPrice || "unknown"}`)
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are a postcard pricing expert. Based on the postcard details and recent eBay sold comparables, provide pricing recommendations.

POSTCARD:
- Title: ${postcard.title}
- Era: ${postcard.era}
- Condition: ${postcard.condition}
- Location: ${postcard.locationDepicted || "unknown"}
- Publisher: ${postcard.publisher || "unknown"}
- Category: ${postcard.category}

RECENT EBAY SOLD COMPARABLES:
${compsText || "No comparables found."}

Respond in this exact JSON format only, no other text:
{"quick": <number>, "recommended": <number>, "collector": <number>, "reasoning": "<1-2 sentence explanation>"}

- quick: price for a fast sale (below market)
- recommended: fair market price
- collector: premium price for patient seller targeting collectors
- If no comps are available, estimate based on general postcard market knowledge.`,
      },
    ],
  });

  const raw =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Strip markdown code fences if present
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return JSON.parse(text);
  } catch {
    return {
      quick: 0,
      recommended: 0,
      collector: 0,
      reasoning: raw || "Unable to generate pricing recommendation.",
    };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  // Get the postcard
  const postcard = db
    .select()
    .from(postcards)
    .where(eq(postcards.id, parseInt(id)))
    .all()[0];

  if (!postcard) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  try {
    // Load AI analysis if available for better search queries
    const aiResearch = db
      .select()
      .from(researchResults)
      .where(eq(researchResults.postcardId, parseInt(id)))
      .all()
      .find((r) => r.source === "ai_analysis");

    let aiAnalysis: Record<string, unknown> | null = null;
    if (aiResearch) {
      try {
        aiAnalysis = JSON.parse(aiResearch.data);
      } catch { /* ignore */ }
    }

    // Step 1: Build search query and fetch eBay comps
    const query = buildSearchQuery(postcard, aiAnalysis);
    let comps: unknown[] = [];

    try {
      comps = await fetchEbayComps(query);
    } catch (err) {
      console.error("Apify eBay search failed:", err);
      // Continue with empty comps — Claude can still estimate
    }

    // Step 2: Store eBay comps
    if (comps.length > 0) {
      // Delete old eBay research for this postcard
      db.delete(researchResults)
        .where(eq(researchResults.postcardId, parseInt(id)))
        .run();

      db.insert(researchResults)
        .values({
          postcardId: parseInt(id),
          source: "ebay_sold",
          data: JSON.stringify(comps),
        })
        .run();
    }

    // Step 3: Get pricing recommendation from Claude
    const pricing = await getPricingRecommendation(postcard, comps);

    // Delete old pricing for this postcard and insert new
    db.insert(researchResults)
      .values({
        postcardId: parseInt(id),
        source: "price_recommendation",
        data: JSON.stringify(pricing),
      })
      .run();

    return NextResponse.json({
      success: true,
      query,
      compsFound: comps.length,
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
