import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, transactions, researchResults } from "@/lib/schema";
import { eq, sql, desc } from "drizzle-orm";

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

  // --- Status transition handling (separate path — do not combine with field updates) ---
  const VALID_TRANSITIONS: Record<string, string[]> = {
    inventory: ["listed"],
    listed: ["sold", "delisted"],
    sold: ["sold"],       // self-transition allowed for editing sold details
    delisted: ["listed"],
  };

  if ("status" in body) {
    const postcardId = parseInt(id);

    // Get current postcard
    const current = db
      .select()
      .from(postcards)
      .where(eq(postcards.id, postcardId))
      .all()[0];

    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const currentStatus = current.status || "inventory";
    const newStatus = body.status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed || !allowed.includes(newStatus)) {
      return NextResponse.json(
        { error: `Invalid status transition from '${currentStatus}' to '${newStatus}'` },
        { status: 422 }
      );
    }

    // Update postcard status
    db.update(postcards)
      .set({ status: newStatus, updatedAt: sql`(datetime('now'))` })
      .where(eq(postcards.id, postcardId))
      .run();

    // Handle transaction side effects
    if (currentStatus === "inventory" && newStatus === "listed") {
      // Create new transaction
      db.insert(transactions).values({
        postcardId,
        status: "listed",
        listingPrice: body.listingPrice ?? null,
        listingUrl: body.listingUrl ?? null,
        listedAt: body.listedAt ?? new Date().toISOString().split("T")[0],
      }).run();
    } else {
      // Update existing transaction (latest for this postcard)
      const existingTxn = db
        .select()
        .from(transactions)
        .where(eq(transactions.postcardId, postcardId))
        .orderBy(desc(transactions.createdAt))
        .limit(1)
        .all()[0];

      if (!existingTxn) {
        return NextResponse.json(
          { error: "No transaction found for this postcard" },
          { status: 422 }
        );
      }

      if (newStatus === "sold") {
        const soldPrice = body.soldPrice ?? null;
        const fees = body.fees ?? 0;
        const profit = soldPrice != null ? soldPrice - fees : null;
        db.update(transactions)
          .set({
            status: "sold",
            soldPrice,
            fees,
            profit,
            soldAt: body.soldAt ?? new Date().toISOString().split("T")[0],
          })
          .where(eq(transactions.id, existingTxn.id))
          .run();
      } else if (newStatus === "delisted") {
        db.update(transactions)
          .set({ status: "delisted" })
          .where(eq(transactions.id, existingTxn.id))
          .run();
      } else if (newStatus === "listed") {
        // Relist: update existing transaction back to listed
        db.update(transactions)
          .set({
            status: "listed",
            listingPrice: body.listingPrice ?? existingTxn.listingPrice,
            listingUrl: body.listingUrl ?? existingTxn.listingUrl,
            listedAt: body.listedAt ?? new Date().toISOString().split("T")[0],
            soldPrice: null,
            fees: null,
            profit: null,
            soldAt: null,
          })
          .where(eq(transactions.id, existingTxn.id))
          .run();
      }
    }

    // Return updated postcard with transaction
    const updated = db.select().from(postcards).where(eq(postcards.id, postcardId)).all()[0];
    const txns = db.select().from(transactions).where(eq(transactions.postcardId, postcardId)).orderBy(desc(transactions.createdAt)).all();
    return NextResponse.json({ ...updated, transactions: txns });
  }

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
