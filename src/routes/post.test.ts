import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client.js", () => ({
  ingestClient: vi.fn().mockResolvedValue(undefined),
}));

import { createApp } from "../app.js";
import { ingestClient } from "../db/client.js";

const mockIngestClient = vi.mocked(ingestClient);

async function withServer<T>(callback: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to get server address");
  }

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("POST /logs", () => {
  beforeEach(() => {
    mockIngestClient.mockClear();
  });

  afterEach(() => {
    mockIngestClient.mockClear();
  });

  it("returns 400 when the request body does not contain a logs array", async () => {
    const response = await withServer((baseUrl) =>
      fetch(`${baseUrl}/logs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notLogs: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "request body must be an object with a 'logs' array",
    });
    expect(mockIngestClient).not.toHaveBeenCalled();
  });

  it("returns 400 when no entries are accepted", async () => {
    const response = await withServer((baseUrl) =>
      fetch(`${baseUrl}/logs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logs: [
            {
              timestamp: "not-a-timestamp",
              level: "info",
              service: "api",
              message: "hello",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      accepted: 0,
      rejected: [
        {
          index: 0,
          reason: "invalid timestamp: 'not-a-timestamp'",
        },
      ],
    });
    expect(mockIngestClient).not.toHaveBeenCalled();
  });

  it("accepts valid entries and returns the accepted count", async () => {
    const validLog = {
      timestamp: new Date(Date.now() - 1000).toISOString(),
      level: "info",
      service: "api",
      message: "request received",
      attributes: { source: "unit-test", success: true },
    };

    const response = await withServer((baseUrl) =>
      fetch(`${baseUrl}/logs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logs: [validLog] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1, rejected: [] });
    expect(mockIngestClient).toHaveBeenCalled();
  });
});
