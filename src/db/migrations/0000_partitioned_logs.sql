-- ============================================================================
-- Log level enum
-- ============================================================================
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint

-- ============================================================================
-- Extensions needed for indexing strategy
--   pg_trgm: trigram index for case-insensitive substring search on message
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- ============================================================================
-- Parent table: RANGE partitioned by day on `timestamp`.
--
-- Why partitioning by day:
--   - Retention becomes O(1): DROP a partition instead of a slow bulk DELETE
--     that would otherwise scan + WAL-log + generate massive vacuum/bloat.
--   - Query planner can prune irrelevant partitions when `since`/`until`
--     filters are present, shrinking the scan surface even before indexes
--     are consulted.
--
-- Why PRIMARY KEY (id, timestamp):
--   Postgres requires the partition key to be part of every unique
--   constraint (including the primary key) on a partitioned table, because
--   uniqueness can only be enforced per-partition, not globally across
--   partitions without it. `id` alone is not sufficient here.
--
-- Why BIGINT GENERATED ALWAYS AS IDENTITY:
--   Sequential inserts avoid the B-tree page-split / random-write overhead
--   that UUIDv4 primary keys cause at high insert rates.
-- ============================================================================
CREATE TABLE "logs" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone NOT NULL,
	"level" "log_level" NOT NULL,
	"service" text NOT NULL,
	"message" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "logs_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");--> statement-breakpoint

-- ============================================================================
-- Indexes on the PARENT table.
-- Postgres automatically propagates these to every partition (existing and
-- future), so we only ever declare them once here -- never per-partition.
-- ============================================================================

-- Dominant query shape: filter by service + level, sorted by timestamp desc.
-- Matches GET /logs with service/level filters and the default sort order.
CREATE INDEX "logs_service_level_timestamp_idx"
	ON "logs" ("service", "level", "timestamp" DESC);--> statement-breakpoint

-- Keyset pagination and pure time-range queries (GET /logs with only
-- since/until, or GET /logs/aggregate bucketing) both hit timestamp alone.
CREATE INDEX "logs_timestamp_id_idx"
	ON "logs" ("timestamp" DESC, "id" DESC);--> statement-breakpoint

-- Time-bounded queries that also filter on service + level can take
-- advantage of the ordered timestamp leading column without scanning the
-- entire partition set.
CREATE INDEX "logs_timestamp_service_level_idx"
	ON "logs" ("timestamp", "service", "level");--> statement-breakpoint

-- attr.<key> equality lookups against the JSONB attributes column.
-- jsonb_path_ops is smaller and faster than the default jsonb_ops for
-- containment (@>) queries, at the cost of not supporting key-existence
-- (?) queries -- which we don't need for attr.<key>=value equality lookups.
CREATE INDEX "logs_attributes_gin_idx"
	ON "logs" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint

-- Case-insensitive substring search on `message` (the `q` query param).
-- gin_trgm_ops supports ILIKE '%term%' efficiently, which a plain btree
-- cannot do for substring (non-prefix) matches.
CREATE INDEX "logs_message_trgm_idx"
	ON "logs" USING gin ("message" gin_trgm_ops);--> statement-breakpoint

-- ============================================================================
-- Initial partitions.
--
-- This hand-written migration seeds partitions for a rolling window around
-- "now" so the service is immediately usable. Ongoing partition creation
-- (rolling the window forward) and old-partition drops (retention) are
-- NOT part of migrations -- they are handled by the scheduled retention job
-- documented in the README, because migrations run once at deploy time and
-- must not be relied on to keep creating partitions daily.
--
-- We seed 3 days back through 4 days forward (7 days total) as a safety
-- margin so ingestion never hits a missing partition immediately after a
-- fresh `docker compose up`.
-- ============================================================================
DO $$
DECLARE
	day_offset INT;
	partition_start DATE;
	partition_end DATE;
	partition_name TEXT;
BEGIN
	FOR day_offset IN -3..4 LOOP
		partition_start := (CURRENT_DATE + day_offset);
		partition_end := (CURRENT_DATE + day_offset + 1);
		partition_name := 'logs_' || to_char(partition_start, 'YYYY_MM_DD');

		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I PARTITION OF "logs" FOR VALUES FROM (%L) TO (%L);',
			partition_name,
			partition_start,
			partition_end
		);
	END LOOP;
END $$;--> statement-breakpoint

-- Default partition catches any row outside the seeded window. This is
-- deliberate, not just a safety net: the API contract only rejects
-- timestamps more than 5 minutes in the future, and places no lower bound
-- on the past (see POST /logs validation rules), so a client is free to
-- send an old backfilled log that legitimately falls outside the rolling
-- 7-day window we seed here. Without this default partition, that
-- perfectly-valid request would hard-fail with a Postgres
-- "no partition of relation logs found for row" error.
--
-- This partition is NOT itself sub-partitioned, so it does not benefit
-- from partition pruning or O(1) drop-based retention the way the dated
-- partitions do. The retention job (see README) monitors its size and
-- logs a warning if it grows unexpectedly large, which would indicate
-- either heavy backfill traffic or the daily partition-rolling job
-- falling behind.
CREATE TABLE IF NOT EXISTS "logs_default" PARTITION OF "logs" DEFAULT;