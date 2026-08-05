import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = [
  {
    id: 1,
    timestamp: new Date("2026-08-05T12:00:00.000Z"),
    level: "info",
    service: "api",
    message: "log entry",
    attributes: { source: "unit-test", success: true },
  },
];

vi.mock("../db/client.js", () => {
  const mockDb = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => mockRows,
          }),
        }),
      }),
    })),
  };

  return {
    ingestClient: vi.fn(),
    db: mockDb,
  };
});

import { createApp } from "../app.js";
import { db } from "../db/client.js";

const mockDb = db as { select: ReturnType<typeof vi.fn> };

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

describe("GET /logs", () => {
  beforeEach(() => {
    mockDb.select.mockClear();
  });

  it("returns a page of logs", async () => {
    const response = await withServer((baseUrl) => fetch(`${baseUrl}/logs`));

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
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("returns 400 for invalid limit values", async () => {
    const response = await withServer((baseUrl) =>
      fetch(`${baseUrl}/logs?limit=abc`),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "limit must be a non-negative integer",
    });
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
