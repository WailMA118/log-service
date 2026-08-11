import { describe, expect, it } from "vitest";
import { validateBatch, validateLogEntry } from "./validation.js";

const VALID_ENTRY = {
  timestamp: "2026-07-20T14:32:01.123Z",
  level: "error",
  service: "checkout",
  message: "payment declined",
  attributes: { user_id: "42", region: "eu-west", retries: 3 },
};

describe("validateLogEntry", () => {
  it("accepts a fully valid entry", () => {
    const result = validateLogEntry(VALID_ENTRY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual({
      timestamp: new Date(VALID_ENTRY.timestamp),
      level: "error",
      service: "checkout",
      message: "payment declined",
      attributes: { user_id: "42", region: "eu-west", retries: 3 },
    });
  });

  it("defaults attributes to {} when omitted", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { attributes: _omit, ...withoutAttributes } = VALID_ENTRY;
    const result = validateLogEntry(withoutAttributes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.attributes).toEqual({});
  });

  it.each([
    ["not an object", "a string"],
    ["null", null],
    ["an array", ["not", "an", "entry"]],
  ])("rejects raw input that is %s", (_label, raw) => {
    const result = validateLogEntry(raw);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("entry must be an object");
  });

  describe("timestamp", () => {
    it("rejects a missing timestamp", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { timestamp: _omit, ...rest } = VALID_ENTRY;
      const result = validateLogEntry(rest);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("timestamp is required");
    });

    it("rejects a null timestamp", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, timestamp: null });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("timestamp is required");
    });

    it("rejects a non-string timestamp", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, timestamp: 12345 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("timestamp must be a string");
    });

    it("rejects an unparseable timestamp string", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        timestamp: "not-a-timestamp",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid timestamp: 'not-a-timestamp'");
    });

    it("rejects a timestamp more than five minutes in the future", () => {
      const sixMinutesOut = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      const result = validateLogEntry({
        ...VALID_ENTRY,
        timestamp: sixMinutesOut,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "timestamp must not be more than five minutes in the future",
      );
    });

    it("accepts a timestamp exactly at the five-minute boundary", () => {
      // The check is a strict `>`, so exactly five minutes out is still
      // valid -- this pins down the boundary behavior explicitly rather
      // than leaving it implicit.
      const fiveMinutesOut = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const result = validateLogEntry({
        ...VALID_ENTRY,
        timestamp: fiveMinutesOut,
      });

      expect(result.ok).toBe(true);
    });

    it("accepts a timestamp far in the past (no lower bound)", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        timestamp: "2000-01-01T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("level", () => {
    it("rejects a missing level", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { level: _omit, ...rest } = VALID_ENTRY;
      const result = validateLogEntry(rest);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("level is required");
    });

    it("rejects a null level", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, level: null });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("level is required");
    });

    it("rejects an unrecognized level", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, level: "critical" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid level: 'critical'");
    });

    it.each(["debug", "info", "warn", "error"])(
      "accepts level '%s'",
      (level) => {
        const result = validateLogEntry({ ...VALID_ENTRY, level });
        expect(result.ok).toBe(true);
      },
    );
  });

  describe("service", () => {
    it("rejects a missing service", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { service: _omit, ...rest } = VALID_ENTRY;
      const result = validateLogEntry(rest);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "service is required and must be a non-empty string",
      );
    });

    it("rejects an empty-string service", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, service: "" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "service is required and must be a non-empty string",
      );
    });

    it("rejects a whitespace-only service", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, service: "   " });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "service is required and must be a non-empty string",
      );
    });

    it("rejects a non-string service", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, service: 42 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "service is required and must be a non-empty string",
      );
    });
  });

  describe("message", () => {
    it("rejects a missing message", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { message: _omit, ...rest } = VALID_ENTRY;
      const result = validateLogEntry(rest);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "message is required and must be a non-empty string",
      );
    });

    it("rejects an empty-string message", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, message: "" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "message is required and must be a non-empty string",
      );
    });

    it("rejects a whitespace-only message", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, message: "   " });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "message is required and must be a non-empty string",
      );
    });
  });

  describe("attributes", () => {
    it("accepts a valid flat mix of string/number/boolean values", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        attributes: { a: "x", b: 1, c: true },
      });

      expect(result.ok).toBe(true);
    });

    it("accepts a null attributes field (treated as omitted)", () => {
      const result = validateLogEntry({ ...VALID_ENTRY, attributes: null });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.attributes).toEqual({});
    });

    it("rejects a nested object value", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        attributes: { nested: { a: 1 } },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "attributes must be a flat object with string, number, or boolean values",
      );
    });

    it("rejects an array value", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        attributes: { list: [1, 2, 3] },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "attributes must be a flat object with string, number, or boolean values",
      );
    });

    it("rejects attributes that is itself an array", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        attributes: ["not", "an", "object"],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "attributes must be a flat object with string, number, or boolean values",
      );
    });

    it("rejects a null value inside attributes", () => {
      const result = validateLogEntry({
        ...VALID_ENTRY,
        attributes: { a: null },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(
        "attributes must be a flat object with string, number, or boolean values",
      );
    });
  });
});

describe("validateBatch", () => {
  it("returns an empty result for an empty batch", () => {
    const result = validateBatch([]);

    expect(result).toEqual({ accepted: [], rejected: [] });
  });

  it("accepts all entries in an all-valid batch", () => {
    const result = validateBatch([VALID_ENTRY, VALID_ENTRY]);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("keeps original array indices for rejected entries in a mixed batch", () => {
    const result = validateBatch([
      VALID_ENTRY,
      { ...VALID_ENTRY, level: "critical" },
      VALID_ENTRY,
      { ...VALID_ENTRY, service: "" },
    ]);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([
      { index: 1, reason: "invalid level: 'critical'" },
      {
        index: 3,
        reason: "service is required and must be a non-empty string",
      },
    ]);
  });

  it("does not let one invalid entry affect validation of the others", () => {
    const result = validateBatch([{ totally: "malformed" }, VALID_ENTRY]);

    expect(result.rejected).toEqual([
      { index: 0, reason: "timestamp is required" },
    ]);
    expect(result.accepted).toHaveLength(1);
  });
});
