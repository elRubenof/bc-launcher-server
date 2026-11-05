import type { Config } from "./types";

type Env = Record<string, string | undefined>;

/**
 * Reads the config shared by both runtimes from env vars / secrets. Throws listing what's missing.
 * `defaultUrl` is used when `PUBLIC_URL` isn't set (the Worker passes the request's origin).
 */
export function loadConfig(env: Env, defaultUrl?: string): Config {
  const values: Env = { ...env, PUBLIC_URL: env.PUBLIC_URL || defaultUrl };
  const missing = ["PUBLIC_URL", "SESSION_SECRET", "JWT_SECRET"].filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const publicUrl = new URL(values.PUBLIC_URL as string);
  return {
    publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ""),
    sessionSecret: values.SESSION_SECRET as string,
    jwtSecret: values.JWT_SECRET as string,
  };
}
