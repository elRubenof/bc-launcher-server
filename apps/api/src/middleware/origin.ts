import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for the admin API (on top of the `SameSite=Strict` cookie): mutating requests
 * must come from this deployment's origin.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header("Origin");
  const allowed = [new URL(c.var.platform.config.publicUrl).origin, new URL(c.req.url).origin];
  if (!origin || !allowed.includes(origin)) {
    return problem(c, 403, "bad_origin", "Cross-origin request rejected");
  }
  return next();
});
