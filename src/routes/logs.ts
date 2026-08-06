import { Router, type Request, type Response } from "express";
import { and, desc, gte, lt, or, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { logs } from "../db/schema.js";
import { validateBatch } from "../logs/validation.js";
import type { ValidatedLogEntry, LogRecord } from "../logs/types.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../logs/types.js";
import { parseSharedFilters, buildFilterConditions } from "../logs/filters.js";
import { decodeCursor, encodeCursor } from "../logs/cursor.js";

export const ingestRouter = Router();
export const queryRouter = Router();

// ============================================================================
// POST /logs
// ============================================================================

/**
 * Bulk-inserts validated entries via a single multi-row INSERT using
 * postgres.js's helper(...) -- NOT one INSERT per row, and NOT through
 * Drizzle. At 15,000-25,000+ logs/sec, per-row round trips or ORM query
 * building overhead would dominate the request budget on a 0.5 CPU app
 * container. A single batched statement means one network round trip
 * and one planning pass for the whole batch.
 */
async function insertBatch(entries: ValidatedLogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const rows = entries.map((e) => ({
    timestamp: e.timestamp,
    level: e.level,
    service: e.service,
    message: e.message,
    attributes: e.attributes,
  }));
  await db.insert(logs).values(rows);
}

ingestRouter.post("/logs", async (req: Request, res: Response) => {
  const body: unknown = req.body;

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("logs" in body) ||
    !Array.isArray((body as { logs: unknown }).logs)
  ) {
    res.status(400).json({
      error: "request body must be an object with a 'logs' array",
    });
    return;
  }

  const rawEntries = (body as { logs: unknown[] }).logs;
  const { accepted, rejected } = validateBatch(rawEntries);

  if (accepted.length === 0) {
    res.status(400).json({ accepted: 0, rejected });
    return;
  }

  try {
    await insertBatch(accepted);
  } catch (err) {
    console.error("[ingest] insert failed:", err);
    res.status(500).json({ error: "internal error while storing logs" });
    return;
  }

  res.status(200).json({ accepted: accepted.length, rejected });
});

// ============================================================================
// GET /logs
// ============================================================================

function parseTimeParam(
  value: unknown,
  paramName: string,
): { ok: true; date: Date | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, date: undefined };
  if (typeof value !== "string") {
    return { ok: false, error: `${paramName} must be a single string` };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      ok: false,
      error: `invalid timestamp for ${paramName}: '${value}'`,
    };
  }
  return { ok: true, date };
}

function parseLimitParam(
  value: unknown,
): { ok: true; limit: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, limit: DEFAULT_LIMIT };
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "limit must be a single numeric value" };
  }
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: "limit must be a non-negative integer" };
  }
  const limit = Number(value);
  if (limit < 1 || limit > MAX_LIMIT) {
    return { ok: false, error: `limit must be between 1 and ${MAX_LIMIT}` };
  }
  return { ok: true, limit };
}

function toLogRecord(row: typeof logs.$inferSelect): LogRecord {
  return {
    id: String(row.id),
    timestamp: row.timestamp.toISOString(),
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: (row.attributes ?? {}) as LogRecord["attributes"],
  };
}

queryRouter.get("/logs", async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;

  const filters = parseSharedFilters(query);
  if ("error" in filters) {
    res.status(400).json({ error: filters.error });
    return;
  }

  const since = parseTimeParam(query.since, "since");
  if (!since.ok) {
    res.status(400).json({ error: since.error });
    return;
  }
  const until = parseTimeParam(query.until, "until");
  if (!until.ok) {
    res.status(400).json({ error: until.error });
    return;
  }
  if (since.date && until.date && until.date.getTime() < since.date.getTime()) {
    res.status(400).json({ error: "until must not be earlier than since" });
    return;
  }

  const limitResult = parseLimitParam(query.limit);
  if (!limitResult.ok) {
    res.status(400).json({ error: limitResult.error });
    return;
  }
  const { limit } = limitResult;

  let cursor = null;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string") {
      res.status(400).json({ error: "cursor must be a single string" });
      return;
    }
    cursor = decodeCursor(query.cursor);
    if (cursor === null) {
      res.status(400).json({ error: "invalid or malformed cursor" });
      return;
    }
  }

  const conditions = [
    buildFilterConditions(filters),
    since.date ? gte(logs.timestamp, since.date) : undefined,
    until.date ? lt(logs.timestamp, until.date) : undefined,
    // Keyset pagination predicate: strictly older than the cursor's
    // (timestamp, id), matching descending order on both columns. This
    // correctly handles ties on `timestamp` by falling through to `id`,
    // which is what makes the sort deterministic across pages.
    cursor
      ? or(
          lt(logs.timestamp, new Date(cursor.timestamp)),
          and(
            eq(logs.timestamp, new Date(cursor.timestamp)),
            lt(logs.id, cursor.id),
          ),
        )
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch one extra row to determine whether a next page exists, without
  // exposing that extra row to the client.
  const rows = await db
    .select()
    .from(logs)
    .where(whereClause)
    .orderBy(desc(logs.timestamp), desc(logs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor =
    hasMore && page.length > 0
      ? encodeCursor({
          timestamp: page[page.length - 1].timestamp.toISOString(),
          id: page[page.length - 1].id,
        })
      : null;

  res.status(200).json({
    logs: page.map(toLogRecord),
    next_cursor: nextCursor,
  });
});
