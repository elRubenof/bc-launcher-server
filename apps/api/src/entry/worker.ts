import { type Database, schema } from "@bc-launcher-server/db";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../app";
import { runCleanup } from "../cleanup";
import { loadConfig, resolveConfig } from "../platform/config";
import type { Platform } from "../platform/types";
import { R2BlobStore } from "../platform/worker/r2-blob-store";

interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  /** Optional: without it, the public URL is the origin each request came in on. */
  PUBLIC_URL?: string;
  /** Optional: without it, the server generates one and keeps it in D1 (`server_secrets`). */
  JWT_SECRET?: string;
}

type Storage = Pick<Platform, "db" | "blobs" | "fetch">;

// Bindings are stable per isolate, so storage is built once per env object and the platform once
// per env and origin (a Worker can answer on workers.dev and on a custom domain at the same time).
const storages = new WeakMap<Env, Storage>();
const platforms = new WeakMap<Env, Map<string, Promise<Platform>>>();

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

function resolvePlatform(env: Env, requestUrl: string): Promise<Platform> {
  const origin = env.PUBLIC_URL ? "" : new URL(requestUrl).origin;
  let byOrigin = platforms.get(env);
  if (!byOrigin) {
    byOrigin = new Map();
    platforms.set(env, byOrigin);
  }
  let platform = byOrigin.get(origin);
  if (!platform) {
    const storage = resolveStorage(env);
    // Async because JWT_SECRET may come from the database. Not cached if it fails, so the next
    // request retries.
    platform = Promise.resolve()
      .then(() =>
        resolveConfig(
          loadConfig({ PUBLIC_URL: env.PUBLIC_URL, JWT_SECRET: env.JWT_SECRET }, origin),
          storage.db,
        ),
      )
      .then((config) => ({ ...storage, config }));
    platform.catch(() => byOrigin.delete(origin));
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
