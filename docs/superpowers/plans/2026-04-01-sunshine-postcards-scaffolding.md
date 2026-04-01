# Sunshine Postcards — Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a working Next.js app with SQLite database, PIN authentication, CRUD API routes, and basic functional UI pages — ready for a future design polish pass.

**Architecture:** Next.js 16 monolith with SQLite (better-sqlite3 + Drizzle ORM), 4-digit PIN auth via JWT cookies, local photo storage. Runs on Mac mini behind Cloudflare tunnel on port 3005.

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS v4, better-sqlite3, Drizzle ORM, jose (JWT), PM2

**Spec:** `docs/superpowers/specs/2026-04-01-sunshine-postcards-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript config (strict, @/* paths) |
| `next.config.ts` | Next.js config (webpack external for better-sqlite3) |
| `drizzle.config.ts` | Drizzle ORM config pointing to SQLite |
| `ecosystem.config.cjs` | PM2 process config (port 3005) |
| `.env.local` | APP_PIN, JWT_SECRET |
| `.gitignore` | Node, Next.js, uploads/, *.db |
| `middleware.ts` | JWT session validation, redirect to /login |
| `lib/db.ts` | SQLite lazy singleton via better-sqlite3 (use `getDb()`) |
| `lib/schema.ts` | Drizzle table definitions (postcards, images, transactions, research) |
| `lib/auth.ts` | PIN verify, JWT sign/verify, rate limiter |
| `app/globals.css` | Tailwind v4 imports + @theme |
| `app/layout.tsx` | Root layout, font, metadata |
| `app/login/page.tsx` | PIN entry UI |
| `app/page.tsx` | Dashboard (stats overview) |
| `app/inventory/page.tsx` | Inventory grid with thumbnails |
| `app/inventory/[id]/page.tsx` | Postcard detail + edit + transactions |
| `app/add/page.tsx` | Add postcard form with photo upload |
| `app/research/page.tsx` | Placeholder page |
| `app/api/auth/verify/route.ts` | POST: check PIN, set JWT cookie |
| `app/api/postcards/route.ts` | GET: list, POST: create |
| `app/api/postcards/[id]/route.ts` | GET: one, PUT: update, DELETE: remove |
| `app/api/upload/route.ts` | POST: accept photo, save to uploads/ |
| `app/api/images/[id]/route.ts` | GET: stream image from uploads/ |
| `app/api/transactions/route.ts` | GET: list, POST: create |
| `app/api/transactions/[id]/route.ts` | GET: one, PUT: update, DELETE: remove |

---

### Task 1: Project Scaffolding + Dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.local`, `ecosystem.config.cjs`

- [ ] **Step 1: Initialize Next.js project**

The repo already contains `docs/`, `README.md`, and `.git/`. `create-next-app` refuses non-empty directories. Workaround: scaffold into a temp directory and move files in.

```bash
cd /Users/saturdaysocial
npx create-next-app@latest sunshine-postcards-tmp --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
# Move generated files into the real repo (skip .git which tmp won't have)
cp -r sunshine-postcards-tmp/* sunshine-postcards/
cp sunshine-postcards-tmp/.eslintrc.json sunshine-postcards/ 2>/dev/null || true
cp sunshine-postcards-tmp/.gitignore sunshine-postcards/
rm -rf sunshine-postcards-tmp
cd /Users/saturdaysocial/sunshine-postcards
```

- [ ] **Step 2: Install additional dependencies**

```bash
npm install better-sqlite3 drizzle-orm jose
npm install -D drizzle-kit @types/better-sqlite3
```

- [ ] **Step 3: Configure next.config.ts for better-sqlite3**

better-sqlite3 is a native module — Next.js webpack needs to externalize it. Replace `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 4: Create .env.local**

```
APP_PIN=1234
JWT_SECRET=sunshine-postcards-jwt-secret-change-me
```

- [ ] **Step 5: Update .gitignore**

Append to the generated .gitignore:

```
# Sunshine Postcards
uploads/
*.db
.env.local
```

- [ ] **Step 6: Create ecosystem.config.cjs**

```javascript
module.exports = {
  apps: [{
    name: 'sunshine-postcards',
    script: 'node_modules/.bin/next',
    args: 'start -p 3005',
    cwd: '/Users/saturdaysocial/sunshine-postcards',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

- [ ] **Step 7: Create uploads directory**

```bash
mkdir -p uploads
```

- [ ] **Step 8: Verify dev server starts**

```bash
npm run dev -- -p 3005
```
Expected: Next.js dev server on http://localhost:3005, default page renders.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with dependencies"
```

---

### Task 2: Database Schema + Drizzle Setup

**Files:**
- Create: `lib/db.ts`, `lib/schema.ts`, `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle config**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./lib/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./sunshine-postcards.db",
  },
});
```

- [ ] **Step 2: Define schema**

Create `lib/schema.ts`:

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const postcards = sqliteTable("postcards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  era: text("era").notNull().default(""),
  condition: text("condition").notNull().default(""),
  locationDepicted: text("location_depicted"),
  publisher: text("publisher"),
  estimatedValue: real("estimated_value"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const postcardImages = sqliteTable("postcard_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postcardId: integer("postcard_id")
    .notNull()
    .references(() => postcards.id, { onDelete: "cascade" }),
  side: text("side").notNull(), // "front" or "back"
  filePath: text("file_path").notNull(),
  originalFilename: text("original_filename").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postcardId: integer("postcard_id")
    .notNull()
    .references(() => postcards.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("listed"), // listed, relisted, sold, cancelled, returned
  platform: text("platform").notNull().default("ebay"),
  listingPrice: real("listing_price"),
  soldPrice: real("sold_price"),
  fees: real("fees"),
  profit: real("profit"),
  listingUrl: text("listing_url"),
  listedAt: text("listed_at"),
  soldAt: text("sold_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const researchResults = sqliteTable("research_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postcardId: integer("postcard_id")
    .notNull()
    .references(() => postcards.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  data: text("data").notNull(), // JSON blob
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 3: Create database connection singleton**

Create `lib/db.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

const DB_PATH = path.join(process.cwd(), "sunshine-postcards.db");

// Lazy singleton — avoids crashing next build (better-sqlite3 is native)
let _sqlite: InstanceType<typeof Database> | null = null;
let _db: BetterSQLite3Database<typeof schema> | null = null;

function getConnection() {
  if (!_sqlite) {
    _sqlite = new Database(DB_PATH);
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("foreign_keys = ON");
  }
  return _sqlite;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getConnection(), { schema });
  }
  return _db;
}
```

**Important:** All files that use the database must call `getDb()` instead of importing a `db` constant. E.g. `const db = getDb();` at the top of each handler function.

- [ ] **Step 4: Generate and run initial migration**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```
Expected: `lib/migrations/` populated with SQL files, `sunshine-postcards.db` created with all 4 tables.

- [ ] **Step 5: Verify tables exist**

```bash
npx drizzle-kit studio
```
Expected: Drizzle Studio opens showing postcards, postcard_images, transactions, research_results tables.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/schema.ts drizzle.config.ts lib/migrations/
git commit -m "feat: add SQLite database schema with Drizzle ORM"
```

---

### Task 3: Authentication (PIN + JWT)

**Files:**
- Create: `lib/auth.ts`, `middleware.ts`, `app/api/auth/verify/route.ts`, `app/login/page.tsx`

- [ ] **Step 1: Create auth helpers**

Create `lib/auth.ts`:

```typescript
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret"
);
const COOKIE_NAME = "sunshine-session";
const EXPIRY = "7d";

// Rate limiting (in-memory)
const attempts: Map<string, { count: number; lockedUntil: number }> = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = attempts.get(ip);

  if (record && record.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  if (record && record.lockedUntil <= now) {
    attempts.delete(ip);
  }

  return { allowed: true };
}

export function recordFailedAttempt(ip: string): void {
  const record = attempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(ip, record);
}

export function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

export function verifyPin(pin: string): boolean {
  return pin === process.env.APP_PIN;
}

export async function createSession(): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySession(token);
}

export { COOKIE_NAME };
```

- [ ] **Step 2: Create middleware**

Create `middleware.ts` in project root:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret"
);
const COOKIE_NAME = "sunshine-session";

const PUBLIC_PATHS = ["/login", "/api/auth/verify"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, SECRET);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: Create PIN verify API route**

Create `app/api/auth/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  verifyPin,
  createSession,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
  COOKIE_NAME,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";

  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", retryAfter },
      { status: 429 }
    );
  }

  const { pin } = await request.json();

  if (!verifyPin(pin)) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  clearAttempts(ip);
  const token = await createSession();

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });

  return response;
}
```

- [ ] **Step 4: Create login page**

Create `app/login/page.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [pin, setPin] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    setError("");

    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }

    // Auto-submit when all 4 digits entered
    if (value && index === 3 && newPin.every((d) => d)) {
      submitPin(newPin.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const submitPin = async (code: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: code }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid PIN");
        setPin(["", "", "", ""]);
        inputs.current[0]?.focus();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Sunshine Postcards</h1>
        <p className="text-gray-500 mb-8">Enter your PIN to continue</p>
        <div className="flex gap-3 justify-center mb-4">
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading}
              className="w-14 h-14 text-center text-2xl border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          ))}
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Test auth flow**

1. Start dev server: `npm run dev -- -p 3005`
2. Visit `http://localhost:3005/` — should redirect to `/login`
3. Enter wrong PIN — should show "Invalid PIN"
4. Enter correct PIN (1234) — should redirect to `/`
5. Refresh — should stay authenticated (cookie set)

- [ ] **Step 6: Commit**

```bash
git add lib/auth.ts middleware.ts app/api/auth/verify/route.ts app/login/page.tsx
git commit -m "feat: add PIN authentication with JWT sessions"
```

---

### Task 4: Postcards CRUD API

**Files:**
- Create: `app/api/postcards/route.ts`, `app/api/postcards/[id]/route.ts`

- [ ] **Step 1: Create list + create route**

Create `app/api/postcards/route.ts`:

```typescript
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
```

- [ ] **Step 2: Create single postcard route**

Create `app/api/postcards/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcards, postcardImages, transactions, researchResults } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

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

  // Whitelist allowed fields
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
```

- [ ] **Step 3: Test CRUD via curl**

```bash
# Create
curl -X POST http://localhost:3005/api/postcards \
  -H "Content-Type: application/json" \
  -H "Cookie: sunshine-session=<token>" \
  -d '{"title":"Test Postcard","era":"1950s","condition":"good"}'

# List
curl http://localhost:3005/api/postcards -H "Cookie: sunshine-session=<token>"

# Get one
curl http://localhost:3005/api/postcards/1 -H "Cookie: sunshine-session=<token>"

# Update
curl -X PUT http://localhost:3005/api/postcards/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: sunshine-session=<token>" \
  -d '{"title":"Updated Title"}'

# Delete
curl -X DELETE http://localhost:3005/api/postcards/1 -H "Cookie: sunshine-session=<token>"
```

Expected: 201 on create, 200 with array on list, 200 on get/update, 200 with `{deleted:true}` on delete.

- [ ] **Step 4: Commit**

```bash
git add app/api/postcards/
git commit -m "feat: add postcards CRUD API routes"
```

---

### Task 5: Photo Upload + Image Serving

**Files:**
- Create: `app/api/upload/route.ts`, `app/api/images/[id]/route.ts`

- [ ] **Step 1: Create upload route**

Create `app/api/upload/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcardImages } from "@/lib/schema";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export async function POST(request: NextRequest) {
  const db = getDb();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const postcardId = formData.get("postcardId") as string;
  const side = (formData.get("side") as string) || "front";

  if (!file || !postcardId) {
    return NextResponse.json(
      { error: "file and postcardId are required" },
      { status: 400 }
    );
  }

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use JPEG, PNG, WebP, or HEIC." },
      { status: 400 }
    );
  }

  // Save file
  const ext = file.name.split(".").pop() || "jpg";
  const filename = `${randomUUID()}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  await mkdir(UPLOADS_DIR, { recursive: true });
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  // Save record
  const result = db
    .insert(postcardImages)
    .values({
      postcardId: parseInt(postcardId),
      side,
      filePath: filename, // relative path
      originalFilename: file.name,
    })
    .returning()
    .all();

  return NextResponse.json(result[0], { status: 201 });
}
```

- [ ] **Step 2: Create image serving route**

Create `app/api/images/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { postcardImages } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const results = db
    .select()
    .from(postcardImages)
    .where(eq(postcardImages.id, parseInt(id)))
    .all();
  const image = results[0];

  if (!image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(UPLOADS_DIR, image.filePath);

  try {
    const buffer = await readFile(filePath);
    const ext = image.filePath.split(".").pop() || "jpg";
    const contentType =
      { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] ||
      "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }
}
```

- [ ] **Step 3: Test upload + serve**

```bash
# Upload (use a test image)
curl -X POST http://localhost:3005/api/upload \
  -H "Cookie: sunshine-session=<token>" \
  -F "file=@/path/to/test.jpg" \
  -F "postcardId=1" \
  -F "side=front"

# Serve — open in browser
# http://localhost:3005/api/images/1
```

Expected: 201 with image record on upload, image displayed in browser on serve.

- [ ] **Step 4: Commit**

```bash
git add app/api/upload/ app/api/images/
git commit -m "feat: add photo upload and image serving routes"
```

---

### Task 6: Transactions API

**Files:**
- Create: `app/api/transactions/route.ts`, `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Create list + create route**

Create `app/api/transactions/route.ts`:

```typescript
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

  // Compute profit if sold
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
```

- [ ] **Step 2: Create single transaction route**

Create `app/api/transactions/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { transactions } from "@/lib/schema";
import { eq } from "drizzle-orm";

const ALLOWED_FIELDS = [
  "status", "platform", "listingPrice", "soldPrice", "fees",
  "listingUrl", "listedAt", "soldAt", "notes",
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const results = db
    .select()
    .from(transactions)
    .where(eq(transactions.id, parseInt(id)))
    .all();
  const txn = results[0];

  if (!txn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(txn);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const body = await request.json();

  // Whitelist allowed fields
  const updates: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in body) updates[field] = body[field];
  }

  // Recompute profit if price/fees changed
  if (body.soldPrice !== undefined || body.fees !== undefined) {
    const existing = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parseInt(id)))
      .all()[0];
    if (existing) {
      const soldPrice = body.soldPrice ?? existing.soldPrice;
      const fees = body.fees ?? existing.fees;
      if (soldPrice != null && fees != null) {
        updates.profit = soldPrice - fees;
      }
    }
  }

  const result = db
    .update(transactions)
    .set(updates)
    .where(eq(transactions.id, parseInt(id)))
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
    .delete(transactions)
    .where(eq(transactions.id, parseInt(id)))
    .returning()
    .all();

  if (!result.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/transactions/
git commit -m "feat: add transactions CRUD API routes"
```

---

### Task 7: Basic UI Pages (Functional, Pre-Design-Pass)

These pages are minimal and functional — the design polish comes later in a dedicated `frontend-design` session.

**Files:**
- Create/Modify: `app/layout.tsx`, `app/page.tsx`, `app/inventory/page.tsx`, `app/inventory/[id]/page.tsx`, `app/add/page.tsx`, `app/research/page.tsx`

- [ ] **Step 1: Update root layout**

Modify `app/layout.tsx` to include basic nav and metadata:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sunshine Postcards",
  description: "Postcard inventory management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white border-b px-6 py-4 flex items-center gap-6">
          <a href="/" className="font-bold text-lg">Sunshine Postcards</a>
          <a href="/inventory" className="text-gray-600 hover:text-gray-900">Inventory</a>
          <a href="/add" className="text-gray-600 hover:text-gray-900">Add Postcard</a>
          <a href="/research" className="text-gray-600 hover:text-gray-900">Research</a>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create dashboard page**

Replace `app/page.tsx`:

```tsx
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
```

- [ ] **Step 3: Create inventory grid page**

Create `app/inventory/page.tsx`:

```tsx
import { getDb } from "@/lib/db";
import { postcards, postcardImages } from "@/lib/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const db = getDb();
  const allPostcards = db
    .select()
    .from(postcards)
    .orderBy(desc(postcards.createdAt))
    .all();

  // Get first image for each postcard for thumbnails
  const allImages = db.select().from(postcardImages).all();
  const imageMap = new Map<number, typeof allImages[0]>();
  for (const img of allImages) {
    if (!imageMap.has(img.postcardId)) {
      imageMap.set(img.postcardId, img);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Inventory</h1>
        <Link
          href="/add"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Add Postcard
        </Link>
      </div>

      {allPostcards.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">No postcards yet.</p>
          <Link href="/add" className="text-blue-600 hover:underline mt-2 inline-block">
            Add your first postcard
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {allPostcards.map((pc) => {
            const thumb = imageMap.get(pc.id);
            return (
              <Link
                key={pc.id}
                href={`/inventory/${pc.id}`}
                className="bg-white rounded-lg border shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                {thumb ? (
                  <img
                    src={`/api/images/${thumb.id}`}
                    alt={pc.title}
                    className="w-full h-40 object-cover"
                  />
                ) : (
                  <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400">
                    No image
                  </div>
                )}
                <div className="p-3">
                  <p className="font-medium truncate">{pc.title || "Untitled"}</p>
                  <p className="text-sm text-gray-500">{pc.era} &middot; {pc.condition}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create postcard detail page**

Create `app/inventory/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface Postcard {
  id: number;
  title: string;
  description: string;
  category: string;
  era: string;
  condition: string;
  locationDepicted: string | null;
  publisher: string | null;
  estimatedValue: number | null;
  notes: string | null;
  images: { id: number; side: string; filePath: string }[];
  transactions: {
    id: number;
    status: string;
    platform: string;
    listingPrice: number | null;
    soldPrice: number | null;
    profit: number | null;
    listedAt: string | null;
    soldAt: string | null;
  }[];
}

export default function PostcardDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [postcard, setPostcard] = useState<Postcard | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Postcard>>({});

  useEffect(() => {
    fetch(`/api/postcards/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPostcard(data);
        setForm(data);
      });
  }, [id]);

  const save = async () => {
    const res = await fetch(`/api/postcards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        category: form.category,
        era: form.era,
        condition: form.condition,
        locationDepicted: form.locationDepicted,
        publisher: form.publisher,
        estimatedValue: form.estimatedValue,
        notes: form.notes,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPostcard({ ...postcard!, ...updated });
      setEditing(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this postcard?")) return;
    await fetch(`/api/postcards/${id}`, { method: "DELETE" });
    router.push("/inventory");
  };

  if (!postcard) return <div className="py-8">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{postcard.title || "Untitled"}</h1>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded-lg">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="border px-4 py-2 rounded-lg">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="border px-4 py-2 rounded-lg">
                Edit
              </button>
              <button onClick={remove} className="border border-red-300 text-red-600 px-4 py-2 rounded-lg">
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Images */}
      <div className="flex gap-4 mb-8">
        {postcard.images.map((img) => (
          <img
            key={img.id}
            src={`/api/images/${img.id}`}
            alt={img.side}
            className="w-64 h-48 object-cover rounded-lg border"
          />
        ))}
        {postcard.images.length === 0 && (
          <div className="w-64 h-48 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
            No images
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="bg-white rounded-lg border p-6 mb-8">
        <div className="grid grid-cols-2 gap-4">
          {(["title", "description", "category", "era", "condition", "locationDepicted", "publisher", "notes"] as const).map(
            (field) => (
              <div key={field}>
                <label className="block text-sm text-gray-500 mb-1 capitalize">
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
                {editing ? (
                  <input
                    className="w-full border rounded px-3 py-2"
                    value={(form as Record<string, string>)[field] || ""}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  />
                ) : (
                  <p>{(postcard as Record<string, string>)[field] || "—"}</p>
                )}
              </div>
            )
          )}
          <div>
            <label className="block text-sm text-gray-500 mb-1">Estimated Value</label>
            {editing ? (
              <input
                type="number"
                step="0.01"
                className="w-full border rounded px-3 py-2"
                value={form.estimatedValue ?? ""}
                onChange={(e) =>
                  setForm({ ...form, estimatedValue: e.target.value ? parseFloat(e.target.value) : null })
                }
              />
            ) : (
              <p>{postcard.estimatedValue ? `$${postcard.estimatedValue.toFixed(2)}` : "—"}</p>
            )}
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-xl font-bold mb-4">Transactions</h2>
        {postcard.transactions.length === 0 ? (
          <p className="text-gray-500">No transactions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2">Status</th>
                <th className="pb-2">Platform</th>
                <th className="pb-2">Listed</th>
                <th className="pb-2">Sold</th>
                <th className="pb-2">Profit</th>
              </tr>
            </thead>
            <tbody>
              {postcard.transactions.map((txn) => (
                <tr key={txn.id} className="border-b">
                  <td className="py-2 capitalize">{txn.status}</td>
                  <td className="py-2">{txn.platform}</td>
                  <td className="py-2">{txn.listingPrice ? `$${txn.listingPrice.toFixed(2)}` : "—"}</td>
                  <td className="py-2">{txn.soldPrice ? `$${txn.soldPrice.toFixed(2)}` : "—"}</td>
                  <td className="py-2">{txn.profit ? `$${txn.profit.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create add postcard page**

Create `app/add/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddPostcard() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    era: "",
    condition: "",
    locationDepicted: "",
    publisher: "",
    estimatedValue: "",
    notes: "",
  });
  const [files, setFiles] = useState<{ file: File; side: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>, side: string) => {
    const file = e.target.files?.[0];
    if (file) {
      // Replace existing file for this side (don't append duplicates)
      setFiles([...files.filter((f) => f.side !== side), { file, side }]);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      // Create postcard
      const res = await fetch("/api/postcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : null,
        }),
      });
      const postcard = await res.json();

      // Upload images
      for (const { file, side } of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("postcardId", postcard.id.toString());
        formData.append("side", side);
        await fetch("/api/upload", { method: "POST", body: formData });
      }

      router.push(`/inventory/${postcard.id}`);
    } catch (err) {
      alert("Failed to save postcard");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Add Postcard</h1>
      <div className="bg-white rounded-lg border p-6">
        {/* Photo upload */}
        <div className="mb-6">
          <h2 className="font-semibold mb-3">Photos</h2>
          <div className="flex gap-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Front</label>
              <input type="file" accept="image/*" onChange={(e) => handleFileAdd(e, "front")} />
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Back</label>
              <input type="file" accept="image/*" onChange={(e) => handleFileAdd(e, "back")} />
            </div>
          </div>
          {files.length > 0 && (
            <div className="flex gap-2 mt-3">
              {files.map((f, i) => (
                <div key={i} className="text-sm text-gray-500">
                  {f.side}: {f.file.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Form fields */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {(["title", "description", "category", "era", "condition", "locationDepicted", "publisher", "notes"] as const).map(
            (field) => (
              <div key={field}>
                <label className="block text-sm text-gray-500 mb-1 capitalize">
                  {field.replace(/([A-Z])/g, " $1")}
                </label>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={form[field as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                />
              </div>
            )
          )}
          <div>
            <label className="block text-sm text-gray-500 mb-1">Estimated Value ($)</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded px-3 py-2"
              value={form.estimatedValue}
              onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
            />
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-lg"
        >
          {submitting ? "Saving..." : "Save Postcard"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create research placeholder page**

Create `app/research/page.tsx`:

```tsx
export default function ResearchPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Research</h1>
      <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
        <p className="text-lg">Research tools coming soon.</p>
        <p className="mt-2">This will include eBay sold comps, market trends, and AI-powered identification.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Test full flow end-to-end**

1. Start dev server: `npm run dev -- -p 3005`
2. Visit `http://localhost:3005` — redirects to `/login`
3. Enter PIN 1234 — redirects to dashboard (shows 0 postcards)
4. Navigate to Add Postcard — upload a photo, fill fields, save
5. Redirects to detail page — verify fields and image display
6. Navigate to Inventory — verify grid shows the postcard with thumbnail
7. Edit the postcard — change title, save, verify update
8. Dashboard — verify total count is 1

- [ ] **Step 8: Commit**

```bash
git add app/
git commit -m "feat: add basic UI pages — dashboard, inventory, add, detail, research"
```

---

### Task 8: Infrastructure (PM2 + Cloudflare Tunnel)

**Files:**
- Modify: `~/.cloudflared/config.yml`

- [ ] **Step 1: Build the app**

```bash
cd /Users/saturdaysocial/sunshine-postcards
npm run build
```
Expected: Successful build with no errors.

- [ ] **Step 2: Start with PM2**

```bash
pm2 start ecosystem.config.cjs
pm2 save
```
Expected: Process `sunshine-postcards` running on port 3005.

- [ ] **Step 3: Verify locally**

```bash
curl http://localhost:3005/login
```
Expected: HTML of login page returned.

- [ ] **Step 4: Add Cloudflare tunnel ingress**

Add to `~/.cloudflared/config.yml` (before the catch-all `http_status:404` rule):

```yaml
  - hostname: sunshinepostcards.com
    service: http://localhost:3005
```

- [ ] **Step 5: Restart cloudflared**

```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```
Or: `cloudflared tunnel --config ~/.cloudflared/config.yml run` if running manually.

- [ ] **Step 6: Add DNS in Cloudflare dashboard**

In Cloudflare dashboard for `sunshinepostcards.com`:
- Add CNAME record: `@` → `<tunnel-id>.cfargotunnel.com` (proxied)
- The tunnel ID is `66b49185-6638-40e9-80f9-4eea464a2442`

- [ ] **Step 7: Verify external access**

Visit `https://sunshinepostcards.com` in browser.
Expected: PIN login page loads over HTTPS.

- [ ] **Step 8: Commit and push**

```bash
cd /Users/saturdaysocial/sunshine-postcards
git add -A
git commit -m "chore: final scaffolding verification"
git push origin main
```

---

## Summary

| Task | What It Builds | Dependencies |
|------|---------------|-------------|
| 1 | Project scaffolding + deps | None |
| 2 | Database schema + Drizzle | Task 1 |
| 3 | PIN auth + JWT middleware | Task 1 |
| 4 | Postcards CRUD API | Task 2 |
| 5 | Photo upload + image serving | Task 2 |
| 6 | Transactions API | Task 2 |
| 7 | Basic UI pages | Tasks 3-6 |
| 8 | PM2 + Cloudflare tunnel | Task 7 |

**After this plan:** A dedicated UI design session using `frontend-design` skill will create a polished, creative interface on top of this working foundation.
