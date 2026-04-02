# Feedback Bubble & Logo Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blank logo on first load (issue #4) and add a floating feedback bubble that creates GitHub issues (issue #1).

**Architecture:** Two independent changes. Task 1 compresses the 4.9MB logo and switches to `next/image`. Tasks 2-4 add a feedback bubble component, API route, and layout integration. No shared dependencies between the two issues.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, GitHub REST API

**Spec:** `docs/superpowers/specs/2026-04-02-feedback-bubble-and-logo-fix-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `public/logo.png` | Replace | Compressed logo (~400px wide, <100KB) |
| `app/login/page.tsx` | Modify | Switch `<img>` to `<Image>` with `priority` |
| `app/layout.tsx` | Modify | Switch `<img>` to `<Image>`, add `<FeedbackBubble />` |
| `app/api/feedback/route.ts` | Create | POST endpoint that creates GitHub issues |
| `app/components/FeedbackBubble.tsx` | Create | Floating button + modal form |
| `.env.local` | Modify | Add `GITHUB_TOKEN` |

---

### Task 1: Compress logo and switch to next/image

**Files:**
- Replace: `public/logo.png`
- Modify: `app/login/page.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Compress the logo**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards
sips -Z 400 public/logo.png --out public/logo.png
```

This resizes to max 400px on the longest side (becomes 400x218) and overwrites in place. Verify:
```bash
sips -g pixelWidth -g pixelHeight -g all public/logo.png | head -5
ls -lh public/logo.png
```
Expected: ~400x218px, well under 100KB.

- [ ] **Step 2: Update login page to use next/image**

In `app/login/page.tsx`, add the import and replace the `<img>` tag:

```tsx
// Add at top, after other imports:
import Image from "next/image";

// Replace the <img> tag (line 64-67) with:
<Image
  src="/logo.png"
  alt="Sunshine Postcards"
  width={200}
  height={109}
  className="mx-auto mb-6"
  priority
/>
```

Note: `h-20` class removed — `width`/`height` props control sizing. 200px wide at 1.83:1 ratio = 109px tall (close to the original `h-20` = 80px, but sharper on retina).

- [ ] **Step 3: Update layout navbar to use next/image**

In `app/layout.tsx`, add the import and replace the `<img>` tag:

```tsx
// Add at top:
import Image from "next/image";

// Replace the <img> tag (line 20) with:
<Image src="/logo.png" alt="Sunshine Postcards" width={120} height={65} priority />
```

Note: `h-9` class removed — 120x65 renders close to the original 36px height at retina density.

- [ ] **Step 4: Build and verify**

Run:
```bash
cd /Users/saturdaysocial/sunshine-postcards
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add public/logo.png app/login/page.tsx app/layout.tsx
git commit -m "fix: compress logo and use next/image to fix blank icon on first load (#4)"
```

---

### Task 2: Create the feedback API route

**Files:**
- Create: `app/api/feedback/route.ts`

- [ ] **Step 1: Create the API route**

Create `app/api/feedback/route.ts`:

```tsx
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Feedback not configured" },
      { status: 500 }
    );
  }

  let body: { title?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim();
  const description = body.description?.trim() || "";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json(
      { error: "Title must be 200 characters or less" },
      { status: 400 }
    );
  }
  if (description.length > 5000) {
    return NextResponse.json(
      { error: "Description must be 5000 characters or less" },
      { status: 400 }
    );
  }

  const res = await fetch(
    "https://api.github.com/repos/ThomasMillerJr/sunshine-postcards/issues",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        body: description || undefined,
        labels: ["feedback"],
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error("GitHub API error:", res.status, error);
    return NextResponse.json(
      { error: "Failed to create issue" },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({
    success: true,
    issueUrl: data.html_url,
  });
}
```

- [ ] **Step 2: Create the `feedback` label on the GitHub repo**

Run:
```bash
gh label create feedback --description "User feedback from the app" --color F7B733 --repo ThomasMillerJr/sunshine-postcards
```
Expected: Label created. If it already exists, the command will fail harmlessly.

Note: GitHub silently ignores nonexistent labels (returns 201, just omits the label). Pre-creating ensures issues actually get labeled.

- [ ] **Step 3: Verify middleware protects the route**

Confirm `/api/feedback` is NOT in `PUBLIC_PATHS` in `middleware.ts` (line 9). It should not be — the route is automatically protected. Do not modify middleware.

- [ ] **Step 4: Build and verify**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/api/feedback/route.ts
git commit -m "feat: add /api/feedback route to create GitHub issues (#1)"
```

---

### Task 3: Create the FeedbackBubble component

**Files:**
- Create: `app/components/FeedbackBubble.tsx`

- [ ] **Step 1: Create the component**

Create the `app/components/` directory (new — first shared component) and `app/components/FeedbackBubble.tsx`:

```tsx
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

export default function FeedbackBubble() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (pathname === "/login") return null;

  const reset = () => {
    setTitle("");
    setDescription("");
    setError("");
    setSuccess(false);
  };

  const handleClose = () => {
    setOpen(false);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:shadow-[0_6px_16px_rgba(247,183,51,0.5)] hover:-translate-y-0.5 transition-all flex items-center justify-center"
        aria-label="Send feedback"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={handleClose}>
          <div
            className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(247,183,51,0.1)] border border-[#FFF0D4] p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {success ? (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">&#10003;</div>
                <p className="text-[#2D2A26] font-medium">Feedback submitted!</p>
                <p className="text-[#8A8278] text-sm mt-1">A GitHub issue has been created.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h2 className="text-lg font-semibold text-[#2D2A26] mb-4">Send Feedback</h2>

                <label className="block text-sm font-medium text-[#2D2A26] mb-1">
                  Title <span className="text-[#E8634A]">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  required
                  placeholder="What's on your mind?"
                  className="w-full px-3 py-2 border-2 border-[#FFF0D4] rounded-xl text-sm text-[#2D2A26] placeholder-[#B8B0A4] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all mb-3"
                />

                <label className="block text-sm font-medium text-[#2D2A26] mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={5000}
                  rows={4}
                  placeholder="Tell us more (optional)"
                  className="w-full px-3 py-2 border-2 border-[#FFF0D4] rounded-xl text-sm text-[#2D2A26] placeholder-[#B8B0A4] focus:border-[#F7B733] focus:ring-2 focus:ring-[#F7B73340] focus:outline-none transition-all mb-4 resize-none"
                />

                {error && (
                  <div className="bg-[#FFF0EB] rounded-lg p-3 text-sm text-[#E8634A] mb-3">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-[#8A8278] hover:text-[#2D2A26] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !title.trim()}
                    className="bg-gradient-to-br from-[#F7B733] to-[#F0A030] text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-[0_2px_8px_rgba(247,183,51,0.25)] hover:shadow-[0_4px_12px_rgba(247,183,51,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[0_2px_8px_rgba(247,183,51,0.25)]"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      "Submit Feedback"
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/FeedbackBubble.tsx
git commit -m "feat: add FeedbackBubble component with modal form (#1)"
```

---

### Task 4: Integrate FeedbackBubble into layout and add GITHUB_TOKEN

**Files:**
- Modify: `app/layout.tsx`
- Modify: `.env.local`

- [ ] **Step 1: Add FeedbackBubble to layout**

In `app/layout.tsx`, add the import and render after `<main>`:

```tsx
// Add at top, with other imports:
import FeedbackBubble from "./components/FeedbackBubble";

// Add <FeedbackBubble /> after </main>, before </body>:
        </main>
        <FeedbackBubble />
      </body>
```

- [ ] **Step 2: Add GITHUB_TOKEN to .env.local**

Append to `.env.local`:
```
GITHUB_TOKEN=<user-must-provide-token>
```

The user needs to generate a GitHub Personal Access Token at https://github.com/settings/tokens with `repo` scope (or fine-grained with Issues write permission on `ThomasMillerJr/sunshine-postcards`).

- [ ] **Step 3: Build and verify**

Run:
```bash
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit layout change (do not commit .env.local)**

```bash
git add app/layout.tsx
git commit -m "feat: integrate FeedbackBubble into root layout (#1)"
```

---

### Task 5: Deploy and manually verify

- [ ] **Step 1: Rebuild and restart PM2**

```bash
cd /Users/saturdaysocial/sunshine-postcards
npm run build && pm2 restart sunshine-postcards
```

- [ ] **Step 2: Verify issue #4 — logo loads instantly**

Open the site in an incognito/private browser window (empty cache). The logo should appear immediately on the login page — no blank state.

- [ ] **Step 3: Verify issue #1 — feedback bubble works**

After logging in:
1. Confirm the gold feedback bubble is visible in the bottom-right corner
2. Confirm the bubble is NOT visible on the `/login` page
3. Click the bubble, fill in title + description, submit
4. Confirm a new GitHub issue appears at `github.com/ThomasMillerJr/sunshine-postcards/issues` with the `feedback` label

- [ ] **Step 4: Push**

```bash
git push
```
