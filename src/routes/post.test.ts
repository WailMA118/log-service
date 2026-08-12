import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withServer } from "../test-utils/http.js";

// Well-known Postgres builtin array-type OIDs that src/routes/logs.ts's
// insertBatch() must pass explicitly to ingestClient.array(...) for
// UNNEST to bind each parameter as an array rather than a scalar (see
// the detailed comment in logs.ts for why this matters). Hardcoded here
// rather than imported, since they're not exported from logs.ts and
// re-declaring stable, well-known Postgres constants in a test is
// simpler than exporting internal implementation details purely for
// test convenience.
const OID_TIMESTAMPTZ_ARRAY = 1185;
const OID_TEXT_ARRAY = 1009;
const OID_JSONB_ARRAY = 3807;

const { mockIngestClient } = vi.hoisted(() => ({
  mockIngestClient: Object.assign(vi.fn(), { array: vi.fn() }),
}));

vi.mock("../db/client.js", () => ({
  ingestClient: mockIngestClient,
  queryClient: vi.fn(),
}));

import { createApp } from "../app.js";

function postLogs(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/logs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_LOG = {
  timestamp: new Date(Date.now() - 1000).toISOString(),
  level: "info",
  service: "api",
  message: "request received",
  attributes: { source: "unit-test", success: true, retries: 3 },
};

describe("POST /logs", () => {
  beforeEach(() => {
    mockIngestClient.mockReset();
    mockIngestClient.array.mockReset();
    mockIngestClient.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        undefined,
    );
    mockIngestClient.array.mockImplementation((values: unknown[]) => ({
      values,
    }));
  });

  afterEach(() => {
    mockIngestClient.mockReset();
    mockIngestClient.array.mockReset();
  });

  describe("request shape validation", () => {
    it("returns 400 when the request body has no 'logs' array", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, { notLogs: [] }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "request body must be an object with a 'logs' array",
      });
      expect(mockIngestClient).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON in the request body", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        fetch(`${baseUrl}/logs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{ this is not valid json",
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "malformed JSON in request body",
      });
      expect(mockIngestClient).not.toHaveBeenCalled();
    });

    it("returns 400 when 'logs' is present but not an array", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, { logs: "not-an-array" }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "request body must be an object with a 'logs' array",
      });
    });
  });

  describe("batch validation behavior", () => {
    it("returns 400 with per-entry reasons when every entry is rejected", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, {
          logs: [
            {
              timestamp: "not-a-timestamp",
              level: "info",
              service: "api",
              message: "hello",
            },
          ],
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        accepted: 0,
        rejected: [
          { index: 0, reason: "invalid timestamp: 'not-a-timestamp'" },
        ],
      });
      expect(mockIngestClient).not.toHaveBeenCalled();
    });

    it("returns 200 for a mixed batch, inserting only the accepted entries", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, {
          logs: [VALID_LOG, { ...VALID_LOG, level: "not-a-level" }, VALID_LOG],
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        accepted: 2,
        rejected: [{ index: 1, reason: "invalid level: 'not-a-level'" }],
      });
      expect(mockIngestClient).toHaveBeenCalledTimes(1);

      // Every array column passed to the insert should have exactly 2
      // elements -- the invalid entry must not leak through.
      for (const [values] of mockIngestClient.array.mock.calls) {
        expect((values as unknown[]).length).toBe(2);
      }
    });

    it("accepts a single-entry batch and returns the accepted count", async () => {
      const response = await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, { logs: [VALID_LOG] }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: 1, rejected: [] });
      expect(mockIngestClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("insert wiring (regression coverage)", () => {
    it("passes each array-typed column with its correct Postgres array OID", async () => {
      await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, { logs: [VALID_LOG] }),
      );

      const oidsUsed = mockIngestClient.array.mock.calls.map(([, oid]) => oid);

      // timestamp, level (as text[], cast to log_level[] in the SQL
      // text), service, message, attributes -- five array() calls total.
      expect(oidsUsed).toEqual([
        OID_TIMESTAMPTZ_ARRAY,
        OID_TEXT_ARRAY, // level
        OID_TEXT_ARRAY, // service
        OID_TEXT_ARRAY, // message
        OID_JSONB_ARRAY,
      ]);
    });

    it("passes attributes as a raw object, never pre-serialized with JSON.stringify (regression: double JSON encoding)", async () => {
      await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, { logs: [VALID_LOG] }),
      );

      const attributesCall = mockIngestClient.array.mock.calls.find(
        ([, oid]) => oid === OID_JSONB_ARRAY,
      );
      expect(attributesCall).toBeDefined();

      const [values] = attributesCall as [unknown[], number];
      expect(values).toHaveLength(1);
      // Must be the parsed object, not a JSON string of it -- pre-
      // stringifying here previously caused Postgres to store a jsonb
      // *string* containing our JSON text, instead of a jsonb *object*
      // (confirmed against a live Postgres instance).
      expect(typeof values[0]).not.toBe("string");
      expect(values[0]).toEqual(VALID_LOG.attributes);
    });

    it("returns 500 when the database insert fails, without leaking the raw error", async () => {
      mockIngestClient.mockImplementationOnce(async () => {
        throw new Error("connection terminated unexpectedly");
      });

      const response = await withServer(createApp(), (baseUrl) =>
        postLogs(baseUrl, { logs: [VALID_LOG] }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "internal error while storing logs",
      });
    });
  });
});