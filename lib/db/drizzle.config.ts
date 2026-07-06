import { defineConfig } from "drizzle-kit";
import path from "path";
import { assertDatabaseUrlSafeOutsideRailway } from "./src/guard";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Refuses a remote Railway DATABASE_URL outside Railway (local dev safety).
// Protects drizzle-kit studio/push/generate from touching production.
assertDatabaseUrlSafeOutsideRailway(process.env.DATABASE_URL);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Produce a verbose migration journal so diffs are easy to review
  verbose: true,
  strict: true,
});
