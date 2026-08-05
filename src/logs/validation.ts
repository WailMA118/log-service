import { isLogLevel } from "./types.js";
import type { RawLogEntry, ValidatedLogEntry } from "./types.js";

export type RejectedEntry = {
  index: number;
  reason: string;
};

export type ValidationResult = {
  accepted: ValidatedLogEntry[];
  rejected: RejectedEntry[];
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Attribute values must be flat scalars (string | number | boolean).
 * Nested objects and arrays are rejected per the API contract.
 */
function isValidAttributes(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const v of Object.values(value)) {
    const t = typeof v;
    if (t !== "string" && t !== "number" && t !== "boolean") {
      return false;
    }
  }
  return true;
}

/**
 * Validates a single raw log entry against the API contract. Returns
 * either a validated entry ready for insertion, or a human-readable
 * rejection reason -- never both, and never throws (validation failure
 * is an expected outcome for a single entry in a batch, not an error).
 */
export function validateLogEntry(
  raw: unknown,
): { ok: true; entry: ValidatedLogEntry } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "entry must be an object" };
  }

  const entry = raw as RawLogEntry;

  // --- timestamp ---
  if (entry.timestamp === undefined || entry.timestamp === null) {
    return { ok: false, reason: "timestamp is required" };
  }
  if (typeof entry.timestamp !== "string") {
    return { ok: false, reason: "timestamp must be a string" };
  }
  const parsedTimestamp = new Date(entry.timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    return {
      ok: false,
      reason: `invalid timestamp: '${entry.timestamp}'`,
    };
  }
  if (parsedTimestamp.getTime() - Date.now() > FIVE_MINUTES_MS) {
    return {
      ok: false,
      reason: "timestamp must not be more than five minutes in the future",
    };
  }

  // --- level ---
  if (entry.level === undefined || entry.level === null) {
    return { ok: false, reason: "level is required" };
  }
  if (!isLogLevel(entry.level)) {
    return { ok: false, reason: `invalid level: '${String(entry.level)}'` };
  }

  // --- service ---
  if (typeof entry.service !== "string" || entry.service.trim().length === 0) {
    return {
      ok: false,
      reason: "service is required and must be a non-empty string",
    };
  }

  // --- message ---
  if (typeof entry.message !== "string" || entry.message.trim().length === 0) {
    return {
      ok: false,
      reason: "message is required and must be a non-empty string",
    };
  }

  // --- attributes (optional) ---
  let attributes: Record<string, string | number | boolean> = {};
  if (entry.attributes !== undefined && entry.attributes !== null) {
    if (!isValidAttributes(entry.attributes)) {
      return {
        ok: false,
        reason:
          "attributes must be a flat object with string, number, or boolean values",
      };
    }
    attributes = entry.attributes as Record<string, string | number | boolean>;
  }

  return {
    ok: true,
    entry: {
      timestamp: parsedTimestamp,
      level: entry.level,
      service: entry.service,
      message: entry.message,
      attributes,
    },
  };
}

/**
 * Validates an entire batch. Invalid entries never fail the batch --
 * they're collected with their original array index and a reason, per
 * the API contract's per-entry rejection model.
 */
export function validateBatch(rawEntries: unknown[]): ValidationResult {
  const accepted: ValidatedLogEntry[] = [];
  const rejected: RejectedEntry[] = [];

  rawEntries.forEach((raw, index) => {
    const result = validateLogEntry(raw);
    if (result.ok) {
      accepted.push(result.entry);
    } else {
      rejected.push({ index, reason: result.reason });
    }
  });

  return { accepted, rejected };
}
