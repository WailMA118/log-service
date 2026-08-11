![CI Status](https://github.com/WailMA118/log-service/actions/workflows/ci.yml/badge.svg)

# Log Ingestion and Query Service

A high-throughput log ingestion and query service backed by partitioned PostgreSQL, built with Node.js, Express, and raw `postgres.js` (no ORM on the hot path or anywhere else — the query layer, ingestion layer, and retention layer are all plain parameterized SQL).

---

## Table of Contents

- [Setup Instructions](#setup-instructions)
- [API Documentation](#api-documentation)
- [Schema Design](#schema-design)
- [Index Design](#index-design)
- [Attribute Storage Strategy](#attribute-storage-strategy)
- [Retention Strategy](#retention-strategy)
- [Load-Test Methodology](#load-test-methodology)
- [Measured Performance Results](#measured-performance-results)
- [Known Limitations](#known-limitations)
- [Optional Features & Configuration](#optional-features--configuration)

---

## Setup Instructions

### Prerequisites

- Docker and Docker Compose
- Node.js 22 (only needed for local development outside Docker — see `.nvmrc`)

### Run with Docker Compose

```bash
docker compose up --build
```

This starts two containers:

- **`postgres`** — Postgres 16, capped at 1 CPU / 1 GB RAM (matching the project's target resource envelope), with a persistent named volume (`pgdata`).
- **`app`** — the Node service, capped at 0.5 CPU / 256 MB RAM, exposed on `localhost:8080`.

The `app` container waits for `postgres`'s healthcheck before starting, then:
1. Waits for a live DB connection (`waitForDatabase`, with retries).
2. Applies any unapplied `.sql` files under `src/db/migrations/` via a custom migration runner (see [Schema Design](#schema-design) for why this isn't `drizzle-kit`'s built-in migrator or any ORM migration tool).
3. Starts the retention scheduler (see [Retention Strategy](#retention-strategy)).
4. Starts listening on port 8080.

`GET /health` only returns `200` once steps 1–2 above are complete — the load generator (or you) can poll it safely before sending traffic.

```bash
curl http://localhost:8080/health
```

### Environment Variables

Copy `.env.example` to `.env` to override any default:

```bash
cp .env.example .env
```

See [Optional Features & Configuration](#optional-features--configuration) for the full list of variables, defaults, and what each one controls.

### Local Development (without Docker)

```bash
npm install
npm run build      # tsc + copies .sql migrations into dist/ (see note below)
npm run dev         # build + node dist/index.js
npm run test        # vitest --run
npm run lint         # eslint src
npm run format:check
```

> **Why `npm run build` matters even for tests:** `tsc` only compiles `.ts` → `.js`; it does not copy the hand-written `.sql` migration files into `dist/`. `scripts/copy-migrations.mjs` does that as a second build step. If you ever see `[migrate] no migrations directory found; skipping migration run` in the logs, it means this step didn't run — check that `npm run build` (not a bare `tsc`) is what actually produced `dist/`.

---

## API Documentation

All endpoints listen on port `8080`. All error responses use `{ "error": "<description>" }` except `POST /logs`'s per-entry rejections (see below).

### `GET /health`

Returns `200` once the DB is connected and migrations are applied; `503` with `{ "status": "starting" }` before that. `200` responses return `{ "status": "ok" }`.

### `POST /logs`

Accepts a batch (a single-entry batch is valid):

```json
{
  "logs": [
    {
      "timestamp": "2026-07-20T14:32:01.123Z",
      "level": "error",
      "service": "checkout",
      "message": "payment declined",
      "attributes": { "user_id": "42", "region": "eu-west", "retries": 3 }
    }
  ]
}
```

**Validation** (per entry — one invalid entry never fails the whole batch):

| Field | Rule | Rejection reason (exact string) |
|---|---|---|
| `timestamp` | required, valid ISO 8601, not >5 min in the future | `timestamp is required` / `timestamp must be a string` / `invalid timestamp: '<value>'` / `timestamp must not be more than five minutes in the future` |
| `level` | required, one of `debug`/`info`/`warn`/`error` | `level is required` / `invalid level: '<value>'` |
| `service` | required, non-empty string (whitespace-only counts as empty) | `service is required and must be a non-empty string` |
| `message` | required, non-empty string (whitespace-only counts as empty) | `message is required and must be a non-empty string` |
| `attributes` | optional; flat object; values must be string/number/boolean (no nesting/arrays) | `attributes must be a flat object with string, number, or boolean values` |

**Response:** `200` if at least one entry is accepted, `400` if all are rejected, if the body is malformed JSON, or if the top-level shape isn't `{ logs: [...] }`.

```json
{ "accepted": 9, "rejected": [{ "index": 3, "reason": "invalid level: 'critical'" }] }
```

Inserts use `INSERT ... SELECT * FROM UNNEST(...)` with explicit array-type OIDs (see inline comments in `src/routes/logs.ts`) — the query text is identical regardless of batch size, so Postgres can reuse a single cached plan across every request instead of re-planning per batch size.

### `GET /logs`

All query params optional and freely combinable:

| Param | Meaning |
|---|---|
| `service` | exact match |
| `level` | exact match |
| `since` / `until` | inclusive / exclusive time range |
| `attr.<key>` | attribute equality, compared as strings (see [Attribute Storage Strategy](#attribute-storage-strategy)) |
| `q` | case-insensitive substring match on `message` |
| `limit` | default `100`, max `1000` |
| `cursor` | opaque keyset cursor from a previous response's `next_cursor` |

Sorted by `timestamp DESC`, tie-broken by `id DESC` for deterministic ordering. `next_cursor` is `null` when there's no next page. Invalid params (bad timestamps, `until < since`, bad level, non-numeric/out-of-range limit, malformed cursor) return `400`.

### `GET /logs/aggregate`

Same filters as `GET /logs` (`service`, `level`, `attr.<key>`, `q`), plus:

| Param | Required | Meaning |
|---|---|---|
| `since` / `until` | Yes | aggregation range |
| `bucket` | Yes | one of `1m`, `5m`, `1h`, `1d` |
| `group_by` | No | `service` or `level` |

Buckets are computed with Postgres's `date_bin()`, anchored to `since` so bucket boundaries are predictable regardless of wall-clock time. Response rows are ordered ascending by bucket start; `group` is `null` when `group_by` is omitted; empty buckets are omitted.

```json
{ "buckets": [{ "start": "2026-07-20T14:00:00Z", "group": "checkout", "count": 118 }] }
```

---

## Schema Design

```sql
CREATE TABLE "logs" (
  "id" bigint GENERATED ALWAYS AS IDENTITY,
  "timestamp" timestamptz NOT NULL,
  "level" log_level NOT NULL,
  "service" text NOT NULL,
  "message" text NOT NULL,
  "attributes" jsonb DEFAULT '{}'::jsonb,
  PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");
```

**Partitioned by day on `timestamp`.** This is the single most consequential schema decision in the project, because it's what makes retention cheap: dropping a day-old partition is an O(1) metadata operation, versus a `DELETE` that has to scan matching rows, generate WAL for each one, and leave the table bloated until a subsequent `VACUUM`. Partition pruning also means a query with a `since`/`until` filter never has to touch partitions outside that range, shrinking the scan surface before any index is even consulted.

**Composite primary key `(id, timestamp)`, not just `id`.** Postgres requires the partition key to be part of every unique constraint on a partitioned table, since uniqueness can only be enforced per-partition (there's no cross-partition unique index in native declarative partitioning). `id` alone can't be the PK here.

**`BIGINT GENERATED ALWAYS AS IDENTITY`, not UUID.** Sequential IDs avoid the B-tree page-split / random-write overhead that UUIDv4 primary keys cause under high insert rates — every insert lands at the right edge of the index instead of a random position.

**Rolling partition window + a `logs_default` catch-all.** The initial migration seeds partitions for `today - 3` through `today + 4` (a week-wide safety margin so a fresh `docker compose up` never hits a missing partition immediately). The retention job (below) keeps rolling this window forward. `logs_default` exists because the API's validation only rejects timestamps more than 5 minutes in the *future* — it places no lower bound on the past, so a client backfilling an old log is fully within the contract, and without a default partition that legitimate request would hard-fail with `no partition of relation "logs" found for row`. `logs_default` is never itself partitioned or dropped by the retention job (see [Known Limitations](#known-limitations)).

---

## Index Design

Four indexes, declared once on the parent table — Postgres propagates them to every partition (existing and future) automatically:

| Index | Type | Serves |
|---|---|---|
| `(service, level, timestamp DESC)` | btree | `GET /logs` filtered by `service`/`level`, sorted by time — the dominant query shape |
| `(timestamp DESC, id DESC)` | btree | Keyset pagination and pure time-range queries; matches the `ORDER BY` used for deterministic sort |
| `attributes` | GIN, `jsonb_path_ops` | `attr.<key>` equality lookups. `jsonb_path_ops` is smaller and faster than the default `jsonb_ops` for `@>` containment, at the cost of not supporting key-existence (`?`) queries — which the API doesn't need |
| `message` | GIN, `gin_trgm_ops` (`pg_trgm`) | The `q` substring search. A plain btree can't serve `ILIKE '%term%'` (non-prefix) efficiently; trigram indexing can |

---

## Attribute Storage Strategy

Attributes are stored as `jsonb` (not a separate EAV table, not per-key columns), because the API contract allows arbitrary keys per log entry with no fixed schema — `jsonb` is the natural fit, and it's what the GIN `jsonb_path_ops` index above is built for.

**The interesting design problem:** the API contract specifies `attr.<key>` as string equality — *"compared as strings"* — regardless of the value's actual stored JSON type. A log stored with `{"retries": 3}` (a JSON number) must still match `?attr.retries=3`. A naive `attributes @> {"retries": "3"}` containment check would miss it, because JSONB containment is type-strict (string `"3"` ≠ number `3`).

The fix (`src/logs/filters.ts`): for each `attr.<key>=value`, build an `OR` across containment checks against the value's string form and, where syntactically valid, its number/boolean form:

```sql
(attributes @> '{"retries":"3"}' OR attributes @> '{"retries":3}')
```

Each branch alone is index-eligible, so Postgres can `BitmapOr` across them — this stays on the GIN index instead of falling back to a full scan with a cast. See [Known Limitations](#known-limitations) for the edge cases this doesn't cover.

---

## Retention Strategy

Configurable via `RETENTION_DAYS` and `RETENTION_SWEEP_INTERVAL_MS` (see [Optional Features & Configuration](#optional-features--configuration)). Implemented in `src/db/retention.ts`.

**Mechanism, not `DELETE`.** Retention works by `DROP TABLE`-ing entire day-partitions once they're older than the retention window — not by deleting matching rows. This is what makes the partitioning decision above pay off: a `DROP` is a near-instant metadata operation with no row-by-row scanning, no WAL bloat, and critically, no long-running lock contention with concurrent inserts (which are always targeting *today's* partition, a completely different table object from the one being dropped).

**One sweep, two jobs.** Each scheduled sweep does two things in a single `DO $$ ... $$` block:
1. **Rolls the window forward** — ensures partitions exist from today through `today + 3` days, so ingestion never has to fall back to `logs_default` just because a sweep hasn't run recently.
2. **Drops expired partitions** — any dated partition (`logs_YYYY_MM_DD`) whose entire range is older than `RETENTION_DAYS` gets dropped. `logs_default` is never matched by this (the discovery query's regex only matches the dated naming pattern) and is never dropped automatically.

**Why a single PL/pgSQL block instead of parameterized queries.** Both operations build table identifiers dynamically (partition names derived from dates), and safe dynamic identifier construction in Postgres goes through `format('%I', ...)` / `format('%L', ...)` — done *inside* Postgres, not by hand-interpolating strings in JS. This mirrors the exact pattern the initial migration already uses to seed partitions.

One real implementation snag worth calling out: `DO $$ ... $$` blocks are anonymous PL/pgSQL blocks, not prepared statements — Postgres does not support external bind parameters (`$1`, `$2`) inside them at all. This was caught by testing against a live Postgres instance, not by inspection; the fix was to inline the two integer config values (`RETENTION_DAYS`, and the fixed 3-day forward buffer) directly into the generated SQL text, which is safe here specifically because both are `number`-typed values sourced from `config.ts`'s own validated env parsing — there's no path from request/user input into either value.

**Isolation from live traffic.** The sweep runs on its own short-lived, single connection (`postgres(DB_URL, { max: 1 })`) — separate from both the query pool and the ingest pool — mirroring the same pattern the migration runner uses, so periodic maintenance work can never compete with live requests for a pooled connection slot.

**Scheduling.** An initial sweep runs once at startup (non-blocking — it doesn't gate `/health` becoming ready, since the migration's own 7-day seed already covers immediate needs), then recurring sweeps run on `RETENTION_SWEEP_INTERVAL_MS` (default: 1 hour) via `setInterval`, cleared on `SIGTERM`/`SIGINT`.

---

## Load-Test Methodology

*(Methodology described here; see [Measured Performance Results](#measured-performance-results) for the numbers.)*

- **Environment:** containers run at the resource limits specified in `docker-compose.yml` — Postgres capped at 1 CPU / 1 GB RAM, app capped at 0.5 CPU / 256 MB RAM — so measured numbers reflect the actual constrained target environment, not an unconstrained dev machine.
- **Ingestion:** `POST /logs` driven with batched requests (batch size and concurrency to be recorded alongside the results below), sustained over a multi-minute window to observe steady-state throughput rather than a burst.
- **Dataset size:** target ~1,000,000 rows, representing roughly one month of data, per the project's stated assumption.
- **Query load during ingestion:** `GET /logs/aggregate` (the primary aggregation query) issued at roughly 1 request/second concurrently with sustained ingestion, to verify query latency doesn't degrade under write load.
- **Freshness check:** newly ingested rows verified queryable via `GET /logs` within the 20-second target window.
- **Resource observation:** `docker stats` (or equivalent) monitored during the run to correlate throughput/latency against actual CPU and memory usage inside the constrained containers.

---

## Measured Performance Results

*To be added.*

---

## Known Limitations

- **`attr.<key>` string-comparison matching isn't exhaustive.** The multi-variant `OR` approach (see [Attribute Storage Strategy](#attribute-storage-strategy)) covers string/number/boolean forms that round-trip cleanly through `String(Number(value))`, but misses edge cases like `attr.retries=3.0` failing to match a stored `{"retries": 3}` (since `String(3) === "3"`, not `"3.0"`). A fully exhaustive text-cast comparison (`attributes ->> key = value`) would close this gap but forces a full scan instead of using the GIN index — this is a deliberate performance/correctness tradeoff, not an oversight.
- **`q` substring search doesn't escape LIKE wildcards.** A search value containing `%` or `_` is interpreted as a SQL `LIKE` wildcard rather than a literal character (e.g. `q=50%` matches "any text, then 50, then anything" rather than the literal string "50%").
- **`logs_default` isn't itself partitioned or automatically pruned.** It exists to accept legitimately old backfilled data (see [Schema Design](#schema-design)) but isn't bounded — heavy backfill traffic, or the retention job falling behind, could let it grow large enough to lose the query-performance benefits partitioning provides elsewhere. It's monitored only via `RAISE NOTICE` log output during sweeps, not alerted on.
- **No horizontal scaling coordination for the retention scheduler.** Each app instance runs its own sweep independently. The sweep is idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP TABLE IF EXISTS`) so running it from multiple instances concurrently is safe, but wasteful — there's no leader election.
- **No authentication, rate limiting, multi-tenancy, or backpressure.** Out of scope for this submission's core requirements; noted as stretch goals in the project description that weren't implemented.
- **The keyset pagination cursor is unsigned.** It's opaque base64url-encoded JSON, not cryptographically signed. A client could decode and hand-tamper it; the worst case is a malformed cursor being rejected (`400`) or a technically-valid-but-fabricated cursor returning an unexpected page slice — not a security issue, since the resulting query is still fully parameterized, but worth knowing it's not tamper-evident.
- **Single Postgres instance, no read replica.** All reads and writes hit the same instance; acceptable at the target 1M-row / one-CPU scale this project is sized for, but not a design that scales past it without further work.

---

## Optional Features & Configuration

All configuration is via environment variables (see `.env.example`), parsed in `src/config.ts`. Every variable below has a working default — none are required to start the service.

| Variable | Default | Controls |
|---|---|---|
| `PORT` | `3000` (Docker sets `8080`) | HTTP listen port |
| `DB_URL` | `postgres://localhost:5432/logs` | Postgres connection string |
| `DB_QUERY_POOL_MAX` | `6` | Max connections in the read/query pool (`GET /logs`, `GET /logs/aggregate`, health checks) |
| `DB_INGEST_POOL_MAX` | `12` | Max connections in the write/ingest pool (`POST /logs` only) — kept separate from the query pool so a burst of expensive aggregate queries can never starve ingestion throughput, and vice versa |
| `RETENTION_DAYS` | `30` | How many days of data to retain before a partition is dropped |
| `RETENTION_SWEEP_INTERVAL_MS` | `3600000` (1 hour) | How often the retention sweep runs |

> All six variables above are forwarded from `.env` into the `app` container via `docker-compose.yml`'s `environment` block, using `${VAR:-default}` so each one falls back to the same default `config.ts` would use if left unset — overriding any of them only requires setting it in `.env` before `docker compose up`.