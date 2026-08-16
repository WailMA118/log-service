import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";

describe("encodeCursor / decodeCursor round trip", () => {
  it("decodes exactly what was encoded", () => {
    const original = { timestamp: "2026-07-20T14:32:01.123Z", id: "42" };

    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual(original);
  });

  it("produces an opaque, URL-safe string (no +, /, or = padding)", () => {
    const encoded = encodeCursor({
      timestamp: new Date().toISOString(),
      id: "1",
    });

    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("round-trips id: '0' correctly (falsy-looking string, but valid)", () => {
    const original = { timestamp: "2026-07-20T14:32:01.123Z", id: "0" };

    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded).toEqual(original);
  });

  it("round-trips an id beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    // The whole reason id is a string: Postgres bigint goes up to
    // ~9.2e18, far past Number.MAX_SAFE_INTEGER (~9.007e15). Round-
    // tripping through a JS number would silently corrupt this.
    const original = {
      timestamp: "2026-07-20T14:32:01.123Z",
      id: "9007199254740993", // MAX_SAFE_INTEGER + 2
    };

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
      JSON.stringify({ timestamp: 12345, id: "1" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a non-string id (JSON number instead of the expected string)", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z", id: 1 }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects an unparseable timestamp string", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "not-a-date", id: "1" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a non-integer id string (e.g. '1.5')", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z", id: "1.5" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a negative id string", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z", id: "-1" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects an empty id string", () => {
    const encoded = Buffer.from(
      JSON.stringify({ timestamp: "2026-07-20T14:32:01.123Z", id: "" }),
    ).toString("base64url");
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects an id given as a JSON number that overflowed to Infinity", () => {
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
