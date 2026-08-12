import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSql, mockPostgres } = vi.hoisted(() => {
  const mockSql = Object.assign(vi.fn(), {
    unsafe: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  });
  const mockPostgres = vi.fn(() => mockSql);
  return { mockSql, mockPostgres };
});

vi.mock("postgres", () => ({
  default: mockPostgres,
}));

import { runRetentionSweep } from "./retention.js";

describe("runRetentionSweep", () => {
  beforeEach(() => {
    mockPostgres.mockClear();
    mockSql.unsafe.mockClear();
    mockSql.end.mockClear();
    mockSql.unsafe.mockResolvedValue(undefined);
  });

  describe("connection lifecycle", () => {
    it("opens a dedicated single connection, separate from the app pools", async () => {
      await runRetentionSweep();

      expect(mockPostgres).toHaveBeenCalledTimes(1);
      expect(mockPostgres).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ max: 1 }),
      );
    });

    it("closes the connection after a successful sweep", async () => {
      await runRetentionSweep();

      expect(mockSql.end).toHaveBeenCalledTimes(1);
    });

    it("closes the connection even when the sweep query fails, and still surfaces the error", async () => {
      mockSql.unsafe.mockRejectedValueOnce(new Error("boom"));

      await expect(runRetentionSweep()).rejects.toThrow("boom");

      expect(mockSql.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("generated SQL (regression coverage)", () => {
    it("inlines the configured retention window as a plain integer, not a bind parameter", async () => {
      // Regression guard: DO $$ ... $$ blocks are anonymous PL/pgSQL
      // blocks, not prepared statements -- Postgres does not support
      // external bind parameters ($1/$2) inside them at all. This was
      // caught by testing against a live Postgres instance (it fails
      // with "could not determine data type of parameter $1"), not by
      // inspection. The fix inlines the two integer config values
      // directly into the generated SQL text instead.
      await runRetentionSweep();

      const sqlText = mockSql.unsafe.mock.calls[0][0] as string;
      // Default RETENTION_DAYS is 30 (see config.ts fallback).
      expect(sqlText).toContain("CURRENT_DATE - 30");
      expect(sqlText).not.toMatch(/\$1|\$2/);
    });

    it("rolls the partition window forward by the future-partition buffer", async () => {
      await runRetentionSweep();

      const sqlText = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sqlText).toContain("FOR day_offset IN 0..3 LOOP");
    });

    it("only ever targets dated partitions, never logs_default", async () => {
      await runRetentionSweep();

      const sqlText = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sqlText).toContain("^logs_[0-9]{4}_[0-9]{2}_[0-9]{2}$");
      expect(sqlText).not.toContain("logs_default");
    });

    it("uses format() with %I/%L for both create and drop, never string-concatenates identifiers", async () => {
      await runRetentionSweep();

      const sqlText = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sqlText).toContain("format(");
      expect(sqlText).toContain("%I");
      expect(sqlText).toContain("%L");
    });

    it("does both the roll-forward and the drop within a single DO block (one round trip)", async () => {
      await runRetentionSweep();

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
      const sqlText = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sqlText.trim().startsWith("DO $$")).toBe(true);
    });
  });
});