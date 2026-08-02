import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { config } from "../config.js";

const DB_URL = config.db.url;
if (!DB_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const queryClient = postgres(DB_URL, { max: 10 });
export const db = drizzle(queryClient, { schema });

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
  await queryClient.end({ timeout: 5 });
}
