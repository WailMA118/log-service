import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { setDbConnected, setMigrationsApplied } from "../state/readiness.js";

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

describe("GET /health", () => {
  beforeEach(() => {
    setDbConnected(false);
    setMigrationsApplied(false);
  });

  afterEach(() => {
    setDbConnected(false);
    setMigrationsApplied(false);
  });

  it("returns 503 while the service is still starting", async () => {
    const response = await withServer(async (baseUrl) => {
      return fetch(`${baseUrl}/health`);
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "starting" });
  });

  it("returns 200 once the service is ready", async () => {
    setDbConnected(true);
    setMigrationsApplied(true);

    const response = await withServer(async (baseUrl) => {
      return fetch(`${baseUrl}/health`);
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
