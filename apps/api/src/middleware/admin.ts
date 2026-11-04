import { createMiddleware } from "hono/factory";
import { readSession } from "../auth/sessions";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

/** Admin API routes that work without a session. */
const PUBLIC_PATHS = new Set(["/api/admin/setup", "/api/admin/auth/login"]);

/** Requires a signed-in admin on `/api/admin/*`, available as `c.var.admin`. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  const admin = await readSession(c);
  if (!admin) return problem(c, 401, "unauthenticated", "Not signed in");
  c.set("admin", admin);
  return next();
});
