import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { transactions } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const postcardId = searchParams.get("postcardId");

  if (postcardId) {
    const results = db
      .select()
      .from(transactions)
      .where(eq(transactions.postcardId, parseInt(postcardId)))
      .orderBy(desc(transactions.createdAt))
      .all();
    return NextResponse.json(results);
  }

  const results = db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.createdAt))
    .all();
  return NextResponse.json(results);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();

  let profit = null;
  if (body.soldPrice != null && body.fees != null) {
    profit = body.soldPrice - body.fees;
  }

  const result = db
    .insert(transactions)
    .values({
      postcardId: body.postcardId,
      status: body.status || "listed",
      platform: body.platform || "ebay",
      listingPrice: body.listingPrice || null,
      soldPrice: body.soldPrice || null,
      fees: body.fees || null,
      profit,
      listingUrl: body.listingUrl || null,
      listedAt: body.listedAt || null,
      soldAt: body.soldAt || null,
      notes: body.notes || null,
    })
    .returning()
    .all();

  return NextResponse.json(result[0], { status: 201 });
}
