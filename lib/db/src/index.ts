import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { assertDatabaseUrlSafeOutsideRailway } from "./guard";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Refuses a remote Railway DATABASE_URL outside Railway (local dev safety).
assertDatabaseUrlSafeOutsideRailway(process.env.DATABASE_URL);

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./websiteBackgroundSections";
