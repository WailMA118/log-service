import { describe, expect, it } from "vitest";
import { parseSharedFilters } from "./filters.js";

/**
 * This file only unit-tests `parseSharedFilters`, the pure query-param
 * parsing half of filters.ts. `buildFilterConditions` (the other half,
 * which composes postgres.js SQL fragments) is deliberately NOT unit
 * tested here with a hand-rolled fake `sql` tag.
 *
 * Reasoning: a fake tag faithful enough to validate real fragment
 * composition would essentially have to reimplement postgres.js's own
 * Builder logic -- and a fake that's slightly wrong would give false
 * confidence rather than real coverage (this project already hit that
 * exact trap once this session: a manually-substituted SQL string
 * "passed" locally while the real parameterized query failed against
 * live Postgres). `buildFilterConditions`'s actual SQL correctness is
 * exercised where it matters -- against a real Postgres instance -- via
 * the docker-e2e job in CI and the route-level tests in
 * routes/get.test.ts and routes/aggregate.test.ts (which mock the DB
 * client at the response-shape level, not the SQL-fragment level).
 */
describe("parseSharedFilters", () => {
  it("returns empty filters when no query params are given", () => {
    const result = parseSharedFilters({});

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.service).toBeUndefined();
    expect(result.level).toBeUndefined();
    expect(result.q).toBeUndefined();
    expect(Object.keys(result.attrs)).toHaveLength(0);
  });

  describe("service", () => {
    it("accepts a valid service filter", () => {
      const result = parseSharedFilters({ service: "checkout" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.service).toBe("checkout");
    });

    it("rejects an empty-string service", () => {
      const result = parseSharedFilters({ service: "" });

      expect(result).toEqual({
        error: "service must be a single non-empty string",
      });
    });

    it("rejects a repeated service param (parsed by Express as an array)", () => {
      const result = parseSharedFilters({ service: ["a", "b"] });

      expect(result).toEqual({
        error: "service must be a single non-empty string",
      });
    });
  });

  describe("level", () => {
    it("accepts a valid level filter", () => {
      const result = parseSharedFilters({ level: "error" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.level).toBe("error");
    });

    it("rejects an invalid level", () => {
      const result = parseSharedFilters({ level: "critical" });

      expect(result).toEqual({ error: "invalid level: 'critical'" });
    });

    it("rejects a repeated level param", () => {
      const result = parseSharedFilters({ level: ["error", "warn"] });

      expect(result).toEqual({ error: "level must be a single string" });
    });
  });

  describe("q", () => {
    it("accepts a valid q filter", () => {
      const result = parseSharedFilters({ q: "declined" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.q).toBe("declined");
    });

    it("rejects a repeated q param", () => {
      const result = parseSharedFilters({ q: ["a", "b"] });

      expect(result).toEqual({ error: "q must be a single string" });
    });
  });

  describe("attr.<key>", () => {
    it("accepts a single attribute filter", () => {
      const result = parseSharedFilters({ "attr.user_id": "42" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.attrs).toEqual({ user_id: "42" });
    });

    it("accepts multiple distinct attribute filters", () => {
      const result = parseSharedFilters({
        "attr.user_id": "42",
        "attr.region": "eu-west",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.attrs).toEqual({ user_id: "42", region: "eu-west" });
    });

    it("rejects an empty attribute key (attr.=value)", () => {
      const result = parseSharedFilters({ "attr.": "value" });

      expect(result).toEqual({
        error: "attribute filter key must not be empty",
      });
    });

    it("rejects a repeated attr.<key> param", () => {
      const result = parseSharedFilters({ "attr.user_id": ["42", "43"] });

      expect(result).toEqual({
        error: "attr.user_id must be a single string",
      });
    });

    it("does not treat unrelated query params as attribute filters", () => {
      const result = parseSharedFilters({ limit: "10", cursor: "abc" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(Object.keys(result.attrs)).toHaveLength(0);
    });

    it("safely accepts attr.__proto__ without touching the object prototype chain", () => {
      // Regression guard: attrs is built on a null-prototype object
      // specifically so a key like "__proto__" can never be interpreted
      // as reaching into Object.prototype.
      const result = parseSharedFilters({ "attr.__proto__": "polluted" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.attrs.__proto__).toBe("polluted");
      // The real Object.prototype must be completely unaffected.
      expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("safely accepts attr.constructor as an ordinary key", () => {
      const result = parseSharedFilters({ "attr.constructor": "weird" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(result.attrs.constructor).toBe("weird");
    });
  });

  it("parses service, level, q, and attr.<key> together in one call", () => {
    const result = parseSharedFilters({
      service: "checkout",
      level: "error",
      q: "declined",
      "attr.user_id": "42",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result).toEqual({
      service: "checkout",
      level: "error",
      q: "declined",
      attrs: { user_id: "42" },
    });
  });
});
