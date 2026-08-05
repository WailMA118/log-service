export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: readonly LogLevel[] = [
  "debug",
  "info",
  "warn",
  "error",
];

export function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    (LOG_LEVELS as readonly string[]).includes(value)
  );
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

/** Attribute values allowed by the API contract: flat, scalar only. */
export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

/** A log entry as accepted by the ingestion endpoint, pre-validation. */
export type RawLogEntry = {
  timestamp?: unknown;
  level?: unknown;
  service?: unknown;
  message?: unknown;
  attributes?: unknown;
};

/** A log entry after passing validation, ready to insert. */
export type ValidatedLogEntry = {
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Attributes;
};

/** A log entry as returned by query endpoints. */
export type LogRecord = {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Attributes;
};
