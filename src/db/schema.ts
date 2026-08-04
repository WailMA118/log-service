import {
  pgTable,
  pgEnum,
  bigint,
  timestamp,
  text,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

export const logLevelEnum = pgEnum("log_level", [
  "debug",
  "info",
  "warn",
  "error",
]);

/**
 * IMPORTANT: This table is RANGE partitioned by `timestamp` (daily) at the
 * database level. Drizzle-kit does NOT understand partitioning, so:
 *
 *  - The actual DDL (CREATE TABLE ... PARTITION BY RANGE, partition
 *    creation, and all indexes) lives in the hand-written migration
 *    0000_partitioned_logs.sql, NOT in anything drizzle-kit generates.
 *  - This schema definition exists so Drizzle ORM has type-safe query
 *    building. It intentionally mirrors the shape of the partitioned
 *    table but is not the source of truth for DDL.
 *  - Do NOT run `drizzle-kit push` against this schema -- it will try to
 *    "fix" the table into a normal non-partitioned table and drop the
 *    partitioning. Use `drizzle-kit generate` only to diff future schema
 *    changes, and hand-review/adjust the generated SQL before applying.
 *  - Primary key is (id, timestamp) because Postgres requires the
 *    partition key to be part of every unique/primary key constraint on
 *    a partitioned table.
 */
export const logs = pgTable(
  "logs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity(),
    timestamp: timestamp("timestamp", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    level: logLevelEnum("level").notNull(),
    service: text("service").notNull(),
    message: text("message").notNull(),
    attributes: jsonb("attributes")
      .$type<Record<string, string | number | boolean>>()
      .default({}),
  },
  (table) => [primaryKey({ columns: [table.id, table.timestamp] })],
);
