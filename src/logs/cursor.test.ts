import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";

describe("encodeCursor / decodeCursor round trip", () => {
  it("decodes exactly what was encoded", () => {
    const original = { timestamp: "2026-07-20T14:32:01.123Z", id: 42 };

    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual(original);
  });

  it("produces an opaque, URL-safe string (no +, /, or = padding)", () => {
    const encoded = encodeCursor({
      timestamp: new Date().toISOString(),
      id: 1,
    });

    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("round-trips id: 0 correctly (falsy but valid)", () => {
    const original = { timestamp: "2026-07-20T14:32:01.123Z", id: 0 };

    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded).toEqual(original);
  });
});

describe("decodeCursor rejects malformed input", () => {
  it("rejects a string that isn't valid base64url", () => {
    // Buffer.from with base64url is lenient about alphabet, so this
    // needs to actually fail JSON.parse downstream rather than the
    // base64 decode itself -- using bytes that decode to invalid JSON.
    expect(decodeCursor("not-valid-json-when-decoded")).toBeNull();
  });

  it("rejects base64url of valid JSON that isn't an object", () => {
    const encoded = Buffer.from(JSON.stringify([1, 2, 3])).toString(
      "base64url",
    );
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects base64url of a JSON null", () => {
    const encoded = Buffer.from(JSON.stringify(null)).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects an object missing the timestamp field", () => {
    const encoded = Buffer.from(JSON.stringify({ id: 1 })).toString(
      "base64url",
    );
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects an object missing the id field", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a non-string timestamp", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: 12345, id: 1 }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a non-number id", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z", id: "1" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects an unparseable timestamp string", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "not-a-date", id: 1 }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a non-integer id", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z", id: 1.5 }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a non-finite id (Infinity, reachable via an overflowing JSON number literal)", () => {
    const encoded = Buffer.from(
      `{"timestamp":"2026-07-20T14:32:01.123Z","id":1e400}`,
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects completely garbage input without throwing", () => {
    expect(() => decodeCursor("!!!not-base64-or-json!!!")).not.toThrow();
    expect(decodeCursor("!!!not-base64-or-json!!!")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(decodeCursor("")).toBeNull();
  });
});
