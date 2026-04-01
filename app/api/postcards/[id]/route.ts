import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, transactions, researchResults } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

const ALLOWED_FIELDS = [
  "title", "description", "category", "era", "condition",
  "locationDepicted", "publisher", "estimatedValue", "notes",
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const results = db
    .select()
    .from(postcards)
    .where(eq(postcards.id, parseInt(id)))
    .all();
  const postcard = results[0];

  if (!postcard) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const images = db
    .select()
    .from(postcardImages)
    .where(eq(postcardImages.postcardId, parseInt(id)))
    .all();

  const txns = db
    .select()
    .from(transactions)
    .where(eq(transactions.postcardId, parseInt(id)))
    .all();

  const research = db
    .select()
    .from(researchResults)
    .where(eq(researchResults.postcardId, parseInt(id)))
    .all();

  return NextResponse.json({ ...postcard, images, transactions: txns, research });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  updates.updatedAt = sql`(datetime('now'))`;

  const result = db
    .update(postcards)
    .set(updates)
    .where(eq(postcards.id, parseInt(id)))
    .returning()
    .all();

  if (!result.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(result[0]);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;

  const result = db
    .delete(postcards)
    .where(eq(postcards.id, parseInt(id)))
    .returning()
    .all();

  if (!result.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
