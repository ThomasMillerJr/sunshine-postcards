import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./lib/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./sunshine-postcards.db",
  },
});
