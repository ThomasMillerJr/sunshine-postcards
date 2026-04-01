import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { transactions } from "@/lib/schema";
import { eq } from "drizzle-orm";

const ALLOWED_FIELDS = [
  "status", "platform", "listingPrice", "soldPrice", "fees",
  "listingUrl", "listedAt", "soldAt", "notes",
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const results = db
    .select()
    .from(transactions)
    .where(eq(transactions.id, parseInt(id)))
    .all();
  const txn = results[0];

  if (!txn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(txn);
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

  if (body.soldPrice !== undefined || body.fees !== undefined) {
    const existing = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parseInt(id)))
      .all()[0];
    if (existing) {
      const soldPrice = body.soldPrice ?? existing.soldPrice;
      const fees = body.fees ?? existing.fees;
      if (soldPrice != null && fees != null) {
        updates.profit = soldPrice - fees;
      }
    }
  }

  const result = db
    .update(transactions)
    .set(updates)
    .where(eq(transactions.id, parseInt(id)))
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
    .delete(transactions)
    .where(eq(transactions.id, parseInt(id)))
    .returning()
    .all();

  if (!result.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
