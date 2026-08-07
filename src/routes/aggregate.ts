import { Router, type Request, type Response } from "express";
import { queryClient } from "../db/client.js";
import { parseSharedFilters, buildFilterConditions } from "../logs/filters.js";

export const aggregateRouter = Router();

const BUCKET_INTERVALS: Record<string, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "1h": "1 hour",
  "1d": "1 day",
};

type GroupBy = "service" | "level" | null;

function parseRequiredTime(
  value: unknown,
  paramName: string,
): { ok: true; date: Date } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: false, error: `${paramName} is required` };
  }
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

function parseBucket(
  value: unknown,
): { ok: true; interval: string } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: false, error: "bucket is required" };
  }
  if (typeof value !== "string" || !(value in BUCKET_INTERVALS)) {
    return { ok: false, error: "bucket must be one of: 1m, 5m, 1h, 1d" };
  }
  // eslint-disable-next-line security/detect-object-injection -- value is already narrowed by the `in` check above to one of the four fixed literal keys of BUCKET_INTERVALS, not arbitrary request input
  return { ok: true, interval: BUCKET_INTERVALS[value] };
}

function parseGroupBy(
  value: unknown,
): { ok: true; groupBy: GroupBy } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, groupBy: null };
  if (value !== "service" && value !== "level") {
    return { ok: false, error: "group_by must be one of: service, level" };
  }
  return { ok: true, groupBy: value };
}

type AggregateRow = {
  bucket_start: Date;
  group_value: string | null;
  count: string;
};

aggregateRouter.get("/logs/aggregate", async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;

  const filters = parseSharedFilters(query);
  if ("error" in filters) {
    res.status(400).json({ error: filters.error });
    return;
  }

  const since = parseRequiredTime(query.since, "since");
  if (!since.ok) {
    res.status(400).json({ error: since.error });
    return;
  }
  const until = parseRequiredTime(query.until, "until");
  if (!until.ok) {
    res.status(400).json({ error: until.error });
    return;
  }
  if (until.date.getTime() < since.date.getTime()) {
    res.status(400).json({ error: "until must not be earlier than since" });
    return;
  }

  const bucketResult = parseBucket(query.bucket);
  if (!bucketResult.ok) {
    res.status(400).json({ error: bucketResult.error });
    return;
  }
  const { interval } = bucketResult;

  const groupByResult = parseGroupBy(query.group_by);
  if (!groupByResult.ok) {
    res.status(400).json({ error: groupByResult.error });
    return;
  }
  const { groupBy } = groupByResult;

  const sql = queryClient;
  const filterCondition = buildFilterConditions(sql, filters);

  const timeConditions = [
    sql`timestamp >= ${since.date}`,
    sql`timestamp < ${until.date}`,
    filterCondition,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  const whereClause = timeConditions.reduce(
    (acc, cond) => sql`${acc} AND ${cond}`,
  );

  // date_bin "bins" each row's timestamp into fixed-size intervals
  // aligned to an origin point -- using `since` as the origin means
  // bucket boundaries always start exactly at the query's requested
  // start time.
  const bucketExpr = sql`date_bin(${interval}::interval, timestamp, ${since.date}::timestamptz)`;

  const groupColumnSql =
    groupBy === "service"
      ? sql`service`
      : groupBy === "level"
        ? sql`level`
        : sql`NULL`;

  const rows = await sql<AggregateRow[]>`
    SELECT
      ${bucketExpr} AS bucket_start,
      ${groupColumnSql} AS group_value,
      count(*) AS count
    FROM logs
    WHERE ${whereClause}
    GROUP BY ${bucketExpr}, ${groupColumnSql}
    ORDER BY ${bucketExpr}
  `;

  const buckets = rows.map((row) => ({
    start: new Date(row.bucket_start).toISOString(),
    group: row.group_value,
    count: Number(row.count),
  }));

  res.status(200).json({ buckets });
});
