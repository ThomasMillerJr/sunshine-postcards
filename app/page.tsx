import { getDb } from "@/lib/db";
import { postcards, transactions } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = getDb();

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(postcards)
    .all();
  const totalPostcards = countResult[0]?.count ?? 0;

  const soldTxns = db
    .select({ total: sql<number>`count(*)`, revenue: sql<number>`sum(sold_price)` })
    .from(transactions)
    .where(eq(transactions.status, "sold"))
    .all()[0];

  const listedTxns = db
    .select({ total: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.status, "listed"))
    .all()[0];

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg p-6 shadow-sm border">
          <p className="text-gray-500 text-sm">Total Postcards</p>
          <p className="text-3xl font-bold mt-1">{totalPostcards}</p>
        </div>
        <div className="bg-white rounded-lg p-6 shadow-sm border">
          <p className="text-gray-500 text-sm">Currently Listed</p>
          <p className="text-3xl font-bold mt-1">{listedTxns?.total || 0}</p>
        </div>
        <div className="bg-white rounded-lg p-6 shadow-sm border">
          <p className="text-gray-500 text-sm">Total Revenue</p>
          <p className="text-3xl font-bold mt-1">${(soldTxns?.revenue || 0).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}
