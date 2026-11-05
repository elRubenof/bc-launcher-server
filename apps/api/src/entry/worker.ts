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
  /** Optional: without it, the public URL is the origin each request came in on. */
  PUBLIC_URL?: string;
  JWT_SECRET?: string;
}

type Storage = Pick<Platform, "db" | "blobs" | "fetch">;

// Bindings are stable per isolate, so storage is built once per env object and the platform once
// per env and origin (a Worker can answer on workers.dev and on a custom domain at the same time).
const storages = new WeakMap<Env, Storage>();
const platforms = new WeakMap<Env, Map<string, Platform>>();

function resolveStorage(env: Env): Storage {
  let storage = storages.get(env);
  if (!storage) {
    const db: Database = drizzle(env.DB, { schema });
    storage = {
      db,
      blobs: new R2BlobStore(env.BLOBS),
      fetch: (input, init) => fetch(input, init),
    };
    storages.set(env, storage);
  }
  return storage;
}

function resolvePlatform(env: Env, requestUrl: string): Platform {
  const origin = env.PUBLIC_URL ? "" : new URL(requestUrl).origin;
  let byOrigin = platforms.get(env);
  if (!byOrigin) {
    byOrigin = new Map();
    platforms.set(env, byOrigin);
  }
  let platform = byOrigin.get(origin);
  if (!platform) {
    platform = {
      ...resolveStorage(env),
      config: loadConfig(
        {
          PUBLIC_URL: env.PUBLIC_URL,
          JWT_SECRET: env.JWT_SECRET,
        },
        origin,
      ),
    };
    byOrigin.set(origin, platform);
  }
  return platform;
}

const app = createApp((env, requestUrl) => resolvePlatform(env as Env, requestUrl));

export default {
  fetch: app.fetch,
  // Cron trigger (wrangler.jsonc): hourly cleanup of orphan blobs and expired bans.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runCleanup(resolveStorage(env)).then(({ deleted }) => {
        if (deleted > 0) console.log(`Deleted ${deleted} orphan blobs`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
