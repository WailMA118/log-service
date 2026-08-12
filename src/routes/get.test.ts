import { beforeEach, describe, expect, it, vi } from "vitest";
import { withServer } from "../test-utils/http.js";
import { decodeCursor, encodeCursor } from "../logs/cursor.js";

type MockLogRow = {
  id: string;
  timestamp: Date;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean> | null;
};

function makeRow(overrides: Partial<MockLogRow> = {}): MockLogRow {
  return {
    id: "1",
    timestamp: new Date("2026-08-05T12:00:00.000Z"),
    level: "info",
    service: "api",
    message: "log entry",
    attributes: { source: "unit-test", success: true },
    ...overrides,
  };
}

const { mockQueryClient } = vi.hoisted(() => ({
  mockQueryClient: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  ingestClient: vi.fn(),
  queryClient: mockQueryClient,
}));

import { createApp } from "../app.js";

function getLogs(baseUrl: string, query = "") {
  return fetch(`${baseUrl}/logs${query}`);
}

describe("GET /logs", () => {
  beforeEach(() => {
    mockQueryClient.mockReset();
    mockQueryClient.mockImplementation(async () => [makeRow()]);
  });

  describe("happy path", () => {
    it("returns a page of logs with id returned as a string", async () => {
      // postgres.js returns bigint columns (like `id`) as strings by
      // default, to avoid silent precision loss for values beyond
      // Number.MAX_SAFE_INTEGER -- the response shape must reflect that,
      // not coerce id back into a JS number.
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        logs: [
          {
            id: "1",
            timestamp: "2026-08-05T12:00:00.000Z",
            level: "info",
            service: "api",
            message: "log entry",
            attributes: { source: "unit-test", success: true },
          },
        ],
        next_cursor: null,
      });
    });

    it("defaults a null attributes column to an empty object", async () => {
      mockQueryClient.mockImplementation(async () => [
        makeRow({ attributes: null }),
      ]);

      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl),
      );

      const body = (await response.json()) as {
        logs: { attributes: unknown }[];
      };
      expect(body.logs[0].attributes).toEqual({});
    });

    it("returns next_cursor: null when there is no next page", async () => {
      mockQueryClient.mockImplementation(async () => [makeRow()]);

      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?limit=5"),
      );

      const body = (await response.json()) as { next_cursor: unknown };
      expect(body.next_cursor).toBeNull();
    });

    it("returns a populated next_cursor when more results exist than the page limit", async () => {
      // The route fetches limit+1 rows to detect a next page without
      // exposing the extra row. With limit=2, returning 3 mock rows
      // simulates "there's more data after this page".
      const rows = [
        makeRow({ id: "3", timestamp: new Date("2026-08-05T12:02:00.000Z") }),
        makeRow({ id: "2", timestamp: new Date("2026-08-05T12:01:00.000Z") }),
        makeRow({ id: "1", timestamp: new Date("2026-08-05T12:00:00.000Z") }),
      ];
      mockQueryClient.mockImplementation(async () => rows);

      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?limit=2"),
      );

      const body = (await response.json()) as {
        logs: { id: string }[];
        next_cursor: string | null;
      };

      // Only the first `limit` rows are returned to the client.
      expect(body.logs).toHaveLength(2);
      expect(body.logs.map((l) => l.id)).toEqual(["3", "2"]);
      expect(body.next_cursor).not.toBeNull();

      // The cursor must describe exactly the last row ON the returned
      // page (row id "2"), not the extra lookahead row.
      const decoded = decodeCursor(body.next_cursor as string);
      expect(decoded).toEqual({
        timestamp: "2026-08-05T12:01:00.000Z",
        id: 2,
      });
    });
  });

  describe("query parameter validation", () => {
    it("returns 400 for a non-numeric limit", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?limit=abc"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "limit must be a non-negative integer",
      });
      expect(mockQueryClient).not.toHaveBeenCalled();
    });

    it("returns 400 when limit is 0", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?limit=0"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "limit must be between 1 and 1000",
      });
    });

    it("returns 400 when limit exceeds the maximum", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?limit=1001"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "limit must be between 1 and 1000",
      });
    });

    it("returns 400 for an invalid 'since' timestamp", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?since=not-a-date"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid timestamp for since: 'not-a-date'",
      });
    });

    it("returns 400 for an invalid 'until' timestamp", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?until=not-a-date"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid timestamp for until: 'not-a-date'",
      });
    });

    it("returns 400 when until is earlier than since", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(
          baseUrl,
          "?since=2026-08-05T12:00:00.000Z&until=2026-08-05T10:00:00.000Z",
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "until must not be earlier than since",
      });
    });

    it("returns 400 for an invalid level filter", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?level=critical"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid level: 'critical'",
      });
    });

    it("returns 400 for a malformed cursor", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, "?cursor=not-a-valid-cursor!!!"),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid or malformed cursor",
      });
      expect(mockQueryClient).not.toHaveBeenCalled();
    });

    it("accepts a well-formed cursor from a previous response", async () => {
      const cursor = encodeCursor({
        timestamp: "2026-08-05T12:00:00.000Z",
        id: 5,
      });

      const response = await withServer(createApp(), (baseUrl) =>
        getLogs(baseUrl, `?cursor=${cursor}`),
      );

      expect(response.status).toBe(200);
      expect(mockQueryClient).toHaveBeenCalled();
    });
  });
});