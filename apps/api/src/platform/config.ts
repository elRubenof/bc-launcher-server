import type { Config } from "./types";

type Env = Record<string, string | undefined>;

/** Reads the config shared by both runtimes from env vars / secrets. Throws listing what's missing. */
export function loadConfig(env: Env): Config {
  const missing = ["PUBLIC_URL", "SESSION_SECRET", "JWT_SECRET"].filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const publicUrl = new URL(env.PUBLIC_URL as string);
  return {
    publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ""),
    sessionSecret: env.SESSION_SECRET as string,
    jwtSecret: env.JWT_SECRET as string,
  };
}
