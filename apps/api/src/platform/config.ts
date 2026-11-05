import type { Config } from "./types";

type Env = Record<string, string | undefined>;

/** Secrets sign sessions, player tokens and blob URLs, so placeholders and short ones are refused. */
const MIN_SECRET_LENGTH = 32;

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
  const weak = ["SESSION_SECRET", "JWT_SECRET"].filter(
    (key) => (values[key] as string).length < MIN_SECRET_LENGTH,
  );
  if (weak.length > 0) {
    throw new Error(
      `${weak.join(", ")} must be at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -hex 32\`)`,
    );
  }

  const publicUrl = new URL(values.PUBLIC_URL as string);
  return {
    publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ""),
    sessionSecret: values.SESSION_SECRET as string,
    jwtSecret: values.JWT_SECRET as string,
  };
}
