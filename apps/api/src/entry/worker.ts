import { type Database, schema } from "@bc-launcher-server/db";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../app";
import { runCleanup } from "../cleanup";
import { loadConfig } from "../platform/config";
import type { Platform } from "../platform/types";
import { R2BlobStore } from "../platform/worker/r2-blob-store";

interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  PUBLIC_URL?: string;
  SESSION_SECRET?: string;
  JWT_SECRET?: string;
}

// Bindings are stable per isolate, so the platform is built once per env object.
const platforms = new WeakMap<Env, Platform>();

function resolvePlatform(env: Env): Platform {
  let platform = platforms.get(env);
  if (!platform) {
    const db: Database = drizzle(env.DB, { schema });
    platform = {
      db,
      blobs: new R2BlobStore(env.BLOBS),
      fetch: (input, init) => fetch(input, init),
      config: loadConfig({
        PUBLIC_URL: env.PUBLIC_URL,
        SESSION_SECRET: env.SESSION_SECRET,
        JWT_SECRET: env.JWT_SECRET,
      }),
    };
    platforms.set(env, platform);
  }
  return platform;
}

const app = createApp((env) => resolvePlatform(env as Env));

export default {
  fetch: app.fetch,
  // Cron trigger (wrangler.jsonc): hourly cleanup of orphan blobs and expired bans.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runCleanup(resolvePlatform(env)).then(({ deleted }) => {
        if (deleted > 0) console.log(`Deleted ${deleted} orphan blobs`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
