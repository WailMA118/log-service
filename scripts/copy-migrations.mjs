// tsc only compiles .ts -> .js; it does not copy non-TypeScript files
// like our hand-written .sql migrations or drizzle-kit's journal.json
// into dist/. At runtime, src/db/migrate.ts resolves its migrations
// folder relative to its own compiled location (dist/db/migrate.js), so
// without this step dist/db/migrations/ never exists and the app
// silently skips all migrations on startup (it treats "directory not
// found" as "no migrations to run", not as an error).
//
// Uses fs.cp (Node 16.7+) instead of a shell `cp` command so this works
// identically on any OS running `npm run build`, not just Unix shells.
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const src = path.join(projectRoot, "src", "db", "migrations");
const dest = path.join(projectRoot, "dist", "db", "migrations");

await cp(src, dest, { recursive: true });
console.log(`[build] copied migrations: ${src} -> ${dest}`);
