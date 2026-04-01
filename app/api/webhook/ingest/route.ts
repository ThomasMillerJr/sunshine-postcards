import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, researchResults } from "@/lib/schema";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { analyzePostcard, detectCrop } from "@/lib/anthropic";
import { eq, sql } from "drizzle-orm";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const files: File[] = [];

  // Collect all image files — iOS Shortcuts sends as "front", "back", or "images"
  for (const key of ["front", "back", "images"]) {
    const entries = formData.getAll(key);
    for (const entry of entries) {
      if (entry instanceof File && ALLOWED_TYPES.includes(entry.type)) {
        files.push(entry);
      }
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No valid image files provided. Send as 'front', 'back', or 'images' fields (JPEG, PNG, WebP, HEIC)." },
      { status: 400 }
    );
  }

  const db = getDb();
  await mkdir(UPLOADS_DIR, { recursive: true });

  // Create a postcard with a timestamp title (AI analysis will fill metadata later)
  const now = new Date();
  const label = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const [postcard] = db
    .insert(postcards)
    .values({ title: `New Postcard — ${label}` })
    .returning()
    .all();

  // Save each image
  const savedImages = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${randomUUID()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(filePath, bytes);

    // First file = front, second = back, rest = front
    const side = i === 1 ? "back" : "front";

    const [image] = db
      .insert(postcardImages)
      .values({
        postcardId: postcard.id,
        side,
        filePath: filename,
        originalFilename: file.name,
      })
      .returning()
      .all();

    savedImages.push(image);

    // Fire-and-forget crop detection per image
    detectCrop(filename).then((crop) => {
      if (crop) {
        const db = getDb();
        db.update(postcardImages)
          .set({ cropBox: JSON.stringify(crop) })
          .where(eq(postcardImages.id, image.id))
          .run();
      }
    }).catch((err) => console.error("Crop detection failed:", err));
  }

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

  return NextResponse.json(
    {
      postcard,
      images: savedImages,
      message: `Created postcard #${postcard.id} with ${savedImages.length} image(s)`,
    },
    { status: 201 }
  );
}
