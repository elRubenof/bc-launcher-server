import type { Database } from "@bc-launcher-server/db";
import { getOrCreateSecret } from "./secrets";
import type { Config, PlayerAuth } from "./types";

type Env = Record<string, string | undefined>;

/** Config read from env vars / secrets; `jwtSecret` is unset when it comes from the database. */
export interface EnvConfig extends Omit<Config, "jwtSecret"> {
  jwtSecret: string | undefined;
}

export interface ConfigOptions {
  /** Used when `PUBLIC_URL` isn't set (the Worker passes the request's origin). */
  defaultUrl?: string | undefined;
  /**
   * Without `MOJANG_SESSION_URL`, trust the name players send instead of asking Mojang. The Worker
   * sets it because Mojang refuses requests from Cloudflare Workers; Node always verifies.
   */
  unverifiedWithoutSessionUrl?: boolean;
}

export const MOJANG_SESSION_URL = "https://sessionserver.mojang.com/session/minecraft";

/** A JWT_SECRET set by hand must be at least this long, so placeholders like `change-me` fail. */
const MIN_SECRET_LENGTH = 32;

/** Normalizes a URL setting: origin and path, without the trailing slash. */
function normalizeUrl(value: string): string {
  const url = new URL(value);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/**
 * Reads the config shared by both runtimes from env vars / secrets. Throws listing what's missing.
 * `JWT_SECRET` is optional: without it, `resolveConfig` uses the one stored in the database.
 * `MOJANG_SESSION_URL` points `hasJoined` at a proxy of Mojang's session server.
 */
export function loadConfig(env: Env, options: ConfigOptions = {}): EnvConfig {
  const rawUrl = env.PUBLIC_URL || options.defaultUrl;
  if (!rawUrl) {
    throw new Error("Missing required environment variables: PUBLIC_URL");
  }
  const jwtSecret = env.JWT_SECRET || undefined;
  if (jwtSecret !== undefined && jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -hex 32\`), or unset to let the server generate one`,
    );
  }
  const sessionUrl = env.MOJANG_SESSION_URL || undefined;
  const playerAuth: PlayerAuth =
    !sessionUrl && options.unverifiedWithoutSessionUrl ? "unverified" : "mojang-session";

  return {
    publicUrl: normalizeUrl(rawUrl),
    jwtSecret,
    playerAuth,
    mojangSessionUrl: normalizeUrl(sessionUrl ?? MOJANG_SESSION_URL),
  };
}

/**
 * The full config: `JWT_SECRET` from the environment when set, otherwise the one the server
 * generated and stored in `server_secrets` on first use.
 */
export async function resolveConfig(config: EnvConfig, db: Database): Promise<Config> {
  return { ...config, jwtSecret: config.jwtSecret ?? (await getOrCreateSecret(db, "jwt")) };
}
