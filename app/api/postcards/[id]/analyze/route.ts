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
