import type { MigrationConfig } from "drizzle-orm/migrator";

type Config = {
  api: APIConfig;
  db: DBConfig;
  retention: RetentionConfig;
};

type APIConfig = {
  port: number;
};

type DBConfig = {
  url: string;
  migrationConfig: MigrationConfig;
  /**
   * Max connections for the Drizzle-wrapped pool (query/read layer: GET
   * /logs, GET /logs/aggregate, health checks). Kept modest because the
   * app container only has 0.5 CPU -- more connections than the CPU can
   * actually serve concurrently just adds context-switch overhead and
   * queueing inside Postgres itself.
   */
  queryPoolMax: number;
  /**
   * Max connections for the raw postgres.js ingestion pool (POST /logs
   * hot path). Separate from the query pool so a burst of slow
   * aggregate queries can never starve ingestion throughput, and vice
   * versa. Postgres itself is capped at 1 CPU / 1GB RAM, so the combined
   * total across both pools must stay well under Postgres's own
   * max_connections and realistic concurrent-work capacity.
   */
  ingestPoolMax: number;
};

type RetentionConfig = {
  /** How many days of log data to retain before dropping partitions. */
  retentionDays: number;
  /** How often (ms) the retention sweep runs to drop expired partitions. */
  sweepIntervalMs: number;
};

try {
  process.loadEnvFile();
} catch {
  // Ignore missing .env file in containerized environments.
}

function envOrThrow(key: string) {
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
}

function envIntOrDefault(key: string, fallback: number): number {
  // eslint-disable-next-line security/detect-object-injection
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive number`);
  }
  return parsed;
}

const migrationConfig: MigrationConfig = {
  migrationsFolder: "./src/db/migrations",
};

export const config: Config = {
  api: {
    port: Number(envOrThrow("PORT")),
  },
  db: {
    url: envOrThrow("DB_URL"),
    migrationConfig: migrationConfig,
    queryPoolMax: envIntOrDefault("DB_QUERY_POOL_MAX", 6),
    ingestPoolMax: envIntOrDefault("DB_INGEST_POOL_MAX", 12),
  },
  retention: {
    retentionDays: envIntOrDefault("RETENTION_DAYS", 30),
    sweepIntervalMs: envIntOrDefault("RETENTION_SWEEP_INTERVAL_MS", 3_600_000),
  },
};
