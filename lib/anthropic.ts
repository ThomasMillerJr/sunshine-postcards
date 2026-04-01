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

function getMediaType(ext: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const map: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return map[ext] || "image/jpeg";
}

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

  const sideLabels = images.map((img, i) => `Image ${i + 1}: ${img.side} of card`).join("\n");

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

  const toolBlock = response.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use response");
  }

  return toolBlock.input as AnalysisResult;
}
