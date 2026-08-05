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
  id: number;
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

    if (typeof timestamp !== "string" || typeof id !== "number") {
      return null;
    }
    if (Number.isNaN(new Date(timestamp).getTime())) {
      return null;
    }
    if (!Number.isFinite(id) || !Number.isInteger(id)) {
      return null;
    }

    return { timestamp, id };
  } catch {
    return null;
  }
}
