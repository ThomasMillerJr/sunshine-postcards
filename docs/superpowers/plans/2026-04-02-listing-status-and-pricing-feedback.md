# Listing Status & Pricing Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add postcard status tracking (inventory/listed/sold/delisted), sales recording UI, and feed sell-through data into the Claude pricing model.

**Architecture:** New `status` column on `postcards` table tracks lifecycle. Status transitions on the detail page create/update `transactions` rows as side effects. A new `lib/sales-history.ts` helper queries past sales and formats them as prompt context for the `scoreAndPrice()` function.

**Tech Stack:** Next.js 16, Drizzle ORM + SQLite, React 19, Tailwind 4, Claude API (Haiku)

**Spec:** `docs/superpowers/specs/2026-04-02-listing-status-and-pricing-feedback-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/schema.ts` | Modify | Add `status` column to `postcards` table |
| `app/api/postcards/[id]/route.ts` | Modify | Handle status transitions + transaction side effects in PUT |
| `app/api/postcards/route.ts` | Modify | Include `status` in GET response (already returned from schema, just verify) |
| `app/inventory/[id]/page.tsx` | Modify | Add status management card with contextual forms |
| `app/inventory/page.tsx` | Modify | Add status filter tabs, extend Postcard interface |
| `lib/sales-history.ts` | Create | Query sales history, format as prompt section |
| `app/api/research/[id]/route.ts` | Modify | Import and inject sales history into pricing prompt |

---

### Task 1: Add status column to schema and push migration

**Files:**
- Modify: `lib/schema.ts`

- [ ] **Step 1: Add the status column to the postcards table**

In `lib/schema.ts`, add after the `notes` field (line 14):

```ts
status: text("status").notNull().default("inventory"),
```

- [ ] **Step 2: Push the schema change to the database**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards
npx drizzle-kit push
```
When prompted, confirm the ALTER TABLE. Expected: column added, all existing rows get `'inventory'` as default.

Verify:
```bash
sqlite3 sunshine-postcards.db "SELECT status, count(*) FROM postcards GROUP BY status;"
```
Expected: all rows show `inventory`.

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add lib/schema.ts
git commit -m "feat: add status column to postcards table (#3)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Handle status transitions in the PUT API route

**Files:**
- Modify: `app/api/postcards/[id]/route.ts`

- [ ] **Step 1: Add transition validation and transaction side effects**

Read `app/api/postcards/[id]/route.ts` first. The existing PUT handler uses an `ALLOWED_FIELDS` whitelist (lines 6-9) and applies updates. We need to add a **separate code path** for status changes that validates transitions and creates/updates transactions.

Add these imports at the top:
```ts
import { postcards, postcardImages, transactions, researchResults } from "@/lib/schema";
import { eq, sql, desc } from "drizzle-orm";
```

Note: `postcards`, `postcardImages`, `transactions`, `researchResults` are already imported. Just add `desc` to the drizzle-orm import if not present.

Add the transition validation map and handler logic. Inside the PUT function, **before** the existing `ALLOWED_FIELDS` loop, add:

```ts
// --- Status transition handling ---
// Status transitions are a dedicated path — do not combine with field updates in the same request.
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

    {
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
  }

  // Return updated postcard with transaction
  const updated = db.select().from(postcards).where(eq(postcards.id, postcardId)).all()[0];
  const txns = db.select().from(transactions).where(eq(transactions.postcardId, postcardId)).orderBy(desc(transactions.createdAt)).all();
  return NextResponse.json({ ...updated, transactions: txns });
}
```

The rest of the existing PUT handler (ALLOWED_FIELDS loop) stays unchanged below this block.

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/api/postcards/[id]/route.ts
git commit -m "feat: add status transition handling with transaction side effects (#3)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add status management card to the detail page

**Files:**
- Modify: `app/inventory/[id]/page.tsx`

This is the largest task — adding the status card UI. Read the full file first to understand the layout structure.

- [ ] **Step 1: Extend the PostcardData interface**

At the top of `app/inventory/[id]/page.tsx`, add `status` to the `PostcardData` interface (after `notes`):

```ts
status: string;
```

Also extend the `transactions` type within the interface to include all fields needed:

```ts
transactions: {
  id: number;
  status: string;
  platform: string;
  listingPrice: number | null;
  soldPrice: number | null;
  fees: number | null;
  profit: number | null;
  listingUrl: string | null;
  listedAt: string | null;
  soldAt: string | null;
}[];
```

- [ ] **Step 2: Add the StatusCard component**

Add this component inside the file, before the main `PostcardDetailPage` export:

```tsx
const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  inventory: { label: "In Inventory", className: "bg-[#F5F0E8] text-[#8A8278]" },
  listed: { label: "Listed", className: "bg-[#FFF4D6] text-[#D4960A]" },
  sold: { label: "Sold", className: "bg-[#E8F5E9] text-[#2E7D32]" },
  delisted: { label: "Delisted", className: "bg-[#FFF0EB] text-[#E8634A]" },
};

function StatusCard({
  postcard,
  onStatusChange,
}: {
  postcard: PostcardData;
  onStatusChange: () => void;
}) {
  const [formMode, setFormMode] = useState<"listed" | "sold" | "edit-sold" | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [soldPrice, setSoldPrice] = useState("");
  const [fees, setFees] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const status = postcard.status || "inventory";
  const badge = STATUS_BADGES[status] || STATUS_BADGES.inventory;
  const latestTxn = postcard.transactions?.[postcard.transactions.length - 1];

  const submitTransition = async (newStatus: string, data: Record<string, unknown> = {}) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/postcards/${postcard.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, ...data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Something went wrong" }));
        setError(err.error || "Something went wrong");
        return;
      }
      setFormMode(null);
      onStatusChange();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleListSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitTransition("listed", {
      listingPrice: parseFloat(listingPrice) || 0,
      listingUrl: listingUrl || undefined,
    });
  };

  const handleSoldSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitTransition("sold", {
      soldPrice: parseFloat(soldPrice) || 0,
      fees: parseFloat(fees) || 0,
    });
  };

  const handleDelist = () => {
    if (confirm("Delist this postcard?")) {
      submitTransition("delisted");
    }
  };

  const handleRelist = () => {
    setListingPrice(latestTxn?.listingPrice?.toString() || "");
    setListingUrl(latestTxn?.listingUrl || "");
    setFormMode("listed");
  };

  const inputClass = "w-full px-3 py-2 border-2 border-[#FFF0D4] rounded-xl text-sm text-[#2D2A26] placeholder-[#B8B0A4] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all";
  const btnPrimary = "bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] transition-all disabled:opacity-50";
  const btnSecondary = "px-4 py-2 text-sm font-medium text-[#8A8278] hover:text-[#2D2A26] transition-colors";

  return (
    <div className="bg-white rounded-2xl border border-[#FFF0D4] shadow-[0_2px_8px_rgba(247,183,51,0.06)] p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#2D2A26]">Listing Status</h3>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      {error && (
        <div className="bg-[#FFF0EB] rounded-lg p-3 text-sm text-[#E8634A] mb-3">{error}</div>
      )}

      {/* Inventory state */}
      {status === "inventory" && !formMode && (
        <button onClick={() => setFormMode("listed")} className={btnPrimary}>
          Mark as Listed
        </button>
      )}

      {/* Listed state */}
      {status === "listed" && !formMode && (
        <div>
          <div className="text-sm text-[#2D2A26] mb-3">
            <span className="text-[#8A8278]">Listed at </span>
            <span className="font-semibold">${latestTxn?.listingPrice?.toFixed(2) || "—"}</span>
            {latestTxn?.listingUrl && (
              <> · <a href={latestTxn.listingUrl} target="_blank" rel="noopener noreferrer" className="text-[#E8634A] hover:underline">View listing</a></>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setFormMode("sold")} className={btnPrimary}>Mark as Sold</button>
            <button onClick={handleDelist} className={btnSecondary}>Delist</button>
          </div>
        </div>
      )}

      {/* Sold state */}
      {status === "sold" && formMode !== "edit-sold" && (
        <div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[#8A8278] text-xs">Sold Price</p>
              <p className="font-semibold text-[#2D2A26]">${latestTxn?.soldPrice?.toFixed(2) || "—"}</p>
            </div>
            <div>
              <p className="text-[#8A8278] text-xs">Fees</p>
              <p className="font-semibold text-[#2D2A26]">${latestTxn?.fees?.toFixed(2) || "0.00"}</p>
            </div>
            <div>
              <p className="text-[#8A8278] text-xs">Profit</p>
              <p className="font-semibold text-[#2E7D32]">${latestTxn?.profit?.toFixed(2) || "—"}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setSoldPrice(latestTxn?.soldPrice?.toString() || "");
              setFees(latestTxn?.fees?.toString() || "");
              setFormMode("edit-sold");
            }}
            className="text-xs text-[#8A8278] hover:text-[#E8634A] mt-2"
          >
            Edit
          </button>
        </div>
      )}

      {/* Delisted state */}
      {status === "delisted" && !formMode && (
        <div>
          <p className="text-sm text-[#8A8278] mb-3">
            Was listed at ${latestTxn?.listingPrice?.toFixed(2) || "—"}
          </p>
          <button onClick={handleRelist} className={btnPrimary}>Relist</button>
        </div>
      )}

      {/* Listed form (for inventory→listed and delisted→listed) */}
      {formMode === "listed" && (
        <form onSubmit={handleListSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#2D2A26] mb-1">Listing Price *</label>
            <input type="number" step="0.01" required value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#2D2A26] mb-1">Listing URL</label>
            <input type="url" value={listingUrl} onChange={(e) => setListingUrl(e.target.value)} placeholder="https://ebay.com/..." className={inputClass} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className={btnPrimary}>{loading ? "Saving..." : "Save"}</button>
            <button type="button" onClick={() => setFormMode(null)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      {/* Sold form (for listed→sold and edit-sold) */}
      {(formMode === "sold" || formMode === "edit-sold") && (
        <form onSubmit={handleSoldSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#2D2A26] mb-1">Sold Price *</label>
            <input type="number" step="0.01" required value={soldPrice} onChange={(e) => setSoldPrice(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#2D2A26] mb-1">Fees</label>
            <input type="number" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" className={inputClass} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className={btnPrimary}>{loading ? "Saving..." : formMode === "edit-sold" ? "Update" : "Mark as Sold"}</button>
            <button type="button" onClick={() => setFormMode(null)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Refactor the data fetch into a named function**

The existing `useEffect` fetch (around line 293-300) is inline. Extract it so `StatusCard` can trigger a refetch:

```tsx
const fetchPostcard = () => {
  fetch(`/api/postcards/${id}`)
    .then((r) => r.json())
    .then((data) => {
      setPostcard(data);
      setForm(data);
    });
};

useEffect(() => { fetchPostcard(); }, [id]);
```

Replace the existing `useEffect` with this pattern.

- [ ] **Step 4: Render StatusCard on the detail page**

Find where the hero section ends and the edit form begins. Insert `<StatusCard>` between them:

```tsx
<StatusCard postcard={postcard} onStatusChange={fetchPostcard} />
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add app/inventory/[id]/page.tsx
git commit -m "feat: add status management card to postcard detail page (#3)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add status filter to inventory page

**Files:**
- Modify: `app/inventory/page.tsx`

- [ ] **Step 1: Extend the Postcard interface**

In `app/inventory/page.tsx`, add `status` to the `Postcard` interface (line 6-20):

```ts
status: string;
```

- [ ] **Step 2: Add status filter state and tab bar**

Add state for the status filter:

```ts
const [statusFilter, setStatusFilter] = useState("All");
```

Add the status filter tabs. Insert a new row of pills **above** the existing category filters (before the `<div className="flex items-center gap-2 mb-4 flex-wrap">` on line 115). Use the same pill styling but with status-specific colors:

```tsx
{/* Status filter */}
<div className="flex items-center gap-2 mb-3">
  {["All", "Inventory", "Listed", "Sold", "Delisted"].map((s) => (
    <button
      key={s}
      onClick={() => setStatusFilter(s)}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
        statusFilter === s
          ? s === "Sold" ? "bg-[#E8F5E9] border-[#2E7D32] text-[#2E7D32] font-semibold"
            : s === "Listed" ? "bg-[#FFF4D6] border-[#D4960A] text-[#D4960A] font-semibold"
            : s === "Delisted" ? "bg-[#FFF0EB] border-[#E8634A] text-[#E8634A] font-semibold"
            : "bg-[#FFF4D6] border-[#F7B733] text-[#8A6A10] font-semibold"
          : "bg-white border-[#FFF0D4] text-[#8A8278] hover:border-[#F7B733] hover:text-[#8A6A10]"
      }`}
    >
      {s}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Add status to the filter logic**

In the existing `filtered` chain (line 71-88), add status filtering. Before the category check:

```ts
if (statusFilter !== "All" && (p.status || "inventory") !== statusFilter.toLowerCase()) return false;
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add app/inventory/page.tsx
git commit -m "feat: add status filter tabs to inventory page (#3)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Create sales history helper for pricing prompt

**Files:**
- Create: `lib/sales-history.ts`

- [ ] **Step 1: Create the helper module**

Create `lib/sales-history.ts`:

```ts
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
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add lib/sales-history.ts
git commit -m "feat: add sales history helper for pricing prompt enrichment (#3)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Inject sales history into the pricing prompt

**Files:**
- Modify: `app/api/research/[id]/route.ts`

- [ ] **Step 1: Import the helper**

At the top of `app/api/research/[id]/route.ts`, add:

```ts
import { buildSalesHistoryContext } from "@/lib/sales-history";
```

- [ ] **Step 2: Inject into the scoreAndPrice prompt**

In the `scoreAndPrice()` function, find the Claude message content (the long template string starting around line 498). The prompt has sections:

1. `MY POSTCARD:` — postcard metadata
2. `EBAY SOLD COMPARABLES:` — eBay comps
3. `Respond in this exact JSON format...` — instructions

Insert the sales history **between** the eBay comps section and the JSON format instructions. Find the line:

```
Respond in this exact JSON format only, no markdown fences, no other text:
```

Insert before it:

```ts
const salesHistory = buildSalesHistoryContext();
```

Then in the template string, add `${salesHistory}` with a blank line before the `Respond in this exact JSON format...` line:

```
${compsForPrompt || "No comparables found."}
${salesHistory}

Respond in this exact JSON format only, no markdown fences, no other text:
```

When there is no sales history, `buildSalesHistoryContext()` returns an empty string, so the prompt is unchanged.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/api/research/[id]/route.ts
git commit -m "feat: inject sales history into Claude pricing prompt (#3)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Deploy and verify

- [ ] **Step 1: Rebuild and restart PM2**

```bash
cd /Users/saturdaysocial/sunshine-postcards
npm run build && pm2 restart sunshine-postcards
```

- [ ] **Step 2: Verify status lifecycle**

1. Open a postcard detail page
2. Confirm "In Inventory" badge + "Mark as Listed" button
3. Click "Mark as Listed", enter a price, submit
4. Confirm badge changes to "Listed" with price displayed
5. Click "Mark as Sold", enter sold price + fees, submit
6. Confirm badge changes to "Sold" with profit calculation shown

- [ ] **Step 3: Verify inventory page filters**

1. Go to the inventory page
2. Confirm status filter tabs appear above category filters
3. Click "Listed" — only listed postcards shown
4. Click "All" — all postcards shown

- [ ] **Step 4: Push**

```bash
git push
```
