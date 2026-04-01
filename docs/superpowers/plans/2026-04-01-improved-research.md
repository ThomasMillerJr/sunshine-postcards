# Improved Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-query eBay research with tiered search, AI relevance scoring, and a quick triage verdict so mom can sort boxes fast.

**Architecture:** Rewrite `app/api/research/[id]/route.ts` with: (1) tiered query builder producing 3 queries from specific→broad, (2) deduped result merging, (3) Claude relevance scoring of each comp against the AI analysis, (4) smarter pricing prompt with full analysis context and match quality, (5) a triage verdict field. Add a verdict badge to the detail page hero and inventory grid.

**Tech Stack:** Existing stack — Apify eBay actor, Claude Haiku for pricing/scoring, Anthropic SDK

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/api/research/[id]/route.ts` | Rewrite | Tiered search, relevance scoring, improved pricing |
| `app/inventory/[id]/page.tsx` | Modify | Verdict badge in hero, scored comps display |
| `app/inventory/page.tsx` | Modify | Verdict badge in grid/list cards |
| `app/api/postcards/route.ts` | Modify | Include latest verdict in list response |

---

### Task 1: Rewrite Research Route — Tiered Search + Relevance Scoring + Verdict

**Files:**
- Rewrite: `app/api/research/[id]/route.ts`

This is the core change. Replace the entire file with a new implementation.

- [ ] **Step 1: Write the new research route**

Write the following to `app/api/research/[id]/route.ts`:

```typescript
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
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/research/\[id\]/route.ts
git commit -m "feat: rewrite research with tiered search, relevance scoring, and triage verdict"
```

---

### Task 2: Update Detail Page — Scored Comps Display + Verdict Badge

**Files:**
- Modify: `app/inventory/[id]/page.tsx`

Three changes: (1) verdict badge in hero section, (2) comps display shows relevance scores, (3) pricing card shows verdict and reasoning.

- [ ] **Step 1: Add verdict badge to hero section**

In `app/inventory/[id]/page.tsx`, find the value badge section (after the Edit/Delete buttons, the `{/* Value badge */}` comment). Add the verdict badge right after the value badge `</div>`:

Find this block:
```tsx
          {/* Value badge */}
          <div className="mt-4">
            {postcard.estimatedValue ? (
```

Replace the entire value badge section through its closing `</div>` with:

```tsx
          {/* Badges */}
          <div className="mt-4 flex flex-wrap gap-2">
            {postcard.estimatedValue ? (
              <span className="inline-block bg-gradient-to-r from-[#F7B733] to-[#F0A030] text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-[0_2px_8px_rgba(247,183,51,0.2)]">
                Est. ${postcard.estimatedValue.toFixed(2)}
              </span>
            ) : (
              <span className="inline-block bg-[#F5F0EA] text-[#B8B0A4] px-4 py-1.5 rounded-lg text-sm">
                No estimate yet
              </span>
            )}
            {(() => {
              const pr = postcard.research.find((r) => r.source === "price_recommendation");
              if (!pr) return null;
              try {
                const data = JSON.parse(pr.data);
                const v = data.verdict as string;
                const label = data.verdictLabel as string;
                const colors: Record<string, string> = {
                  common: "bg-[#F0EBE3] text-[#8A8278]",
                  moderate: "bg-[#FFF4D6] text-[#8A6A10]",
                  collector: "bg-[#E8F5E9] text-[#2E7D32]",
                  unknown: "bg-[#F5F0EA] text-[#B8B0A4]",
                };
                return (
                  <span className={`inline-block px-3 py-1.5 rounded-lg text-sm font-medium ${colors[v] || colors.unknown}`}>
                    {label}
                  </span>
                );
              } catch { return null; }
            })()}
          </div>
```

- [ ] **Step 2: Replace eBay comps display with scored version**

Find the eBay comps card content — the section that starts with `{postcard.research.find((r) => r.source === "ebay_sold") ? (` and replace it through its matching empty-state else branch `</div>` with:

```tsx
          {postcard.research.find((r) => r.source === "ebay_sold") ? (
            <div>
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "ebay_sold")!.data);
                  const items = Array.isArray(data) ? data : data.items || [];
                  return items.slice(0, 15).map((item: Record<string, unknown>, i: number) => {
                    const title = (item.title || item.name || "Unknown") as string;
                    const price = (item.price || item.soldPrice || item.totalPrice || 0) as number;
                    const relevance = (item.relevance as number) ?? null;
                    const reason = (item.matchReason as string) || "";
                    return (
                      <div key={i} className="flex items-center gap-2 py-2 border-b border-[#FFF8F0] last:border-0">
                        {relevance !== null && (
                          <span
                            className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              relevance >= 7 ? "bg-[#E8F5E9] text-[#2E7D32]" :
                              relevance >= 4 ? "bg-[#FFF4D6] text-[#8A6A10]" :
                              "bg-[#F0EBE3] text-[#B8B0A4]"
                            }`}
                            title={reason}
                          >
                            {relevance}
                          </span>
                        )}
                        <span className="text-sm text-[#2D2A26] truncate flex-1" title={reason}>{title}</span>
                        <span className="text-sm font-bold text-[#2E7D32] flex-shrink-0">
                          {typeof price === "number" && price > 0 ? `$${price.toFixed(2)}` : "\u2014"}
                        </span>
                      </div>
                    );
                  });
                } catch {
                  return <p className="text-sm text-[#8A8278]">{postcard.research.find((r) => r.source === "ebay_sold")!.data}</p>;
                }
              })()}
            </div>
          ) : (
            <div className="bg-[#FFFCF5] rounded-lg p-4 text-sm text-[#B8B0A4] text-center">
              No comparables found yet. Click Find Comps to search eBay sold listings.
            </div>
          )
```

- [ ] **Step 3: Update price recommendation display to show verdict + reasoning**

Find the Price Recommendation card. Replace the existing content (from `{postcard.research.find((r) => r.source === "price_recommendation") ? (` through the empty-state closing `</div>`) with:

```tsx
          {postcard.research.find((r) => r.source === "price_recommendation") ? (
            <div>
              {(() => {
                try {
                  const data = JSON.parse(postcard.research.find((r) => r.source === "price_recommendation")!.data);
                  return (
                    <>
                      <div className="flex gap-3 mb-3">
                        <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                          <div className="text-[10px] text-[#B8B0A4]">Quick Sale</div>
                          <div className="text-lg font-bold text-[#2D2A26] mt-1">
                            {data.quick > 0 ? `$${data.quick.toFixed(2)}` : "\u2014"}
                          </div>
                        </div>
                        <div className="flex-1 text-center bg-gradient-to-b from-[#FFF4D6] to-[#FFE8B0] rounded-lg p-3">
                          <div className="text-[10px] text-[#8A6A10] font-medium">Recommended</div>
                          <div className="text-lg font-bold text-[#2D2A26] mt-1">
                            {data.recommended > 0 ? `$${data.recommended.toFixed(2)}` : "\u2014"}
                          </div>
                        </div>
                        <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                          <div className="text-[10px] text-[#B8B0A4]">Collector</div>
                          <div className="text-lg font-bold text-[#2D2A26] mt-1">
                            {data.collector > 0 ? `$${data.collector.toFixed(2)}` : "\u2014"}
                          </div>
                        </div>
                      </div>
                      {data.bestCompMatch && (
                        <div className="bg-[#E8F5E9] rounded-lg p-3 mb-2">
                          <div className="text-[10px] uppercase tracking-wider text-[#2E7D32] font-medium mb-0.5">Best Match</div>
                          <p className="text-sm text-[#2D2A26]">{data.bestCompMatch}</p>
                        </div>
                      )}
                      {data.reasoning && (
                        <p className="text-xs text-[#8A8278] italic leading-relaxed">{data.reasoning}</p>
                      )}
                    </>
                  );
                } catch {
                  return <p className="text-sm text-[#8A8278]">Unable to parse pricing data.</p>;
                }
              })()}
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                <div className="text-[10px] text-[#B8B0A4]">Quick Sale</div>
                <div className="text-lg font-bold text-[#D4CFC6] mt-1">{"\u2014"}</div>
              </div>
              <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                <div className="text-[10px] text-[#B8B0A4]">Recommended</div>
                <div className="text-lg font-bold text-[#D4CFC6] mt-1">{"\u2014"}</div>
              </div>
              <div className="flex-1 text-center bg-[#FFF8F0] rounded-lg p-3">
                <div className="text-[10px] text-[#B8B0A4]">Collector</div>
                <div className="text-lg font-bold text-[#D4CFC6] mt-1">{"\u2014"}</div>
              </div>
            </div>
          )
```

- [ ] **Step 4: Verify build**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/inventory/\[id\]/page.tsx
git commit -m "feat: add verdict badge, relevance scores on comps, best match highlight"
```

---

### Task 3: Add Verdict to Inventory Grid

**Files:**
- Modify: `app/api/postcards/route.ts`
- Modify: `app/inventory/page.tsx`

Surface the verdict badge on inventory cards so mom can see at a glance which cards are worth investigating.

- [ ] **Step 1: Include verdict in API list response**

In `app/api/postcards/route.ts`, the list endpoint already queries all postcards and attaches `thumbnailImageId`. Add a verdict lookup. After the existing `imageMap` block, add a verdict map:

Find:
```typescript
  const withThumbnails = results.map((p) => ({
    ...p,
    thumbnailImageId: imageMap.get(p.id) ?? null,
  }));
```

Replace with:
```typescript
  // Attach latest verdict for each postcard
  const allResearch = db
    .select()
    .from(researchResults)
    .all()
    .filter((r) => r.source === "price_recommendation");

  const verdictMap = new Map<number, { verdict: string; verdictLabel: string }>();
  for (const r of allResearch) {
    try {
      const data = JSON.parse(r.data);
      if (data.verdict) {
        verdictMap.set(r.postcardId, { verdict: data.verdict, verdictLabel: data.verdictLabel || "" });
      }
    } catch { /* ignore */ }
  }

  const withThumbnails = results.map((p) => ({
    ...p,
    thumbnailImageId: imageMap.get(p.id) ?? null,
    verdict: verdictMap.get(p.id)?.verdict ?? null,
    verdictLabel: verdictMap.get(p.id)?.verdictLabel ?? null,
  }));
```

Also add `researchResults` to the schema import:
```typescript
import { postcards, postcardImages, researchResults } from "@/lib/schema";
```

- [ ] **Step 2: Add verdict to inventory page interface and grid display**

In `app/inventory/page.tsx`, update the `Postcard` interface to add:
```typescript
  verdict: string | null;
  verdictLabel: string | null;
```

Then in the grid view, after the price line (`{pc.estimatedValue ? ...}`), add the verdict badge:

Find:
```tsx
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-[#E8634A]">
                    {pc.estimatedValue ? `$${pc.estimatedValue.toFixed(0)}` : "\u2014"}
                  </span>
                </div>
```

Replace with:
```tsx
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-[#E8634A]">
                    {pc.estimatedValue ? `$${pc.estimatedValue.toFixed(0)}` : "\u2014"}
                  </span>
                  {pc.verdict && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      pc.verdict === "collector" ? "bg-[#E8F5E9] text-[#2E7D32]" :
                      pc.verdict === "moderate" ? "bg-[#FFF4D6] text-[#8A6A10]" :
                      pc.verdict === "common" ? "bg-[#F0EBE3] text-[#8A8278]" :
                      "bg-[#F5F0EA] text-[#B8B0A4]"
                    }`}>
                      {pc.verdict === "collector" ? "Collector" :
                       pc.verdict === "moderate" ? "Moderate" :
                       pc.verdict === "common" ? "Common" : "?"}
                    </span>
                  )}
                </div>
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/api/postcards/route.ts app/inventory/page.tsx
git commit -m "feat: show verdict badge on inventory grid cards"
```

---

### Task 4: Build, Restart PM2, Push

**Files:** None (verification only)

- [ ] **Step 1: Final build**

```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -5
```

- [ ] **Step 2: Restart PM2 and push**

```bash
pm2 restart sunshine-postcards && git push
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Tiered search + relevance scoring + verdict pricing | `app/api/research/[id]/route.ts` |
| 2 | Verdict badge, scored comps display, best match highlight | `app/inventory/[id]/page.tsx` |
| 3 | Verdict on inventory grid cards | `app/api/postcards/route.ts`, `app/inventory/page.tsx` |
| 4 | Build, restart, push | (verification) |
