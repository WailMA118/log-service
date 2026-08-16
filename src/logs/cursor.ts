/**
 * Keyset (cursor-based) pagination cursor for GET /logs.
 *
 * Encodes the (timestamp, id) of the last row on the current page so the
 * next page can resume with `WHERE (timestamp, id) < (last_timestamp,
 * last_id)`. This is efficient via the composite (timestamp DESC, id
 * DESC) index regardless of how deep into the result set the client
 * pages, unlike OFFSET pagination which gets linearly slower the further
 * in you go (Postgres still has to scan and discard every skipped row).
 *
 * The cursor is intentionally opaque to the client (per the API
 * contract): it's base64-encoded JSON, but the client is never meant to
 * decode or construct one -- they just pass back whatever `next_cursor`
 * we gave them.
 */

export type Cursor = {
  timestamp: string; // ISO string, matches the row's timestamp column
  // Stored and compared as a string, not a JS number. The `id` column is
  // Postgres bigint (max ~9.2e18), while JS numbers only preserve
  // integer precision up to Number.MAX_SAFE_INTEGER (~9.007e15).
  // postgres.js already returns bigint columns as strings for exactly
  // this reason (see LogRow['id'] in routes/logs.ts); round-tripping
  // through a JS number here would silently corrupt any id beyond that
  // threshold. Confirmed against a live Postgres instance: a string
  // parameter compares correctly against a bigint column with no
  // explicit cast needed, including for values beyond
  // Number.MAX_SAFE_INTEGER.
  id: string;
};

export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, "utf-8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    const { timestamp, id } = candidate;

    if (typeof timestamp !== "string" || typeof id !== "string") {
      return null;
    }
    if (Number.isNaN(new Date(timestamp).getTime())) {
      return null;
    }
    // id must look like the non-negative integer a bigint IDENTITY
    // column actually produces (see migration: MINVALUE 1) -- not an
    // arbitrary numeric string like "1.5", "-1", "1e10", or "".
    if (!/^\d+$/.test(id)) {
      return null;
    }

    return { timestamp, id };
  } catch {
    return null;
  }
}