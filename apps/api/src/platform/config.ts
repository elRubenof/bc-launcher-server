import type { Config } from "./types";

type Env = Record<string, string | undefined>;

/** JWT_SECRET signs auth challenges, player tokens and blob URLs: placeholders and short ones are refused. */
const MIN_SECRET_LENGTH = 32;

/**
 * Reads the config shared by both runtimes from env vars / secrets. Throws listing what's missing.
 * `defaultUrl` is used when `PUBLIC_URL` isn't set (the Worker passes the request's origin).
 */
export function loadConfig(env: Env, defaultUrl?: string): Config {
  const values: Env = { ...env, PUBLIC_URL: env.PUBLIC_URL || defaultUrl };
  const missing = ["PUBLIC_URL", "JWT_SECRET"].filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if ((values.JWT_SECRET as string).length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -hex 32\`)`,
    );
  }

  const publicUrl = new URL(values.PUBLIC_URL as string);
  return {
    publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ""),
    jwtSecret: values.JWT_SECRET as string,
  };
}
