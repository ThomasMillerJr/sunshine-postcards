# Feedback Bubble & Logo Fix Design

**Date:** 2026-04-02
**Issues:** #1 (Feedback bubble), #4 (Blank logo + unresponsive PIN)

---

## Issue #4: Fix blank logo + unresponsive PIN on first load

### Root Cause

The `/public/logo.png` is 4.9MB. On first visit with an empty cache, the `<img>` tag in the login page renders blank while the image downloads. Both the login page and navbar use raw `<img>` tags with no optimization. The page feels broken because the dominant visual element is missing during load.

### Solution

1. **Compress `logo.png`** — resize to ~400px wide, compress to <100KB using macOS `sips` or `sharp`. Replace the existing file in `/public/logo.png`.
2. **Switch to `next/image`** in both `app/login/page.tsx` and `app/layout.tsx` with `priority` prop to preload above-the-fold images.
3. **Add explicit `width`/`height` props** to prevent layout shift during load.

### Files Changed

| File | Change |
|------|--------|
| `public/logo.png` | Replaced with compressed version (<100KB) |
| `app/login/page.tsx` | `<img>` → `<Image>` with `priority` |
| `app/layout.tsx` | `<img>` → `<Image>` with `priority` |

---

## Issue #1: Feedback Bubble → GitHub Issues

### Overview

A floating feedback button present on every authenticated page. Clicking opens a modal form. Submitting creates a GitHub issue on `ThomasMillerJr/sunshine-postcards` via a server-side API route.

### Components

#### 1. FeedbackBubble Component (`app/components/FeedbackBubble.tsx`)

- Client component (`"use client"`)
- Fixed position: `bottom-6 right-6`, `z-40` (below navbar's z-50)
- Circular button with inline SVG chat icon
- Styled with gold gradient matching the app's "Add Postcard" button
- On click: toggles modal overlay

#### 2. Feedback Modal (within FeedbackBubble)

- Overlay: semi-transparent backdrop
- Card: white, rounded-2xl, border `#FFF0D4`, shadow matching existing cards
- Fields:
  - **Title** (required): text input, becomes GitHub issue title
  - **Description** (optional): textarea, becomes GitHub issue body
- Buttons: "Submit Feedback" (gold gradient) + "Cancel" (text button)
- States: default, loading (spinner), success (confirmation + auto-close), error (inline message)

#### 3. API Route (`app/api/feedback/route.ts`)

- `POST /api/feedback`
- Protected by existing auth middleware (requires valid session)
- Request body: `{ title: string, description?: string }`
- Validates title is non-empty
- Calls GitHub REST API: `POST https://api.github.com/repos/ThomasMillerJr/sunshine-postcards/issues`
  - Headers: `Authorization: Bearer $GITHUB_TOKEN`, `Accept: application/vnd.github+json`
  - Body: `{ title, body: description, labels: ["feedback"] }`
- Returns `{ success: true, issueUrl: string }` on success
- Returns appropriate error status on failure

#### 4. Layout Integration (`app/layout.tsx`)

- Import and render `<FeedbackBubble />` inside `<body>`, after `<main>`
- Component renders on all pages; auth middleware already protects routes, so the bubble only appears for authenticated users

#### 5. Environment (`ecosystem.config.cjs`)

- New env var: `GITHUB_TOKEN` — Personal Access Token with `repo` scope (or fine-grained with Issues write)
- Placeholder added to PM2 config

### Not in Scope

- Screenshot/attachment support
- Category/label selector (all issues get `feedback` label)
- Anonymous access (PIN-protected like all routes)
- Notification of issue creation to external services

### Design System Compliance

All UI follows existing patterns:
- Colors: gold `#F7B733`, coral `#E8634A`, body bg `#FFFCF5`, card border `#FFF0D4`
- Typography: DM Sans (body), DM Serif Display not needed here
- Borders: 2px, rounded-xl/2xl
- Shadows: `0_2px_8px_rgba(247,183,51,0.06)` for cards
- Buttons: `bg-gradient-to-br from-[#F7B733] to-[#F0A030]` with hover shadow
