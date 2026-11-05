import type { Admin, Player } from "@bc-launcher-server/contracts";
import type { Database } from "@bc-launcher-server/db";

/** Content-addressed blob storage: R2 on Workers, the filesystem on Node. */
export interface BlobStore {
  /** Returns the blob's size, or `null` if it doesn't exist. */
  head(sha256: string): Promise<{ size: number } | null>;
  get(sha256: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  /**
   * Stores a blob. `size` must be the exact byte length of `body` (R2 needs it for streams), and the
   * bytes must hash to `sha256`: otherwise it throws `BlobMismatchError` and stores nothing, so a
   * key always holds the bytes it names.
   */
  put(sha256: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>;
  delete(sha256: string): Promise<void>;
}

export interface Config {
  publicUrl: string;
  sessionSecret: string;
  jwtSecret: string;
}

/** Everything that differs between Cloudflare and Docker. */
export interface Platform {
  db: Database;
  blobs: BlobStore;
  config: Config;
  /** Outgoing HTTP (Mojang and loader metadata). Injected so tests can stub it. */
  fetch: typeof fetch;
}

/**
 * Builds the platform from the runtime's bindings (`c.env` on Workers, unused on Node) and the
 * request URL (the Worker's public URL when `PUBLIC_URL` isn't set).
 */
export type PlatformResolver = (env: unknown, requestUrl: string) => Platform;

export type AppEnv = {
  Variables: {
    platform: Platform;
    /** The signed-in admin. Only set on `/api/admin/*` routes behind `requireAdmin`. */
    admin: Admin;
    /** The signed-in player. Only set on launcher routes behind `requirePlayer`. */
    player: Player;
  };
};
