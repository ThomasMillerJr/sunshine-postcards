import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, researchResults } from "@/lib/schema";
import { desc, eq, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const results = db
    .select()
    .from(postcards)
    .orderBy(desc(postcards.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Attach first image (prefer front) for each postcard
  const allImages = db.select().from(postcardImages).all();
  const imageMap = new Map<number, number>();
  for (const img of allImages) {
    if (!imageMap.has(img.postcardId) || img.side === "front") {
      imageMap.set(img.postcardId, img.id);
    }
  }

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

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(postcards)
    .all();
  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({ postcards: withThumbnails, total });
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();

  const result = db.insert(postcards).values({
    title: body.title || "",
    description: body.description || "",
    category: body.category || "",
    era: body.era || "",
    condition: body.condition || "",
    locationDepicted: body.locationDepicted || null,
    publisher: body.publisher || null,
    estimatedValue: body.estimatedValue || null,
    notes: body.notes || null,
  }).returning().all();

  return NextResponse.json(result[0], { status: 201 });
}
