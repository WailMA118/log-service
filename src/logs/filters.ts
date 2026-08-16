import type postgres from "postgres";
import { isLogLevel } from "./types.js";

export type ParsedFilters = {
  service?: string;
  level?: string;
  attrs: Record<string, string>;
  q?: string;
};

export type FilterParseError = { error: string };

const ATTR_PREFIX = "attr.";

/**
 * Escapes the three characters that carry special meaning inside a
 * Postgres LIKE/ILIKE pattern: `%` (any run of characters), `_` (any
 * single character), and `\` itself (the escape character, which must
 * be escaped first so a literal backslash in the user's search term
 * isn't misread as escaping the character after it).
 *
 * Without this, `q=user_id` would match "userXid" and "user9id" just as
 * readily as the literal "user_id" the caller typed -- confirmed
 * against a live Postgres instance: unescaped, `q=user_id` matched 3
 * rows instead of the 1 containing a literal underscore. Paired with
 * `ESCAPE '\'` in the query (see buildFilterConditions) -- Postgres
 * defaults to `\` as the LIKE escape character already, but naming it
 * explicitly keeps the pattern's meaning independent of any session-
 * level setting.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Parses the filter-related query params shared by GET /logs and
 * GET /logs/aggregate: service, level, attr.<key>, q.
 *
 * Express parses repeated query keys as arrays (e.g. ?service=a&service=b
 * -> ["a", "b"]); we only support a single value per filter, so an array
 * is treated as invalid input rather than silently taking the first or
 * last value.
 */
export function parseSharedFilters(
  query: Record<string, unknown>,
): ParsedFilters | FilterParseError {
  // attrs uses a null-prototype object so a query param like
  // "attr.__proto__" or "attr.constructor" can never be interpreted as
  // touching the object prototype chain.
  const result: ParsedFilters = {
    attrs: Object.create(null) as Record<string, string>,
  };

  if (query.service !== undefined) {
    if (typeof query.service !== "string" || query.service.length === 0) {
      return { error: "service must be a single non-empty string" };
    }
    result.service = query.service;
  }

  if (query.level !== undefined) {
    if (typeof query.level !== "string") {
      return { error: "level must be a single string" };
    }
    if (!isLogLevel(query.level)) {
      return { error: `invalid level: '${query.level}'` };
    }
    result.level = query.level;
  }

  if (query.q !== undefined) {
    if (typeof query.q !== "string") {
      return { error: "q must be a single string" };
    }
    result.q = query.q;
  }

  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith(ATTR_PREFIX)) continue;
    const attrKey = key.slice(ATTR_PREFIX.length);
    if (attrKey.length === 0) {
      return { error: "attribute filter key must not be empty" };
    }
    if (typeof value !== "string") {
      return { error: `attr.${attrKey} must be a single string` };
    }
    // eslint-disable-next-line security/detect-object-injection -- attrKey is a request-controlled string used as a key on a null-prototype object (see above), so it can affect only this object's own properties, never the prototype chain
    result.attrs[attrKey] = value;
  }

  return result;
}

/**
 * `attr.<key>=value` is specified as string equality per the API
 * contract ("Attribute equality, compared as strings"), regardless of
 * the JSON type actually stored (string, number, or boolean). A plain
 * `attributes @> {"key": "value"}` containment match only hits when the
 * stored value is itself a JSON string, so a log stored with
 * `{"retries": 3}` would never match `attr.retries=3` -- JSONB
 * containment is type-strict.
 *
 * To honor "compared as strings" while still using the jsonb_path_ops
 * GIN index (rather than a full scan with a cast), we OR together
 * containment checks against the value's string form and, where
 * syntactically valid, its number/boolean form. Each branch alone is
 * index-eligible; Postgres can use a BitmapOr across them.
 *
 * All values are passed as postgres.js bind parameters (never
 * string-concatenated), so this is immune to SQL injection regardless of
 * what the client sends as a filter value.
 */
function buildAttrCondition(
  sql: postgres.Sql,
  key: string,
  value: string,
): postgres.Fragment {
  const variants: (string | number | boolean)[] = [value];

  if (value === "true" || value === "false") {
    variants.push(value === "true");
  }
  // Only treat as numeric if the string round-trips cleanly -- avoids
  // misinterpreting things like "007" or "1e10" in surprising ways while
  // still covering the common integer/float attribute case.
  if (value.trim().length > 0 && !Number.isNaN(Number(value))) {
    const n = Number(value);
    if (String(n) === value) {
      variants.push(n);
    }
  }

  const branches = variants.map(
    (v) => sql`attributes @> ${JSON.stringify({ [key]: v })}::jsonb`,
  );

  return branches.reduce((acc, branch) => sql`(${acc} OR ${branch})`);
}

/**
 * Builds the combined WHERE condition (as a postgres.js Fragment) for
 * the shared filters. Returns null when there are no filters, so
 * callers can decide whether to prefix with WHERE or AND.
 */
export function buildFilterConditions(
  sql: postgres.Sql,
  filters: ParsedFilters,
): postgres.Fragment | null {
  const conditions: postgres.Fragment[] = [];

  if (filters.service !== undefined) {
    conditions.push(sql`service = ${filters.service}`);
  }
  if (filters.level !== undefined) {
    conditions.push(sql`level = ${filters.level}`);
  }
  if (filters.q !== undefined) {
    const pattern = "%" + escapeLike(filters.q) + "%";
    conditions.push(sql`message ILIKE ${pattern} ESCAPE '\\'`);
  }
  for (const [key, value] of Object.entries(filters.attrs)) {
    conditions.push(buildAttrCondition(sql, key, value));
  }

  if (conditions.length === 0) return null;

  return conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
}