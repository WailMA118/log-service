import { beforeEach, describe, expect, it, vi } from "vitest";
import { withServer } from "../test-utils/http.js";

const { mockQueryClient } = vi.hoisted(() => ({
  mockQueryClient: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  ingestClient: vi.fn(),
  queryClient: mockQueryClient,
}));

import { createApp } from "../app.js";

function getAggregate(baseUrl: string, query: string) {
  return fetch(`${baseUrl}/logs/aggregate${query}`);
}

const VALID_RANGE =
  "since=2026-08-05T12:00:00.000Z&until=2026-08-05T13:00:00.000Z&bucket=1h";

describe("GET /logs/aggregate", () => {
  beforeEach(() => {
    mockQueryClient.mockReset();
  });

  describe("happy path", () => {
    it("returns grouped buckets when group_by is provided", async () => {
      mockQueryClient.mockImplementation(async () => [
        {
          bucket_start: new Date("2026-08-05T12:00:00.000Z"),
          group_value: "checkout",
          count: "118",
        },
        {
          bucket_start: new Date("2026-08-05T12:00:00.000Z"),
          group_value: "auth",
          count: "42",
        },
      ]);

      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, `?${VALID_RANGE}&group_by=service`),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        buckets: [
          { start: "2026-08-05T12:00:00.000Z", group: "checkout", count: 118 },
          { start: "2026-08-05T12:00:00.000Z", group: "auth", count: 42 },
        ],
      });
    });

    it("returns group: null for every bucket when group_by is omitted", async () => {
      // Regression coverage: an earlier version of this query put a bare
      // `NULL` literal into GROUP BY for the ungrouped case, which
      // Postgres rejects ("non-integer constant in GROUP BY") since it
      // treats a literal in GROUP BY as an attempted positional/ordinal
      // reference. Confirmed against a live Postgres instance, both
      // before and after the fix.
      mockQueryClient.mockImplementation(async () => [
        {
          bucket_start: new Date("2026-08-05T12:00:00.000Z"),
          group_value: null,
          count: "160",
        },
      ]);

      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, `?${VALID_RANGE}`),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        buckets: [
          { start: "2026-08-05T12:00:00.000Z", group: null, count: 160 },
        ],
      });
    });

    it("returns an empty buckets array when there is no data in range", async () => {
      mockQueryClient.mockImplementation(async () => []);

      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, `?${VALID_RANGE}`),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ buckets: [] });
    });

    it("passes shared filters (service, level, attr.<key>, q) through alongside the aggregation params", async () => {
      mockQueryClient.mockImplementation(async () => []);

      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(
          baseUrl,
          `?${VALID_RANGE}&service=checkout&level=error&q=declined&attr.user_id=42`,
        ),
      );

      expect(response.status).toBe(200);
      expect(mockQueryClient).toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("returns 400 when since is missing", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, "?until=2026-08-05T13:00:00.000Z&bucket=1h"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "since is required" });
      expect(mockQueryClient).not.toHaveBeenCalled();
    });

    it("returns 400 when until is missing", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, "?since=2026-08-05T12:00:00.000Z&bucket=1h"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "until is required" });
    });

    it("returns 400 when bucket is missing", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(
          baseUrl,
          "?since=2026-08-05T12:00:00.000Z&until=2026-08-05T13:00:00.000Z",
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bucket is required" });
    });

    it("returns 400 for an unsupported bucket value", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(
          baseUrl,
          "?since=2026-08-05T12:00:00.000Z&until=2026-08-05T13:00:00.000Z&bucket=3h",
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "bucket must be one of: 1m, 5m, 1h, 1d",
      });
    });

    it("returns 400 for an invalid group_by value", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, `?${VALID_RANGE}&group_by=host`),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "group_by must be one of: service, level",
      });
    });

    it("returns 400 when until is earlier than since", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(
          baseUrl,
          "?since=2026-08-05T13:00:00.000Z&until=2026-08-05T12:00:00.000Z&bucket=1h",
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "until must not be earlier than since",
      });
    });

    it("returns 400 for an invalid since timestamp", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(
          baseUrl,
          "?since=not-a-date&until=2026-08-05T13:00:00.000Z&bucket=1h",
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid timestamp for since: 'not-a-date'",
      });
    });

    it("returns 400 for an invalid level filter", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getAggregate(baseUrl, `?${VALID_RANGE}&level=critical`),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid level: 'critical'",
      });
    });
  });
});