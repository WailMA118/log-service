import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { config } from "../config.js";

const DB_URL = config.db.url;
if (!DB_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

/**
 * Dual connection pool pattern.
 *
 * queryClient (Drizzle-wrapped): used by the type-safe query layer --
 * GET /logs, GET /logs/aggregate, health checks, retention/admin work.
 * Goes through Drizzle's query builder for type safety and readability;
 * this path is not on the hot ingestion critical path so the ORM
 * overhead here is an acceptable tradeoff for maintainability.
 *
 * ingestClient (raw postgres.js): used ONLY by the POST /logs hot path.
 * Bypasses Drizzle entirely and issues raw parameterized batch INSERTs
 * via postgres.js, because at 15,000-25,000+ logs/sec even Drizzle's
 * relatively thin query-building overhead is measurable per-row. This
 * client is never wrapped in drizzle() -- it stays a plain postgres.js
 * Sql instance.
 *
 * Keeping these separate means a burst of expensive aggregate queries
 * can never starve connections away from ingestion, and a spike in
 * ingestion traffic can never starve query latency -- each has its own
 * fixed connection budget.
 */
export const queryClient = postgres(DB_URL, { max: config.db.queryPoolMax });
export const db = drizzle(queryClient, { schema });

export const ingestClient = postgres(DB_URL, {
  max: config.db.ingestPoolMax,
  // Ingestion is pure INSERT with no need for prepared statement plan
  // caching across radically different shapes; keep default (true) unless
  // load testing shows a reason to disable it.
});

export async function waitForDatabase(
  maxAttempts = 10,
  delayMs = 1000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await queryClient`select 1`;
      return;
    } catch (err) {
      console.error(
        `[db] connection attempt ${attempt}/${maxAttempts} failed:`,
        err,
      );
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function closeDatabase(): Promise<void> {
  await Promise.all([
    queryClient.end({ timeout: 5 }),
    ingestClient.end({ timeout: 5 }),
  ]);
}
