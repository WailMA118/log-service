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
  queryPoolMax: number;
  ingestPoolMax: number;
};

type RetentionConfig = {
  retentionDays: number;
  sweepIntervalMs: number;
};

try {
  process.loadEnvFile();
} catch {
  // Ignore missing .env file in containerized environments.
}

function envOrDefault(key: string, fallback: string): string {
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[key];
  return value ?? fallback;
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

export const config: Config = {
  api: {
    port: envIntOrDefault("PORT", 3000),
  },
  db: {
    url: envOrDefault("DB_URL", "postgres://localhost:5432/logs"),
    queryPoolMax: envIntOrDefault("DB_QUERY_POOL_MAX", 6),
    // Load-test evidence (see project notes) is genuinely mixed: sustained
    // high-throughput scenarios showed Postgres CPU pegged near 100%,
    // arguing for LESS ingest concurrency to reduce contention on its
    // single CPU -- but a stress-ramp scenario showed the opposite
    // signature (Postgres CPU low, ~17%, while HTTP error rate spiked to
    // 26% and throughput collapsed), which only makes sense if the app's
    // OWN connection pool was the bottleneck, not Postgres. An earlier,
    // untested drop from 12 to 4 was too aggressive in that direction.
    // 8 is a deliberate middle ground pending the next real test result,
    // not a proven optimum -- re-tune from here based on which failure
    // signature (Postgres-CPU-bound vs pool-starved) shows up next.
    ingestPoolMax: envIntOrDefault("DB_INGEST_POOL_MAX", 8),
  },
  retention: {
    retentionDays: envIntOrDefault("RETENTION_DAYS", 30),
    sweepIntervalMs: envIntOrDefault("RETENTION_SWEEP_INTERVAL_MS", 3_600_000),
  },
};
