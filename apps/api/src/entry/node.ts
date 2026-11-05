import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../app";
import { loadConfig } from "../platform/config";
import { FsBlobStore } from "../platform/node/fs-blob-store";
import { createLibsqlDatabase } from "../platform/node/libsql-database";
import { migrateLibsqlDatabase, SOURCE_MIGRATIONS_DIR } from "../platform/node/migrate";
import { SOURCE_WEB_DIR, serveWeb } from "../platform/node/web";
import type { Platform } from "../platform/types";

const config = loadConfig(process.env);
const dataDir = resolve(process.env.DATA_DIR ?? "/data");
const port = Number(process.env.PORT ?? 3000);

mkdirSync(join(dataDir, "blobs"), { recursive: true });

const db = createLibsqlDatabase(`file:${join(dataDir, "db.sqlite")}`);
await migrateLibsqlDatabase(db, resolve(process.env.MIGRATIONS_DIR ?? SOURCE_MIGRATIONS_DIR));

const platform: Platform = {
  db,
  blobs: new FsBlobStore(join(dataDir, "blobs")),
  fetch: (input, init) => fetch(input, init),
  config,
};

const app = createApp(() => platform);
const webDir = resolve(process.env.WEB_DIR ?? SOURCE_WEB_DIR);
if (!serveWeb(app, webDir)) {
  console.warn(`No web build at ${webDir}: serving the API only (run \`pnpm build:web\`).`);
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port} (data: ${dataDir})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
