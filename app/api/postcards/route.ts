import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards } from "@/lib/schema";
import { desc, sql } from "drizzle-orm";

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

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(postcards)
    .all();
  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({ postcards: results, total });
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
