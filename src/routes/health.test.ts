import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { setDbConnected, setMigrationsApplied } from "../state/readiness.js";
import { withServer } from "../test-utils/http.js";

describe("GET /health", () => {
  beforeEach(() => {
    setDbConnected(false);
    setMigrationsApplied(false);
  });

  afterEach(() => {
    setDbConnected(false);
    setMigrationsApplied(false);
  });

  it("returns 503 before the DB is connected", async () => {
    const response = await withServer(createApp(), (baseUrl) =>
      fetch(`${baseUrl}/health`),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "starting" });
  });

  it("returns 503 when the DB is connected but migrations haven't run yet", async () => {
    setDbConnected(true);
    setMigrationsApplied(false);

    const response = await withServer(createApp(), (baseUrl) =>
      fetch(`${baseUrl}/health`),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "starting" });
  });

  it("returns 200 once both the DB is connected and migrations are applied", async () => {
    setDbConnected(true);
    setMigrationsApplied(true);

    const response = await withServer(createApp(), (baseUrl) =>
      fetch(`${baseUrl}/health`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
