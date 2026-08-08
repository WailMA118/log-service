import postgres from "postgres";
import { config } from "../config.js";

const DB_URL = config.db.url;
if (!DB_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

/**
 * How many days beyond "today" to always keep pre-created. Sized well
 * beyond both the 5-minute future-timestamp validation window (POST
 * /logs rejects anything further out than that) and the sweep interval
 * itself, so a partition is never missing for an insert just because a
 * sweep hasn't run recently -- if it were missing, the row would fall
 * into the unpartitioned `logs_default` catch-all instead of a proper
 * dated partition, quietly losing the benefits of pruning/O(1) drop for
 * that row.
 */
const FUTURE_PARTITION_DAYS = 3;

/**
 * Retention sweep: rolls the partition window forward and drops
 * partitions older than the configured retention period.
 *
 * Both operations happen inside a single PL/pgSQL DO block so identifier
 * construction (partition names built from dates) goes through
 * Postgres's own `format('%I', ...)` / `format('%L', ...)` safe-quoting
 * -- the same pattern the initial migration already uses to seed
 * partitions -- rather than hand-interpolating table names as strings in
 * JS, which is a common source of SQL injection bugs when done
 * carelessly. The only values crossing the JS/SQL boundary are the two
 * integer config values below, passed as ordinary bound parameters.
 *
 * Dropping a partition is a DROP TABLE on a child table that current
 * ingestion traffic is not writing to (it's older than the retention
 * window), so it does not block or slow down live inserts targeting
 * today's partition -- this is the entire point of partitioning for
 * retention: O(1) metadata-only drops instead of a row-by-row DELETE
 * that would have to scan, WAL-log, and leave bloat behind.
 *
 * `logs_default` is never touched here (the regex only matches the
 * dated `logs_YYYY_MM_DD` naming pattern), since it may legitimately
 * hold old backfilled data that doesn't fit the retention-by-partition
 * model -- see the migration's comments on why it exists.
 */
const RETENTION_SWEEP_SQL = `
DO $$
DECLARE
  today DATE := CURRENT_DATE;
  day_offset INT;
  partition_start DATE;
  partition_end DATE;
  partition_name TEXT;
  cutoff DATE := CURRENT_DATE - ($1)::int;
  part RECORD;
  part_date DATE;
BEGIN
  -- Roll the window forward: ensure today through +N days ahead exist.
  FOR day_offset IN 0..($2)::int LOOP
    partition_start := today + day_offset;
    partition_end := today + day_offset + 1;
    partition_name := 'logs_' || to_char(partition_start, 'YYYY_MM_DD');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "logs" FOR VALUES FROM (%L) TO (%L);',
      partition_name, partition_start, partition_end
    );
  END LOOP;

  -- Drop partitions entirely older than the retention cutoff.
  FOR part IN
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parentcls ON pg_inherits.inhparent = parentcls.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace ns ON parentcls.relnamespace = ns.oid
    WHERE parentcls.relname = 'logs'
      AND ns.nspname = 'public'
      AND child.relname ~ '^logs_[0-9]{4}_[0-9]{2}_[0-9]{2}$'
  LOOP
    part_date := to_date(substring(part.relname from 6), 'YYYY_MM_DD');
    IF part_date < cutoff THEN
      RAISE NOTICE 'retention: dropping partition %', part.relname;
      EXECUTE format('DROP TABLE IF EXISTS %I', part.relname);
    END IF;
  END LOOP;
END $$;
`;

/**
 * Runs one retention sweep on a short-lived, dedicated single connection
 * -- separate from both the query pool and the ingest pool, so this
 * periodic maintenance work can never compete with live traffic for a
 * connection slot. Mirrors the same pattern used by the migration
 * runner (src/db/migrate.ts).
 */
export async function runRetentionSweep(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    await sql.unsafe(RETENTION_SWEEP_SQL, [
      config.retention.retentionDays,
      FUTURE_PARTITION_DAYS,
    ]);
  } finally {
    await sql.end();
  }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Runs an initial sweep immediately (so a freshly started service isn't
 * relying on the migration's one-time 7-day partition seed forever),
 * then schedules recurring sweeps on the configured interval.
 */
export function startRetentionScheduler(): void {
  runRetentionSweep().catch((err) => {
    console.error("[retention] initial sweep failed:", err);
  });

  timer = setInterval(() => {
    runRetentionSweep().catch((err) => {
      console.error("[retention] scheduled sweep failed:", err);
    });
  }, config.retention.sweepIntervalMs);

  // Don't let the periodic timer alone keep the process alive; shutdown
  // is driven explicitly by the SIGTERM/SIGINT handlers in index.ts.
  timer.unref();
}

export function stopRetentionScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
