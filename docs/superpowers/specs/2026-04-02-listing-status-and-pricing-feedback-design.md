# Listing Status & Pricing Feedback Design

**Date:** 2026-04-02
**Issue:** #3 — How to include listing status, sold price, etc. to feed the decision making model

---

## Overview

Add a postcard status lifecycle (inventory → listed → sold/delisted), a sales recording UI on the detail page, and inject the user's sales history into the Claude pricing prompt so recommendations improve over time with real sell-through data.

---

## 1. Postcard Status Lifecycle

### New Column

`postcards.status` — TEXT, DEFAULT `'inventory'`

Values:
- `inventory` — scanned, not yet listed
- `listed` — on eBay (has listing price + URL)
- `sold` — sale completed (has sold price, fees, date)
- `delisted` — was listed but removed/expired

### Transitions

- `inventory` → `listed`
- `listed` → `sold`
- `listed` → `delisted`
- `delisted` → `listed` (relist)

### Migration

New migration file `lib/migrations/0001_postcard_status.sql`:
```sql
ALTER TABLE postcards ADD COLUMN status TEXT NOT NULL DEFAULT 'inventory';
```

All existing postcards default to `inventory`.

### Schema Update

Add `status` field to the `postcards` table definition in `lib/schema.ts`.

### Files Changed

| File | Change |
|------|--------|
| `lib/schema.ts` | Add `status` column to `postcards` table |
| `lib/migrations/0001_postcard_status.sql` | New migration file |

---

## 2. Sales Recording UI

### Location

New **status management card** on the postcard detail page (`app/inventory/[id]/page.tsx`), placed between the hero section and the edit form.

### State-Dependent Display

**When `inventory`:**
- Status badge: "In Inventory" (muted/default)
- Button: "Mark as Listed"
- On click: inline form with listing price (required), listing URL (optional), date listed (defaults to today)
- Submit: creates transaction with `status: 'listed'`, updates `postcards.status` to `'listed'`

**When `listed`:**
- Status badge: "Listed" (gold)
- Shows listing price + clickable URL link
- Button: "Mark as Sold" → inline form: sold price (required), fees (optional, defaults to 0), date sold (defaults to today)
  - Submit: updates transaction to `status: 'sold'`, calculates `profit = soldPrice - fees`, updates `postcards.status` to `'sold'`
- Button: "Delist" → confirm → updates transaction to `status: 'delisted'`, updates `postcards.status` to `'delisted'`

**When `sold`:**
- Status badge: "Sold" (green)
- Read-only summary: sold price, fees, profit, date
- Small "Edit" link to correct mistakes (reopens the sold form pre-filled)

**When `delisted`:**
- Status badge: "Delisted" (coral)
- Shows previous listing info
- Button: "Relist" → re-opens listed form pre-filled with previous listing price/URL

### Transaction Model

One postcard = one active transaction at a time (the latest). Each status transition creates or updates a row in the existing `transactions` table. The transaction stores the financial data; `postcards.status` is the display state.

### API Changes

`PUT /api/postcards/[id]` already supports updating postcard fields. Extend it to accept `status` along with optional transaction data (`listingPrice`, `listingUrl`, `listedAt`, `soldPrice`, `fees`, `soldAt`). When status changes, the route creates/updates the corresponding transaction.

### Files Changed

| File | Change |
|------|--------|
| `app/inventory/[id]/page.tsx` | Add status management card with contextual forms |
| `app/api/postcards/[id]/route.ts` | Handle status transitions + transaction creation/updates |

---

## 3. Inventory Page Status Filter

Add a filter bar to the inventory list page (`app/inventory/page.tsx`).

### Filter Options

Horizontal pill/tab bar above the postcard grid:
- **All** (default)
- **Inventory** — `status = 'inventory'`
- **Listed** — `status = 'listed'`
- **Sold** — `status = 'sold'`
- **Delisted** — `status = 'delisted'`

### API Changes

`GET /api/postcards` needs to accept an optional `status` query parameter to filter results.

### Files Changed

| File | Change |
|------|--------|
| `app/inventory/page.tsx` | Add status filter tabs |
| `app/api/postcards/route.ts` | Accept `status` query param for filtering |

---

## 4. Enriched Pricing Prompt

### Data Query

Before calling `scoreAndPrice()` in the research pipeline, query the user's sales history:

```sql
SELECT p.title, p.category, p.era, p.condition, p.locationDepicted,
       t.soldPrice, t.listingPrice, t.fees, t.status, t.soldAt, t.listedAt
FROM transactions t
JOIN postcards p ON p.id = t.postcardId
WHERE t.status IN ('sold', 'listed', 'delisted')
ORDER BY t.soldAt DESC NULLS LAST, t.listedAt DESC
LIMIT 50
```

Returns the user's last 50 transactions with postcard metadata for context.

### Prompt Injection

Add a new section to the Claude pricing system prompt in `scoreAndPrice()`, after the eBay comps but before the pricing instructions:

```
YOUR SALES HISTORY (from your own inventory):
These are postcards YOU listed and sold. Weight these higher than eBay comps
when the category/era/condition match — they reflect YOUR actual market.

[YOUR SALE] "1920s Linen Postcard - Greetings from Miami" (era: 1920s, condition: Good) — Sold $7.50 (listed $9.99, sold 2026-03-15)
[YOUR LISTED] "1930s Chrome Postcard - Hotel Marlin" (era: 1930s, condition: Very Good) — Listed $12.00 (no sale yet, listed 2026-03-01)
[YOUR DELISTED] "1950s Photochrome - Beach Scene" (era: 1950s, condition: Fair) — Delisted after 30 days at $15.00 (overpriced signal)

Consider:
- [YOUR SALE] items: actual clearing prices for similar cards from this seller
- [YOUR LISTED] items: current asking prices (may be too high if not selling)
- [YOUR DELISTED] items: prices that didn't convert — suggests the market ceiling
```

### When No Sales History Exists

The section is omitted entirely. The pipeline works exactly as it does today. As sales accumulate, recommendations get progressively better.

### Files Changed

| File | Change |
|------|--------|
| `app/api/research/[id]/route.ts` | Query sales history, format as prompt section, inject into Claude call |

---

## 5. Design System Compliance

Status badges follow existing patterns:
- **Inventory**: `bg-[#F5F0E8] text-[#8A8278]` (muted, default)
- **Listed**: `bg-[#FFF4D6] text-[#D4960A]` (gold, active)
- **Sold**: `bg-[#E8F5E9] text-[#2E7D32]` (green, complete)
- **Delisted**: `bg-[#FFF0EB] text-[#E8634A]` (coral, removed)

Forms use existing input styles: 2px borders, `#FFF0D4` border color, rounded-xl, gold focus ring.

Filter tabs use the existing nav tab pattern from the layout navbar.

---

## Not in Scope

- eBay API auto-sync / webhook integration (future work)
- Sales analytics dashboard (separate project)
- Bulk status changes
- Multiple concurrent transactions per postcard
- Historical transaction log (one active transaction per postcard)
