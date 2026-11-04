import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../app";
import { loadConfig } from "../platform/config";
import { FsBlobStore } from "../platform/node/fs-blob-store";
import { createLibsqlDatabase } from "../platform/node/libsql-database";
import { migrateLibsqlDatabase, SOURCE_MIGRATIONS_DIR } from "../platform/node/migrate";
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
  config,
};

const server = serve({ fetch: createApp(() => platform).fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port} (data: ${dataDir})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
