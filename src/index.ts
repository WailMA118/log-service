import { createApp } from "./app.js";
import { waitForDatabase, closeDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { setDbConnected, setMigrationsApplied } from "./state/readiness.js";
import { config } from "./config.js";

const PORT = Number(config.api.port);

async function bootstrap(): Promise<void> {
  await waitForDatabase();
  setDbConnected(true);
  console.log("[bootstrap] database connection established");

  await runMigrations();
  setMigrationsApplied(true);
  console.log("[bootstrap] migrations applied");

  const app = createApp();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[bootstrap] listening on port ${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[bootstrap] received ${signal}, shutting down`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("[bootstrap] fatal error, exiting", err);
  process.exit(1);
});
