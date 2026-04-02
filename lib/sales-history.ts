import { getDb } from "@/lib/db";
import { transactions, postcards } from "@/lib/schema";
import { eq, inArray, desc, sql } from "drizzle-orm";

interface SalesHistoryItem {
  title: string;
  category: string;
  era: string;
  condition: string;
  locationDepicted: string | null;
  txnStatus: string;
  listingPrice: number | null;
  soldPrice: number | null;
  fees: number | null;
  listedAt: string | null;
  soldAt: string | null;
}

export function buildSalesHistoryContext(): string {
  const db = getDb();

  const results = db
    .select({
      title: postcards.title,
      category: postcards.category,
      era: postcards.era,
      condition: postcards.condition,
      locationDepicted: postcards.locationDepicted,
      txnStatus: transactions.status,
      listingPrice: transactions.listingPrice,
      soldPrice: transactions.soldPrice,
      fees: transactions.fees,
      listedAt: transactions.listedAt,
      soldAt: transactions.soldAt,
    })
    .from(transactions)
    .innerJoin(postcards, eq(transactions.postcardId, postcards.id))
    .where(inArray(transactions.status, ["sold", "listed", "delisted"]))
    .orderBy(
      sql`${transactions.soldAt} IS NULL`,
      desc(transactions.soldAt),
      desc(transactions.listedAt)
    )
    .limit(50)
    .all() as SalesHistoryItem[];

  if (results.length === 0) return "";

  const lines = results.map((r) => {
    const meta = `(era: ${r.era || "unknown"}, condition: ${r.condition || "unknown"})`;
    if (r.txnStatus === "sold") {
      return `[YOUR SALE] "${r.title}" ${meta} — Sold $${r.soldPrice?.toFixed(2) || "?"} (listed $${r.listingPrice?.toFixed(2) || "?"}, sold ${r.soldAt || "?"})`;
    }
    if (r.txnStatus === "listed") {
      return `[YOUR LISTED] "${r.title}" ${meta} — Listed $${r.listingPrice?.toFixed(2) || "?"} (no sale yet, listed ${r.listedAt || "?"})`;
    }
    // delisted
    return `[YOUR DELISTED] "${r.title}" ${meta} — Delisted at $${r.listingPrice?.toFixed(2) || "?"} (overpriced signal)`;
  });

  return `
YOUR SALES HISTORY (from your own inventory):
These are postcards YOU listed and sold. Weight these higher than eBay comps
when the category/era/condition match — they reflect YOUR actual market.

${lines.join("\n")}

Consider:
- [YOUR SALE] items: actual clearing prices for similar cards from this seller
- [YOUR LISTED] items: current asking prices (may be too high if not selling)
- [YOUR DELISTED] items: prices that didn't convert — suggests the market ceiling`;
}
