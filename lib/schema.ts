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
  side: text("side").notNull(),
  filePath: text("file_path").notNull(),
  originalFilename: text("original_filename").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postcardId: integer("postcard_id")
    .notNull()
    .references(() => postcards.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("listed"),
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
  data: text("data").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});
