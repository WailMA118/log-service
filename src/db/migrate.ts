import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "../config.js";

const DB_URL = config.db.url;
if (!DB_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export async function runMigrations(): Promise<void> {
  const migrationClient = postgres(DB_URL, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), config.db.migrationConfig);
  } finally {
    await migrationClient.end();
  }
}
