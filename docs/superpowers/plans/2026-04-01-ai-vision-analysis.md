# AI Vision Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude vision-powered postcard analysis that extracts structured metadata from postcard images, stores results, auto-populates postcard fields, and displays a rich analysis card on the detail page.

**Architecture:** A server-side `lib/anthropic.ts` module wraps the Claude API with the vision analysis prompt as system instructions and the output schema as a tool definition. An API route at `/api/postcards/[id]/analyze` orchestrates: fetch images from disk, call Claude, store results in `research_results`, and optionally backfill empty postcard fields. The detail page gets an "Analyze" button that triggers this and renders the structured result. The webhook ingest route is updated to auto-trigger analysis after upload.

**Tech Stack:** `@anthropic-ai/sdk`, Claude Sonnet (vision), existing Drizzle/SQLite stack

**Spec:** `docs/superpowers/specs/2026-04-01-vision-analysis-prompt.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `@anthropic-ai/sdk` dependency |
| `lib/anthropic.ts` | Create | Claude client singleton + `analyzePostcard()` function with system prompt, tool definition, image encoding |
| `app/api/postcards/[id]/analyze/route.ts` | Create | POST handler: load images, call `analyzePostcard()`, store result, optionally backfill postcard fields |
| `app/inventory/[id]/page.tsx` | Modify | Add "Analyze" button, loading state, render structured analysis result |
| `app/api/webhook/ingest/route.ts` | Modify | Fire-and-forget analysis call after postcard + images created |

---

### Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npm install @anthropic-ai/sdk
```

Expected: `@anthropic-ai/sdk` added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify import works**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && node -e "require('@anthropic-ai/sdk'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

---

### Task 2: Create Claude Analysis Module

**Files:**
- Create: `lib/anthropic.ts`
- Reference: `docs/superpowers/specs/2026-04-01-vision-analysis-prompt.md` (system prompt text between `## PROMPT START` and `## PROMPT END`)

This module encapsulates all Claude API interaction. It exports one function: `analyzePostcard()`.

- [ ] **Step 1: Create `lib/anthropic.ts`**

Write the following to `lib/anthropic.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// Media type mapping for Claude vision API
function getMediaType(ext: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const map: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return map[ext] || "image/jpeg";
}

// The system prompt — everything between PROMPT START and PROMPT END in the spec.
// Extracted as a constant so it can be versioned and tested independently.
const SYSTEM_PROMPT = `You are a vintage postcard visual analyst. Your ONLY job is to extract and structure everything visible in postcard images. You do NOT price cards, generate listings, or make value judgments. You observe and classify.

You will receive one or two images: the front and/or back of a postcard. Follow these three steps IN ORDER. Observe before concluding.

STEP 1 — RAW VISUAL INVENTORY

Record everything you see. Do not interpret yet.

Back of card (if provided):
- Is there a vertical dividing line down the center? (yes / no / partially visible)
- All printed text — transcribe verbatim: publisher name, city, "Post Card," "Private Mailing Card," patent notices, process names, card/series numbers, country of printing
- Stamp box (upper-right rectangle): any logos, brand names (AZO, VELOX, CYKO, DOPS, EKC, KODAK), geometric shapes (triangles pointing up/down, squares, diamonds), any text within the box
- Postage stamp if present: denomination, color, subject depicted, country
- Postmark if present: date (full or partial), city, state/country
- Handwritten text: transcribe if legible, summarize if partially legible, note "present but illegible" if not. Flag any names of people, places, or businesses mentioned.
- Physical condition observations: stains, foxing, creases, tears, album residue, thinning, tape marks, writing placement relative to the dividing line

Front of card (if provided):
- Full image description: subject, setting, people (number, clothing, activity), vehicles, buildings, landscape, weather/season cues
- Card orientation: horizontal (landscape) or vertical (portrait)
- ALL readable text — transcribe exactly: signs, banners, storefront names, captions, photographer credits, card titles, watermarks, imprints, copyright notices
- Printing characteristics:
  - Halftone dots visible? (yes = printed / no = likely real photo / cannot determine)
  - Surface finish: glossy, matte, textured/cross-hatched (linen-like), or cannot determine
  - White border framing the image? (yes / no)
  - Color characteristics: full photographic color, vivid/exaggerated color, muted lithographic color, black & white, hand-tinted, sepia
  - Image coverage: full-bleed to edges, or inset/vignette
- Card size if determinable: standard (~3.5x5.5 in) or oversized (~4x6 in)
- Signs of reproduction: suspiciously sharp printing on aged stock, modern barcode or UPC, "reproduction" or "reprint" text, inkjet dot patterns, mismatched paper age vs. image sharpness
- Physical condition observations: corner sharpness (sharp / slightly rounded / blunt / missing material), visible creases (none / faint / moderate / heavy), tears, stains on picture side, writing on picture side, color fading, surface scuffs or abrasion, silvering (metallic sheen in dark areas)

STEP 2 — CLASSIFICATION

Based ONLY on what you recorded in Step 1, determine the following. If uncertain about any field, state "UNCERTAIN" with a brief reason — do not guess.

2A — Card Type and Era

Apply this decision tree:

1. Back layout:
   - No dividing line → pre-1907:
     - "Private Mailing Card, Authorized by Act of Congress" → Private Mailing Card (1898–1901)
     - "Post Card" + "This side for address only" → Undivided Back (1901–1907)
     - Neither phrase → Pioneer (1893–1898)
   - Dividing line present → 1907 or later → go to step 2

2. Front surface (for post-1907 cards):
   - Continuous tone, no dot pattern → Real Photo Postcard (RPPC)
   - White border framing image → White Border (1915–1930)
   - Textured/linen surface + vivid exaggerated colors → Linen (1930–1945)
   - Glossy surface + photographic color + dot pattern → Chrome (1939–present)
   - Full-bleed + rich lithographic color + "Printed in Germany" → Golden Age Divided Back (1907–1915)
   - 4x6 inch size, barcodes, ZIP codes → Continental/Modern (1960s–present)

3. RPPC dating (if applicable) via stamp box:
   - AZO + upward-pointing triangles → 1904–1918
   - AZO + squares → 1925–1940s
   - VELOX + squares → 1901–1914
   - CYKO → 1904–1920s
   - DOPS → 1925–1942
   - EKC → 1939–1950
   - KODAK → 1950+
   - No identifiable stamp box mark → note "stamp box unidentified"

2B — Publisher

Check for these markers. Report ONLY if positively identified:
- Raphael Tuck & Sons: Easel trademark, "Art Publishers to Their Majesties," series names (Oilette, Aquarette, Rapholette), numbered series, "Printed in Bavaria/Germany/Saxony"
- Curt Teich & Company: Alpha-numeric code (e.g., "2B-H446"), "C.T." initials, "C.T. Art-Colortone," large-letter "Greetings From" format. Decode if present: first digit = year in decade, letter = decade (A=1930s, B=1940s, C=1950s), following letter = process (H=linen, K=chrome)
- Detroit Publishing Company: Painter's palette logo, "Photochrom" or "Phostint," Roman numeral year codes, sequential production numbers
- Dexter Press: "Dexter Press, West Nyack, N.Y.," "Genuine Natural Color," "D.P.[year]" mark
- E.C. Kropp: "E.C. Kropp Co., Milwaukee, Wis."
- Valentine & Sons: Circled "J.V." initials near card number
- Rotograph Company: "The Rotograph Co., N.Y. City"
- Other: Report any publisher text/logos found verbatim even if not in this list

2C — Subject Tags

Tag ALL applicable subjects from this controlled vocabulary:
Scene type: street scene, main street, bird's-eye view, interior, exterior, portrait, group photo, panoramic, multi-view
Content: storefronts, residential, church, school, courthouse, post office, hotel, hospital, factory, railroad depot, bridge, dam, park, beach, waterfront, monument, cemetery, fairgrounds
People & activity: occupational (specify trade), military, sports, parade, ceremony, crowd scene, children, family
Transportation: horse-drawn, automobile, trolley/streetcar, railroad, steamship, airplane, dirigible, bicycle
Commercial: advertising (list brand names), restaurant, gas station, motel, roadside attraction, amusement park
Historical: disaster (specify type), political (specify), African American history, Native American, immigration, labor movement, suffrage, temperance, religious
Holiday/Greeting: Halloween, Christmas, Easter, Thanksgiving, Valentine's Day, St. Patrick's Day, Fourth of July, New Year, birthday, other
Art/Style: artist-signed (name if legible), art nouveau, art deco, comic/humor, novelty, hold-to-light, mechanical, silk applique, embossed, glitter, real hair
Nature: landscape, mountains, river, lake, ocean, forest, desert, agricultural, animals

2D — Condition Assessment

Assign one grade with supporting evidence:
- Mint (M): Perfect, unhandled. No flaws of any kind.
- Near Mint (NM): Very light aging or faint album discoloration only.
- Excellent (EX): No bends, creases, or pinholes. Clean picture side. May be postally used with writing on back only.
- Very Good (VG): Slightly rounded corners, barely detectable creases.
- Good (G): Noticeable bends, creases, or blunt corners.
- Fair (F): Heavy creases, staining, or cancellation affecting picture side.
- Poor (P): Incomplete card, heavy damage, major missing areas.

Note: Writing on the front of undivided-back cards (pre-1907) is NORMAL and should not count against condition — the entire back was reserved for the address.

List every defect observed, even if minor.

2E — Reproduction Check

Flag if any of these are present:
- "Reproduction," "reprint," or "replica" text anywhere on the card
- Modern barcode, UPC, or ISBN
- Inkjet dot pattern (irregular, visible colored dots) vs. halftone (regular grid)
- Paper stock that looks new/bright white but image depicts a scene from 100+ years ago
- Suspiciously perfect condition for the apparent age

If none of these signs are present, mark as not suspected. This is a binary flag with reasoning — do not guess.

2F — Cross-Collectible Appeal

Flag if the card would interest collectors OUTSIDE the postcard hobby:
- Philately (notable stamp or postal history)
- Local history / genealogy (identified people, businesses, or locations)
- Advertising / brand memorabilia
- Sports memorabilia
- Military history
- African American history
- Political memorabilia
- Transportation / automotive history
- Holiday collectibles
- Photography history (identified photographer/studio)

STEP 3 — UNCERTAINTY FLAGS

List everything you could NOT determine with confidence:
- RPPC vs high-quality printed reproduction (requires magnification for dot pattern)
- Stamp box brand (not visible, too faded, or not in known reference set)
- Publisher (no identifying marks found)
- Location (not captioned, not identifiable from image content alone)
- Era (conflicting signals between back layout and front characteristics)
- Condition aspects requiring physical inspection (paper thickness, true linen texture vs glossy with printing texture, hidden creases not visible in scan)
- Text that is partially legible (provide best reading with [?] markers)
- Any assumption you made and why

Flag rather than guess. Downstream tools depend on accuracy.`;

// Tool definition for structured output — mirrors the JSON schema from the spec
const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "postcard_analysis",
  description: "Record the complete structured analysis of a postcard based on the visual inventory and classification steps.",
  input_schema: {
    type: "object" as const,
    required: ["visual_inventory", "classification", "uncertainty_flags"],
    properties: {
      visual_inventory: {
        type: "object",
        properties: {
          back: {
            type: ["object", "null"],
            properties: {
              dividing_line: { type: "string", enum: ["yes", "no", "partially_visible"] },
              printed_text_verbatim: { type: "array", items: { type: "string" } },
              stamp_box: {
                type: "object",
                properties: {
                  brand: { type: "string" },
                  symbols: { type: ["string", "null"] },
                  text: { type: ["string", "null"] },
                },
                required: ["brand", "symbols", "text"],
              },
              postage_stamp: {
                type: "object",
                properties: {
                  present: { type: "boolean" },
                  denomination: { type: ["string", "null"] },
                  color: { type: ["string", "null"] },
                  subject: { type: ["string", "null"] },
                  country: { type: ["string", "null"] },
                },
                required: ["present"],
              },
              postmark: {
                type: "object",
                properties: {
                  present: { type: "boolean" },
                  date: { type: ["string", "null"] },
                  city: { type: ["string", "null"] },
                  state: { type: ["string", "null"] },
                },
                required: ["present"],
              },
              handwritten_text: {
                type: "object",
                properties: {
                  present: { type: "boolean" },
                  transcription: { type: ["string", "null"] },
                  legibility: { type: "string", enum: ["legible", "partially_legible", "illegible"] },
                  names_mentioned: { type: "array", items: { type: "string" } },
                },
                required: ["present"],
              },
              condition_observations: { type: "array", items: { type: "string" } },
            },
            required: ["dividing_line", "printed_text_verbatim", "stamp_box", "postage_stamp", "postmark", "handwritten_text", "condition_observations"],
          },
          front: {
            type: ["object", "null"],
            properties: {
              image_description: { type: "string" },
              orientation: { type: "string", enum: ["horizontal", "vertical", "square", "cannot_determine"] },
              text_found: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    type: { type: "string" },
                    location_on_card: { type: "string" },
                  },
                  required: ["text", "type", "location_on_card"],
                },
              },
              printing: {
                type: "object",
                properties: {
                  halftone_dots: { type: "string", enum: ["yes", "no", "cannot_determine"] },
                  surface_finish: { type: "string", enum: ["glossy", "matte", "textured_linen", "cannot_determine"] },
                  white_border: { type: "boolean" },
                  color_type: { type: "string", enum: ["full_color", "vivid_exaggerated", "muted_lithographic", "black_and_white", "hand_tinted", "sepia"] },
                  image_coverage: { type: "string", enum: ["full_bleed", "bordered", "vignette"] },
                },
                required: ["halftone_dots", "surface_finish", "white_border", "color_type", "image_coverage"],
              },
              card_size: { type: "string", enum: ["standard", "oversized_continental", "cannot_determine"] },
              reproduction_signs: { type: "array", items: { type: "string" } },
              condition_observations: {
                type: "object",
                properties: {
                  corners: { type: "string", enum: ["sharp", "slightly_rounded", "blunt", "missing_material"] },
                  creases: { type: "string", enum: ["none", "faint", "moderate", "heavy"] },
                  tears: { type: "string", enum: ["none", "minor", "major"] },
                  stains_on_picture: { type: "string", enum: ["none", "minor", "major"] },
                  writing_on_picture: { type: "string", enum: ["none", "minor", "significant"] },
                  color_fading: { type: "string", enum: ["none", "slight", "significant"] },
                  surface_damage: { type: "string", enum: ["none", "minor_scuffs", "significant_abrasion"] },
                  silvering: { type: "boolean" },
                  other_defects: { type: "array", items: { type: "string" } },
                },
                required: ["corners", "creases", "tears", "stains_on_picture", "writing_on_picture", "color_fading", "surface_damage", "silvering", "other_defects"],
              },
            },
            required: ["image_description", "orientation", "text_found", "printing", "card_size", "reproduction_signs", "condition_observations"],
          },
        },
        required: ["back", "front"],
      },
      classification: {
        type: "object",
        properties: {
          card_type: {
            type: "object",
            properties: {
              value: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              reasoning: { type: "string" },
            },
            required: ["value", "confidence", "reasoning"],
          },
          era: {
            type: "object",
            properties: {
              date_range: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              reasoning: { type: "string" },
            },
            required: ["date_range", "confidence", "reasoning"],
          },
          publisher: {
            type: "object",
            properties: {
              name: { type: ["string", "null"] },
              name_variants: { type: "array", items: { type: "string" } },
              series_name: { type: ["string", "null"] },
              card_number: { type: ["string", "null"] },
              teich_code_decoded: {
                type: "object",
                properties: {
                  raw_code: { type: ["string", "null"] },
                  year: { type: ["integer", "null"] },
                  process: { type: ["string", "null"] },
                },
                required: ["raw_code", "year", "process"],
              },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["name", "name_variants", "confidence"],
          },
          location: {
            type: "object",
            properties: {
              city: { type: ["string", "null"] },
              state: { type: ["string", "null"] },
              country: { type: ["string", "null"] },
              specific_place: { type: ["string", "null"] },
              source: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["city", "state", "country", "confidence"],
          },
          subject_tags: { type: "array", items: { type: "string" } },
          primary_subject: { type: "string" },
          specific_details: {
            type: "object",
            properties: {
              business_names_visible: { type: "array", items: { type: "string" } },
              brand_names_visible: { type: "array", items: { type: "string" } },
              people_identified: { type: "array", items: { type: "string" } },
              photographer_studio: { type: ["string", "null"] },
              artist_name: { type: ["string", "null"] },
              notable_features: { type: "array", items: { type: "string" } },
            },
            required: ["business_names_visible", "brand_names_visible", "people_identified", "notable_features"],
          },
          suspected_reproduction: {
            type: "object",
            properties: {
              value: { type: "boolean" },
              reasoning: { type: "string" },
            },
            required: ["value", "reasoning"],
          },
          cross_collectible_categories: { type: "array", items: { type: "string" } },
          condition: {
            type: "object",
            properties: {
              grade: { type: "string", enum: ["M", "NM", "EX", "VG", "G", "F", "P"] },
              defects: { type: "array", items: { type: "string" } },
              postally_used: { type: "boolean" },
              writing_on_front_expected: { type: "boolean" },
            },
            required: ["grade", "defects", "postally_used", "writing_on_front_expected"],
          },
        },
        required: ["card_type", "era", "publisher", "location", "subject_tags", "primary_subject", "specific_details", "suspected_reproduction", "cross_collectible_categories", "condition"],
      },
      uncertainty_flags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            issue: { type: "string" },
            recommendation: { type: "string" },
          },
          required: ["field", "issue", "recommendation"],
        },
      },
    },
  },
};

export interface PostcardImage {
  id: number;
  side: string;
  filePath: string;
}

export interface AnalysisResult {
  visual_inventory: Record<string, unknown>;
  classification: Record<string, unknown>;
  uncertainty_flags: Array<{ field: string; issue: string; recommendation: string }>;
}

export async function analyzePostcard(images: PostcardImage[]): Promise<AnalysisResult> {
  const client = getClient();

  // Build image content blocks — label each with its side
  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  for (const img of images) {
    const ext = img.filePath.split(".").pop() || "jpg";
    const buffer = await readFile(path.join(UPLOADS_DIR, img.filePath));
    const base64 = buffer.toString("base64");

    imageBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: getMediaType(ext),
        data: base64,
      },
    });
  }

  // Build user message: label which side each image is, then images
  const sideLabels = images.map((img) => `Image ${images.indexOf(img) + 1}: ${img.side} of card`).join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "postcard_analysis" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: sideLabels },
          ...imageBlocks,
          { type: "text", text: "Analyze this postcard following the three steps. Use the postcard_analysis tool to return your structured findings." },
        ],
      },
    ],
  });

  // Extract the tool use result
  const toolBlock = response.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use response");
  }

  return toolBlock.input as AnalysisResult;
}
```

- [ ] **Step 2: Verify the file compiles**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx tsc --noEmit lib/anthropic.ts 2>&1 | head -20
```

Note: This may show module resolution warnings since it's not a full build. A better check:

```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/anthropic.ts
git commit -m "feat: add Claude vision analysis module with structured tool output"
```

---

### Task 3: Create Analysis API Route

**Files:**
- Create: `app/api/postcards/[id]/analyze/route.ts`
- Reference: `app/api/postcards/[id]/route.ts` (pattern for params handling)
- Reference: `lib/schema.ts` (researchResults table)

This route: loads the postcard's images, calls `analyzePostcard()`, stores the result in `research_results`, and optionally backfills empty postcard fields from the classification.

- [ ] **Step 1: Create the route file**

Write the following to `app/api/postcards/[id]/analyze/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, researchResults } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { analyzePostcard } from "@/lib/anthropic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const postcardId = parseInt(id);

  // Verify postcard exists
  const [postcard] = db
    .select()
    .from(postcards)
    .where(eq(postcards.id, postcardId))
    .all();

  if (!postcard) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load images
  const images = db
    .select()
    .from(postcardImages)
    .where(eq(postcardImages.postcardId, postcardId))
    .all();

  if (images.length === 0) {
    return NextResponse.json(
      { error: "No images to analyze. Upload front/back photos first." },
      { status: 400 }
    );
  }

  try {
    const analysis = await analyzePostcard(images);

    // Store result (replace any existing ai_analysis for this postcard)
    const existing = db
      .select()
      .from(researchResults)
      .where(eq(researchResults.postcardId, postcardId))
      .all()
      .filter((r) => r.source === "ai_analysis");

    if (existing.length > 0) {
      db.delete(researchResults)
        .where(eq(researchResults.id, existing[0].id))
        .run();
    }

    const [saved] = db
      .insert(researchResults)
      .values({
        postcardId,
        source: "ai_analysis",
        data: JSON.stringify(analysis),
      })
      .returning()
      .all();

    // Backfill empty postcard fields from classification
    const c = analysis.classification as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    // Only fill fields that are currently empty
    if (!postcard.era && c.era) {
      const era = c.era as { date_range?: string };
      if (era.date_range) updates.era = era.date_range;
    }
    if (!postcard.condition && c.condition) {
      const cond = c.condition as { grade?: string };
      if (cond.grade) updates.condition = cond.grade;
    }
    if (!postcard.publisher && c.publisher) {
      const pub = c.publisher as { name?: string | null };
      if (pub.name) updates.publisher = pub.name;
    }
    if (!postcard.locationDepicted && c.location) {
      const loc = c.location as { city?: string | null; state?: string | null; specific_place?: string | null };
      const parts = [loc.specific_place, loc.city, loc.state].filter(Boolean);
      if (parts.length > 0) updates.locationDepicted = parts.join(", ");
    }
    if (!postcard.category && c.card_type) {
      const ct = c.card_type as { value?: string };
      if (ct.value) updates.category = ct.value;
    }
    if ((!postcard.title || postcard.title.startsWith("New Postcard")) && c.primary_subject) {
      updates.title = c.primary_subject as string;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = sql`(datetime('now'))`;
      db.update(postcards)
        .set(updates)
        .where(eq(postcards.id, postcardId))
        .run();
    }

    // Return the full updated postcard
    const [updated] = db
      .select()
      .from(postcards)
      .where(eq(postcards.id, postcardId))
      .all();

    return NextResponse.json({
      analysis: saved,
      postcard: updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -10
```

Expected: Build succeeds, `/api/postcards/[id]/analyze` appears in route list as `f (Dynamic)`.

- [ ] **Step 3: Commit**

```bash
git add app/api/postcards/\[id\]/analyze/route.ts
git commit -m "feat: add POST /api/postcards/[id]/analyze route with field backfill"
```

---

### Task 4: Add Analyze Button and Display to Detail Page

**Files:**
- Modify: `app/inventory/[id]/page.tsx:247-270` (AI Analysis research card section)

Replace the existing AI Analysis card with one that has an "Analyze" button, loading state, and structured result display.

- [ ] **Step 1: Add analysis state and handler**

In `app/inventory/[id]/page.tsx`, add state variables after the existing `useState` declarations (after line 36):

```typescript
const [analyzing, setAnalyzing] = useState(false);
const [analyzeError, setAnalyzeError] = useState<string | null>(null);
```

Add the analyze handler after the `remove` function (after line 74):

```typescript
const analyze = async () => {
  setAnalyzing(true);
  setAnalyzeError(null);
  try {
    const res = await fetch(`/api/postcards/${id}/analyze`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Analysis failed");
    }
    const data = await res.json();
    setPostcard((prev) =>
      prev
        ? {
            ...prev,
            ...data.postcard,
            images: prev.images,
            transactions: prev.transactions,
            research: [
              ...prev.research.filter((r) => r.source !== "ai_analysis"),
              data.analysis,
            ],
          }
        : prev
    );
  } catch (err) {
    setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
  } finally {
    setAnalyzing(false);
  }
};
```

- [ ] **Step 2: Replace the AI Analysis card**

Replace the AI Analysis card section (the `<div>` from the `{/* AI Analysis */}` comment through its closing `</div>`, approximately lines 252-271) with:

```tsx
{/* AI Analysis */}
<div className="bg-white rounded-xl border border-[#FFF0D4] p-5">
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-[10px] uppercase tracking-[1.2px] text-[#B8B0A4] font-medium">AI Analysis</h3>
    <button
      onClick={analyze}
      disabled={analyzing || postcard.images.length === 0}
      className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {analyzing ? "Analyzing..." : postcard.research.find((r) => r.source === "ai_analysis") ? "Re-analyze" : "Analyze"}
    </button>
  </div>
  {analyzing && (
    <div className="flex items-center gap-3 bg-[#FFFCF5] rounded-lg p-4">
      <div className="w-5 h-5 border-2 border-[#FFF0D4] border-t-[#F7B733] rounded-full animate-spin flex-shrink-0"></div>
      <span className="text-sm text-[#8A8278]">Analyzing postcard images with Claude...</span>
    </div>
  )}
  {analyzeError && (
    <div className="bg-[#FFF0EB] rounded-lg p-4 text-sm text-[#E8634A]">{analyzeError}</div>
  )}
  {!analyzing && postcard.research.find((r) => r.source === "ai_analysis") && (
    <AnalysisDisplay data={postcard.research.find((r) => r.source === "ai_analysis")!.data} />
  )}
  {!analyzing && !analyzeError && !postcard.research.find((r) => r.source === "ai_analysis") && (
    <div className="bg-[#FFFCF5] rounded-lg p-4 text-sm text-[#B8B0A4] text-center">
      No AI analysis yet. Click Analyze to identify this postcard.
    </div>
  )}
</div>
```

- [ ] **Step 3: Add the AnalysisDisplay component**

Add this component definition before the `PostcardDetail` component (before the `export default function PostcardDetail()` line):

```tsx
function AnalysisDisplay({ data }: { data: string }) {
  try {
    const analysis = JSON.parse(data);
    const c = analysis.classification;
    const v = analysis.visual_inventory;
    return (
      <div className="space-y-4">
        {/* Summary row */}
        <div className="bg-[#FFFCF5] rounded-lg p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            {c?.card_type?.value && (
              <span className="inline-block bg-[#FFF4D6] text-[#8A6A10] px-2 py-0.5 rounded text-xs font-medium">
                {c.card_type.value.replace(/_/g, " ")}
              </span>
            )}
            {c?.era?.date_range && (
              <span className="inline-block bg-[#F0EBE3] text-[#8A8278] px-2 py-0.5 rounded text-xs">
                {c.era.date_range}
              </span>
            )}
            {c?.condition?.grade && (
              <span className="inline-block bg-[#E8F5E9] text-[#2E7D32] px-2 py-0.5 rounded text-xs font-medium">
                {c.condition.grade}
              </span>
            )}
            {c?.suspected_reproduction?.value && (
              <span className="inline-block bg-[#FFF0EB] text-[#E8634A] px-2 py-0.5 rounded text-xs font-medium">
                Possible Reproduction
              </span>
            )}
          </div>
          {v?.front?.image_description && (
            <p className="text-sm text-[#8A8278] leading-relaxed">{v.front.image_description}</p>
          )}
        </div>

        {/* Classification details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {c?.publisher?.name && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Publisher</div>
              <div className="text-[#2D2A26]">{c.publisher.name}</div>
            </div>
          )}
          {c?.location?.city && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Location</div>
              <div className="text-[#2D2A26]">
                {[c.location.specific_place, c.location.city, c.location.state].filter(Boolean).join(", ")}
              </div>
            </div>
          )}
          {c?.primary_subject && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Subject</div>
              <div className="text-[#2D2A26]">{c.primary_subject}</div>
            </div>
          )}
          {c?.condition?.postally_used !== undefined && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4]">Postally Used</div>
              <div className="text-[#2D2A26]">{c.condition.postally_used ? "Yes" : "No"}</div>
            </div>
          )}
        </div>

        {/* Subject tags */}
        {c?.subject_tags?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Tags</div>
            <div className="flex flex-wrap gap-1">
              {c.subject_tags.map((tag: string) => (
                <span key={tag} className="inline-block bg-[#F5F0EA] text-[#8A8278] px-2 py-0.5 rounded text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Cross-collectible */}
        {c?.cross_collectible_categories?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Cross-Collectible Appeal</div>
            <div className="flex flex-wrap gap-1">
              {c.cross_collectible_categories.map((cat: string) => (
                <span key={cat} className="inline-block bg-[#FFF4D6] text-[#8A6A10] px-2 py-0.5 rounded text-xs">
                  {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Condition defects */}
        {c?.condition?.defects?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Defects</div>
            <ul className="text-xs text-[#8A8278] list-disc list-inside">
              {c.condition.defects.map((d: string, i: number) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Uncertainty flags */}
        {analysis.uncertainty_flags?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Uncertainties</div>
            <div className="space-y-1">
              {analysis.uncertainty_flags.map((f: { field: string; issue: string; recommendation: string }, i: number) => (
                <div key={i} className="bg-[#FFF8F0] rounded p-2 text-xs">
                  <span className="font-medium text-[#8A6A10]">{f.field}:</span>{" "}
                  <span className="text-[#8A8278]">{f.issue}</span>
                  {f.recommendation && (
                    <div className="text-[#B8B0A4] mt-0.5 italic">{f.recommendation}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Handwritten text */}
        {v?.back?.handwritten_text?.present && v.back.handwritten_text.transcription && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#B8B0A4] mb-1">Handwritten Text</div>
            <div className="bg-[#FFFCF5] rounded p-3 text-sm text-[#8A8278] italic leading-relaxed">
              &ldquo;{v.back.handwritten_text.transcription}&rdquo;
            </div>
          </div>
        )}
      </div>
    );
  } catch {
    return <pre className="text-xs text-[#8A8278] whitespace-pre-wrap overflow-x-auto">{data}</pre>;
  }
}
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
git commit -m "feat: add Analyze button and structured analysis display on detail page"
```

---

### Task 5: Auto-Trigger Analysis on Webhook Ingest

**Files:**
- Modify: `app/api/webhook/ingest/route.ts`

After creating the postcard and saving images, fire off an analysis call. This runs as fire-and-forget so the webhook returns immediately to the iOS Shortcut.

- [ ] **Step 1: Add the analysis trigger**

In `app/api/webhook/ingest/route.ts`, add the import at the top (after the existing imports):

```typescript
import { analyzePostcard } from "@/lib/anthropic";
import { researchResults } from "@/lib/schema";
```

Then, right before the final `return NextResponse.json(...)` at the end of the POST handler, add:

```typescript
  // Fire-and-forget: trigger AI analysis in the background
  analyzePostcard(savedImages.map((img) => ({
    id: img.id,
    side: img.side,
    filePath: img.filePath,
  }))).then((analysis) => {
    const db = getDb();
    db.insert(researchResults)
      .values({
        postcardId: postcard.id,
        source: "ai_analysis",
        data: JSON.stringify(analysis),
      })
      .run();

    // Backfill postcard fields from analysis
    const c = analysis.classification as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (c.era) {
      const era = c.era as { date_range?: string };
      if (era.date_range) updates.era = era.date_range;
    }
    if (c.condition) {
      const cond = c.condition as { grade?: string };
      if (cond.grade) updates.condition = cond.grade;
    }
    if (c.publisher) {
      const pub = c.publisher as { name?: string | null };
      if (pub.name) updates.publisher = pub.name;
    }
    if (c.location) {
      const loc = c.location as { city?: string | null; state?: string | null; specific_place?: string | null };
      const parts = [loc.specific_place, loc.city, loc.state].filter(Boolean);
      if (parts.length > 0) updates.locationDepicted = parts.join(", ");
    }
    if (c.card_type) {
      const ct = c.card_type as { value?: string };
      if (ct.value) updates.category = ct.value;
    }
    if (c.primary_subject) {
      updates.title = c.primary_subject as string;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = sql`(datetime('now'))`;
      db.update(postcards)
        .set(updates)
        .where(eq(postcards.id, postcard.id))
        .run();
    }
  }).catch((err) => {
    console.error(`Auto-analysis failed for postcard #${postcard.id}:`, err);
  });
```

Also add missing imports at the top of the file — `eq` and `sql` from drizzle-orm, and `postcards` from schema:

```typescript
import { eq, sql } from "drizzle-orm";
```

Update the existing schema import to include `postcards` and `researchResults`:

```typescript
import { postcards, postcardImages, researchResults } from "@/lib/schema";
```

Note: The existing file imports `postcardImages` from `@/lib/schema` — update that import line to also include `postcards` and `researchResults`.

- [ ] **Step 2: Verify build**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhook/ingest/route.ts
git commit -m "feat: auto-trigger AI analysis on webhook ingest"
```

---

### Task 6: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards && npx next dev -p 3099 &
```

Wait for "Ready" message.

- [ ] **Step 2: Test the analyze API with an existing postcard that has images**

Find a postcard with images:

```bash
cd /Users/saturdaysocial/sunshine-postcards && sqlite3 sunshine-postcards.db "SELECT p.id, p.title, COUNT(pi.id) as img_count FROM postcards p LEFT JOIN postcard_images pi ON p.id = pi.postcard_id GROUP BY p.id HAVING img_count > 0 LIMIT 5;"
```

Then call the analyze endpoint (replace `{ID}` with an actual ID):

```bash
curl -s -X POST http://localhost:3099/api/postcards/{ID}/analyze \
  -H "Cookie: sunshine-session=$(curl -s -X POST http://localhost:3099/api/auth/verify -H 'Content-Type: application/json' -d '{"pin":"3193"}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')" | python3 -m json.tool | head -50
```

Expected: JSON response with `analysis` and `postcard` objects. The `analysis.data` field should contain the full structured analysis.

- [ ] **Step 3: Verify the research_results table was populated**

```bash
sqlite3 sunshine-postcards.db "SELECT id, postcard_id, source, length(data) as data_len FROM research_results WHERE source = 'ai_analysis' ORDER BY created_at DESC LIMIT 5;"
```

Expected: At least one row with `source = ai_analysis` and a `data_len` of several thousand characters.

- [ ] **Step 4: Verify postcard fields were backfilled**

```bash
sqlite3 sunshine-postcards.db "SELECT id, title, era, condition, category, publisher, location_depicted FROM postcards WHERE id = {ID};"
```

Expected: Fields that were previously empty should now be populated from the analysis.

- [ ] **Step 5: Stop dev server and push**

```bash
kill %1 2>/dev/null
git push
```

---

## Summary

| Task | What it does | Files |
|------|-------------|-------|
| 1 | Install `@anthropic-ai/sdk` | `package.json` |
| 2 | Claude client + analysis function with system prompt and tool schema | `lib/anthropic.ts` |
| 3 | `POST /api/postcards/[id]/analyze` with field backfill | `app/api/postcards/[id]/analyze/route.ts` |
| 4 | Analyze button, loading state, structured display | `app/inventory/[id]/page.tsx` |
| 5 | Auto-trigger analysis on webhook ingest | `app/api/webhook/ingest/route.ts` |
| 6 | End-to-end verification | (none — test only) |
