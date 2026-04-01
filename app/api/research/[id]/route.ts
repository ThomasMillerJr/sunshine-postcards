import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, researchResults } from "@/lib/schema";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = "caffein.dev/ebay-sold-listings";

// Build a search query from postcard fields
function buildSearchQuery(postcard: {
  title: string;
  era: string;
  locationDepicted: string | null;
  category: string;
}): string {
  const parts = ["vintage postcard"];

  // Add the most distinctive info
  if (postcard.locationDepicted) {
    parts.push(postcard.locationDepicted);
  } else if (postcard.title) {
    // Use title but strip generic words
    const cleaned = postcard.title
      .replace(/postcard|vintage|antique|greetings from/gi, "")
      .trim();
    if (cleaned) parts.push(cleaned);
  }

  if (postcard.era) {
    parts.push(postcard.era);
  }

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

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    return JSON.parse(text);
  } catch {
    return {
      quick: 0,
      recommended: 0,
      collector: 0,
      reasoning: text || "Unable to generate pricing recommendation.",
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
    // Step 1: Build search query and fetch eBay comps
    const query = buildSearchQuery(postcard);
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
