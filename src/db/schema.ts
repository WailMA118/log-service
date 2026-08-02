import { pgTable, pgEnum, bigint, timestamp, text, jsonb } from 'drizzle-orm/pg-core';

export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warn', 'error']);

export const logs = pgTable('logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  timestamp: timestamp('timestamp', { withTimezone: true, mode: 'date' }).notNull(),
  level: logLevelEnum('level').notNull(),
  service: text('service').notNull(),
  message: text('message').notNull(),
  attributes: jsonb('attributes')
    .$type<Record<string, string | number | boolean>>()
    .default({}),
});