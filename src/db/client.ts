import postgres from "postgres";
import { config } from "../config.js";

const DB_URL = config.db.url;
if (!DB_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

/**
 * Two postgres.js pools: queryClient for reads and ingestClient for hot
 * POST ingestion traffic.
 */
export const queryClient = postgres(DB_URL, { max: config.db.queryPoolMax });
export const ingestClient = postgres(DB_URL, { max: config.db.ingestPoolMax });

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
