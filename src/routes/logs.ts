import { Router, type Request, type Response } from "express";
import { ingestClient, queryClient } from "../db/client.js";
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

// Postgres OIDs for explicit array parameter binding.
const OID_TIMESTAMPTZ_ARRAY = 1185;
const OID_TEXT_ARRAY = 1009;
const OID_JSONB_ARRAY = 3807;

/**
 * Insert validated entries with batch UNNEST arrays and explicit OIDs.
 * This avoids per-row insert helpers and scalar type inference issues.
 *
 * IMPORTANT: `attributes` is passed as the raw array of JS objects, NOT
 * pre-serialized with JSON.stringify(). postgres.js already serializes
 * values to JSON text itself when the declared parameter oid is a
 * json/jsonb (array) type -- confirmed by testing directly against a
 * live Postgres instance. Pre-stringifying here double-encodes: the
 * column ends up holding a jsonb *string* whose content is our already-
 * serialized JSON text (e.g. `"{\"user_id\":\"42\"}"` as a jsonb scalar
 * string), rather than the jsonb *object* the rest of the app expects
 * (e.g. GET /logs's response, and the GIN containment queries in
 * filters.ts, both assume `attributes` is a jsonb object, not a jsonb
 * string wrapping JSON text).
 */
async function insertBatch(entries: ValidatedLogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const timestamps = entries.map((e) => e.timestamp);
  const levels = entries.map((e) => e.level);
  const services = entries.map((e) => e.service);
  const messages = entries.map((e) => e.message);
  // postgres.js's TypeScript definitions for sql.array() don't model
  // "array of plain JSON-serializable objects, to be bound as jsonb[]"
  // as a valid SerializableParameter shape, even though this is
  // correct and necessary at runtime (see the comment above) -- the
  // cast below is narrow and specifically justified by that gap, not a
  // blanket type-safety opt-out.
  const attributes = entries.map((e) => e.attributes) as unknown as string[];

  await ingestClient`
    INSERT INTO logs (timestamp, level, service, message, attributes)
    SELECT * FROM UNNEST(
      ${ingestClient.array(timestamps, OID_TIMESTAMPTZ_ARRAY)},
      ${ingestClient.array(levels, OID_TEXT_ARRAY)}::log_level[],
      ${ingestClient.array(services, OID_TEXT_ARRAY)},
      ${ingestClient.array(messages, OID_TEXT_ARRAY)},
      ${ingestClient.array(attributes, OID_JSONB_ARRAY)}
    )
  `;
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

type LogRow = {
  id: string;
  timestamp: Date;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean> | null;
};

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

function toLogRecord(row: LogRow): LogRecord {
  return {
    id: row.id,
    timestamp: new Date(row.timestamp).toISOString(),
    level: row.level as LogRecord["level"],
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

  const sql = queryClient;
  const conditions = [buildFilterConditions(sql, filters)];

  if (since.date) conditions.push(sql`timestamp >= ${since.date}`);
  if (until.date) conditions.push(sql`timestamp < ${until.date}`);

  // Keyset pagination predicate: strictly older than the cursor's
  // (timestamp, id), matching descending order on both columns. This
  // correctly handles ties on `timestamp` by falling through to `id`,
  // which is what makes the sort deterministic across pages.
  if (cursor) {
    const cursorTimestamp = new Date(cursor.timestamp);
    conditions.push(
      sql`(timestamp < ${cursorTimestamp} OR (timestamp = ${cursorTimestamp} AND id < ${cursor.id}))`,
    );
  }

  const nonNullConditions = conditions.filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );
  const whereClause =
    nonNullConditions.length > 0
      ? sql`WHERE ${nonNullConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

  // Fetch one extra row to determine whether a next page exists, without
  // exposing that extra row to the client.
  const rows = await sql<LogRow[]>`
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor =
    hasMore && page.length > 0
      ? encodeCursor({
          timestamp: new Date(page[page.length - 1].timestamp).toISOString(),
          // page[...].id is already a string -- postgres.js returns
          // bigint columns as strings precisely to avoid the precision
          // loss Number() would introduce here (see cursor.ts).
          id: page[page.length - 1].id,
        })
      : null;

  res.status(200).json({
    logs: page.map(toLogRecord),
    next_cursor: nextCursor,
  });
});
