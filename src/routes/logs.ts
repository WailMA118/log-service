import { Router, type Request, type Response } from "express";
import { ingestClient } from "../db/client.js";
import { validateBatch } from "../logs/validation.js";
import type { ValidatedLogEntry } from "../logs/types.js";

export const ingestRouter = Router();

// ============================================================================
// POST /logs
// ============================================================================

/**
 * Bulk-inserts validated entries via a single multi-row INSERT using
 * postgres.js's helper(...) -- NOT one INSERT per row, and NOT through
 * Drizzle. At 15,000-25,000+ logs/sec, per-row round trips or ORM query
 * building overhead would dominate the request budget on a 0.5 CPU app
 * container. A single batched statement means one network round trip
 * and one planning pass for the whole batch.
 */
async function insertBatch(entries: ValidatedLogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const rows = entries.map((e) => ({
    timestamp: e.timestamp,
    level: e.level,
    service: e.service,
    message: e.message,
    attributes: JSON.stringify(e.attributes),
  }));

  await ingestClient`
    INSERT INTO logs (timestamp, level, service, message, attributes)
    VALUES ${ingestClient(rows, "timestamp", "level", "service", "message", "attributes")}
  `;
}

ingestRouter.post("/logs", async (req: Request, res: Response) => {
  const body: unknown = req.body;

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("logs" in body) ||
    !Array.isArray((body as { logs: unknown }).logs)
  ) {
    res.status(400).json({
      error: "request body must be an object with a 'logs' array",
    });
    return;
  }

  const rawEntries = (body as { logs: unknown[] }).logs;
  const { accepted, rejected } = validateBatch(rawEntries);

  if (accepted.length === 0) {
    res.status(400).json({ accepted: 0, rejected });
    return;
  }

  try {
    await insertBatch(accepted);
  } catch (err) {
    console.error("[ingest] insert failed:", err);
    res.status(500).json({ error: "internal error while storing logs" });
    return;
  }

  res.status(200).json({ accepted: accepted.length, rejected });
});
