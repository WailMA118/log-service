import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQueryClient } = vi.hoisted(() => ({
  mockQueryClient: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  ingestClient: vi.fn(),
  queryClient: mockQueryClient,
}));

import { createApp } from "../app.js";

async function withServer<T>(
  callback: (baseUrl: string) => Promise<T>,
): Promise<T> {
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

describe("GET /logs/aggregate", () => {
  beforeEach(() => {
    mockQueryClient.mockReset();
    mockQueryClient.mockImplementation(async () => [
      {
        bucket_start: new Date("2026-08-05T12:00:00.000Z"),
        group_value: "api",
        count: "2",
      },
    ]);
  });

  it("returns aggregated buckets for valid params", async () => {
    const response = await withServer((baseUrl) =>
      fetch(
        `${baseUrl}/logs/aggregate?since=2026-08-05T12:00:00.000Z&until=2026-08-05T13:00:00.000Z&bucket=1h&group_by=service`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      buckets: [
        {
          start: "2026-08-05T12:00:00.000Z",
          group: "api",
          count: 2,
        },
      ],
    });
    expect(mockQueryClient).toHaveBeenCalled();
  });

  it("returns 400 when bucket is missing", async () => {
    const response = await withServer((baseUrl) =>
      fetch(
        `${baseUrl}/logs/aggregate?since=2026-08-05T12:00:00.000Z&until=2026-08-05T13:00:00.000Z&group_by=service`,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "bucket is required",
    });
    expect(mockQueryClient).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid group_by value", async () => {
    const response = await withServer((baseUrl) =>
      fetch(
        `${baseUrl}/logs/aggregate?since=2026-08-05T12:00:00.000Z&until=2026-08-05T13:00:00.000Z&bucket=1h&group_by=invalid`,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "group_by must be one of: service, level",
    });
    expect(mockQueryClient).not.toHaveBeenCalled();
  });
});
