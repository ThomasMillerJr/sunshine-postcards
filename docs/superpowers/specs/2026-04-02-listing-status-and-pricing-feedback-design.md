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

All other transitions are **invalid** and must be rejected by the API with 422: `"Invalid status transition from '{from}' to '{to}'"`. For example, `inventory` → `sold` (must list first) and `sold` → `listed` (sold is terminal) are not allowed.

### Migration

Update `lib/schema.ts` to add the `status` column, then apply with `npx drizzle-kit push` (the existing pattern — no migration files are run manually, Drizzle diffs the schema against the DB). All existing postcards default to `inventory`.

### Schema Update

Add `status` field to the `postcards` table definition in `lib/schema.ts`.

### Files Changed

| File | Change |
|------|--------|
| `lib/schema.ts` | Add `status` column to `postcards` table |

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

One postcard = one active transaction at a time. Each status transition creates or updates a row in the existing `transactions` table:

- `inventory` → `listed`: **Creates** a new transaction row with `status: 'listed'`, `listingPrice`, `listingUrl`, `listedAt`
- `listed` → `sold`: **Updates** the existing transaction to `status: 'sold'`, adds `soldPrice`, `fees`, `soldAt`, calculates `profit`
- `listed` → `delisted`: **Updates** the existing transaction to `status: 'delisted'`
- `delisted` → `listed` (relist): **Updates** the same transaction row back to `status: 'listed'` with new listing data

**Source of truth**: `postcards.status` is canonical for display/filtering. `transactions.status` tracks the financial state. Both must be written atomically in the same API handler. The status card reads from `postcards.status`; the pricing prompt reads from `transactions` joined with `postcards`.

Profit calculation follows the existing pattern: `profit = soldPrice - fees` (simplified, matches existing `POST /api/transactions` logic).

### API Changes

`PUT /api/postcards/[id]` already supports updating postcard fields via an `ALLOWED_FIELDS` whitelist. Status changes need **separate handling** — do NOT just add `'status'` to the whitelist. Instead, add a dedicated code path: if the request body includes `status`, validate the transition, then create/update the transaction as a side effect. The transaction data (`listingPrice`, `listingUrl`, `listedAt`, `soldPrice`, `fees`, `soldAt`) comes from the same request body.

The `Postcard` TypeScript interface on the inventory and detail pages must be extended to include `status`, and the `GET /api/postcards` response must include it.

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

### Filtering Approach

Client-side filtering. The inventory page already fetches all postcards at once (`?limit=500`) and does client-side category filtering. Adding status filtering follows the same pattern — filter the already-loaded data by `status` field. No API changes needed for this section.

### Files Changed

| File | Change |
|------|--------|
| `app/inventory/page.tsx` | Add status filter tabs, extend `Postcard` interface with `status` |

---

## 4. Enriched Pricing Prompt

### Data Query

Before calling `scoreAndPrice()` in the research pipeline, query the user's sales history using **Drizzle ORM** (not raw SQL — follow the existing codebase pattern). Pseudocode:

```
transactions JOIN postcards ON postcardId
WHERE transactions.status IN ('sold', 'listed', 'delisted')
ORDER BY soldAt DESC NULLS LAST, listedAt DESC
LIMIT 50
```

Returns the user's last 50 transactions with postcard metadata (title, category, era, condition, location) for context. Since we use one transaction per postcard (relisting updates the same row), there are no duplicates to worry about.

**Extract this into a helper function** (e.g., `buildSalesHistoryContext()` in `lib/sales-history.ts`) to avoid bloating the already-large research route (750+ lines).

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
| `lib/sales-history.ts` | New file: `buildSalesHistoryContext()` — query + format sales data for prompt |
| `app/api/research/[id]/route.ts` | Import helper, inject sales history section into Claude pricing call |

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
