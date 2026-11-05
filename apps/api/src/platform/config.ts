import type { Database } from "@bc-launcher-server/db";
import { getOrCreateSecret } from "./secrets";
import type { Config } from "./types";

type Env = Record<string, string | undefined>;

/** Config read from env vars / secrets; `jwtSecret` is unset when it comes from the database. */
export interface EnvConfig {
  publicUrl: string;
  jwtSecret: string | undefined;
}

/** A JWT_SECRET set by hand must be at least this long, so placeholders like `change-me` fail. */
const MIN_SECRET_LENGTH = 32;

/**
 * Reads the config shared by both runtimes from env vars / secrets. Throws listing what's missing.
 * `defaultUrl` is used when `PUBLIC_URL` isn't set (the Worker passes the request's origin).
 * `JWT_SECRET` is optional: without it, `resolveConfig` uses the one stored in the database.
 */
export function loadConfig(env: Env, defaultUrl?: string): EnvConfig {
  const rawUrl = env.PUBLIC_URL || defaultUrl;
  if (!rawUrl) {
    throw new Error("Missing required environment variables: PUBLIC_URL");
  }
  const jwtSecret = env.JWT_SECRET || undefined;
  if (jwtSecret !== undefined && jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -hex 32\`), or unset to let the server generate one`,
    );
  }

  const publicUrl = new URL(rawUrl);
  return {
    publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ""),
    jwtSecret,
  };
}

/**
 * The full config: `JWT_SECRET` from the environment when set, otherwise the one the server
 * generated and stored in `server_secrets` on first use.
 */
export async function resolveConfig(config: EnvConfig, db: Database): Promise<Config> {
  return {
    publicUrl: config.publicUrl,
    jwtSecret: config.jwtSecret ?? (await getOrCreateSecret(db, "jwt")),
  };
}
