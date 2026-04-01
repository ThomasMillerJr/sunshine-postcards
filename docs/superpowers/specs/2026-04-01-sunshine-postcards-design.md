# Sunshine Postcards — Design Spec

## Overview

A web-based inventory management tool for a postcard resale business. Built for a non-technical user (the owner's mom) who sells postcards on eBay from a large physical inventory with no existing digital catalog.

The tool helps her:
1. **Catalog postcards** — photograph them, let AI extract details, review and edit
2. **Track transactions** — listings, sales, revenue, across platforms
3. **Research** — eBay comps, market trends, AI-powered identification (future)

## Architecture

**Next.js monolith** running on a Mac mini, served via Cloudflare tunnel.

```
Browser → sunshinepostcards.com → Cloudflare Tunnel → Next.js (port 3005)
                                                        ├── App Router (UI)
                                                        ├── API Routes (CRUD, uploads, AI)
                                                        ├── SQLite (better-sqlite3)
                                                        └── Local disk (uploads/)
```

### Stack

| Layer       | Technology                              |
|-------------|----------------------------------------|
| Framework   | Next.js 16 + TypeScript                |
| Styling     | Tailwind CSS v4                        |
| Database    | SQLite via `better-sqlite3`            |
| ORM         | Drizzle ORM (migrations + type safety) |
| Photos      | Local `uploads/` directory             |
| Auth        | 4-digit PIN + Cloudflare Access        |
| Process     | PM2                                    |
| Tunnel      | Cloudflare (`sunshinepostcards.com`)   |

### Why These Choices

- **SQLite over Supabase**: Single-user app on a local machine. No need for hosted database, and avoids $25/month Supabase Pro cost. Data stays on the machine, easy to back up.
- **Next.js monolith over split architecture**: One codebase, one process. Research tools and background jobs can be added later as worker scripts without rearchitecting.
- **Drizzle ORM**: Provides typed queries and migration management on top of SQLite without the weight of Prisma.
- **PIN auth**: Simple, appropriate for a single non-technical user. Rate-limited to prevent brute force.

## Data Model

### postcards

| Column            | Type      | Notes                                    |
|-------------------|-----------|------------------------------------------|
| id                | INTEGER   | Primary key, autoincrement               |
| title             | TEXT      | AI-generated or manual                   |
| description       | TEXT      | Detailed description                     |
| category          | TEXT      | e.g. "travel", "holiday", "humor"        |
| era               | TEXT      | e.g. "1900s", "1950s", "modern"          |
| condition         | TEXT      | "excellent", "good", "fair", "poor"      |
| location_depicted | TEXT      | Nullable                                 |
| publisher         | TEXT      | Nullable                                 |
| estimated_value   | REAL      | Pre-listing appraisal, nullable          |
| notes             | TEXT      | Free-form notes, nullable                |
| created_at        | TIMESTAMP | Default current time                     |
| updated_at        | TIMESTAMP | Updated on modification                  |

### postcard_images

| Column            | Type      | Notes                                    |
|-------------------|-----------|------------------------------------------|
| id                | INTEGER   | Primary key, autoincrement               |
| postcard_id       | INTEGER   | FK → postcards, cascade delete           |
| side              | TEXT      | "front" or "back"                        |
| file_path         | TEXT      | Relative path in uploads/                |
| original_filename | TEXT      | Original upload filename                 |
| created_at        | TIMESTAMP | Default current time                     |

### transactions

| Column        | Type      | Notes                                        |
|---------------|-----------|----------------------------------------------|
| id            | INTEGER   | Primary key, autoincrement                   |
| postcard_id   | INTEGER   | FK → postcards, cascade delete               |
| status        | TEXT      | "listed", "relisted", "sold", "cancelled", "returned" |
| platform      | TEXT      | e.g. "ebay", "etsy", "in_person", default "ebay" |
| listing_price | REAL      | Price listed at                              |
| sold_price    | REAL      | Nullable — filled when sold                  |
| fees          | REAL      | Nullable — platform fees, shipping, etc.     |
| profit        | REAL      | Nullable — sold_price minus fees             |
| listing_url   | TEXT      | Nullable — link to the listing               |
| listed_at     | TIMESTAMP | Nullable                                     |
| sold_at       | TIMESTAMP | Nullable                                     |
| notes         | TEXT      | Nullable                                     |
| created_at    | TIMESTAMP | Default current time                         |

### research_results

| Column      | Type      | Notes                                        |
|-------------|-----------|----------------------------------------------|
| id          | INTEGER   | Primary key, autoincrement                   |
| postcard_id | INTEGER   | FK → postcards, cascade delete               |
| source      | TEXT      | e.g. "ebay_sold", "ebay_active", "ai_analysis" |
| data        | TEXT      | JSON blob — flexible for different sources   |
| created_at  | TIMESTAMP | Default current time                         |

### Relationships

- One postcard → many images (front, back)
- One postcard → many transactions (listed → cancelled → relisted → sold)
- One postcard → many research results (different sources over time)

## Authentication

### Outer Layer: Cloudflare Access
- Applied at `sunshinepostcards.com`
- Same pattern as `internal.saturday-social.com`

### Inner Layer: 4-Digit PIN
- PIN stored in `.env.local` as `APP_PIN`
- PIN entry page with 4 digit inputs
- On success: set HTTP-only session cookie
- Rate limiting: 5 failed attempts → 15-minute lockout (in-memory counter, resets on server restart)
- All routes except `/api/auth/verify` require valid session cookie

## UI Pages

Designed for a non-technical user: large click targets, clear labels, warm and friendly design.

| Route              | Purpose                                              |
|--------------------|------------------------------------------------------|
| `/`                | Dashboard — inventory stats, listed/sold counts, revenue |
| `/inventory`       | Searchable/filterable grid with thumbnail previews   |
| `/inventory/[id]`  | Postcard detail — view/edit fields, images, transactions, research |
| `/add`             | Add postcard — photo upload → AI analysis → review/edit form |
| `/research`        | Placeholder for future research tools                |

**Note**: A dedicated UI design session using the `frontend-design` skill will follow the initial scaffolding to create a polished, creative interface.

## Project Structure

```
sunshine-postcards/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout + PIN gate
│   ├── page.tsx                # Dashboard
│   ├── login/
│   │   └── page.tsx            # PIN entry
│   ├── inventory/
│   │   ├── page.tsx            # Inventory grid
│   │   └── [id]/
│   │       └── page.tsx        # Postcard detail
│   ├── add/
│   │   └── page.tsx            # Add postcard flow
│   ├── research/
│   │   └── page.tsx            # Future research tools
│   └── api/
│       ├── auth/
│       │   └── verify/route.ts # PIN verification
│       ├── postcards/
│       │   └── route.ts        # CRUD operations
│       ├── upload/
│       │   └── route.ts        # Photo upload
│       └── transactions/
│           └── route.ts        # Transaction CRUD
├── lib/
│   ├── db.ts                   # SQLite connection singleton
│   ├── auth.ts                 # PIN verification + session helpers
│   └── migrations/             # SQL migration files
├── uploads/                    # Photo storage (gitignored)
├── public/
├── ecosystem.config.cjs        # PM2 config (port 3005)
├── .env.local                  # APP_PIN, AI keys (gitignored)
├── .gitignore
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

## Infrastructure

### PM2

```javascript
// ecosystem.config.cjs
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

### Cloudflare Tunnel

Add ingress rule to `~/.cloudflared/config.yml`:

```yaml
- hostname: sunshinepostcards.com
  service: http://localhost:3005
```

Then add DNS record in Cloudflare dashboard for `sunshinepostcards.com` pointing to the tunnel.

## Future Considerations (Not in Scope)

These are architectural notes for later phases, not current requirements:

- **AI vision analysis**: Photo → AI extraction of era, location, condition, publisher. Likely Gemini or Claude vision.
- **eBay API integration**: Pull sold comps, auto-create listings, sync transaction status.
- **Bulk import**: Batch photo upload for cataloging multiple postcards at once.
- **Search**: Full-text search across postcards. SQLite FTS5 is a natural fit.
- **Vector search**: Semantic similarity search if the inventory grows large. Would require adding an embedding layer.
- **Analytics**: Revenue trends, best-selling categories, pricing insights.
- **Backup automation**: Scheduled SQLite database + uploads backup.
