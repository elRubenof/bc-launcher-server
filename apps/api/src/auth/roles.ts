import type { Context } from "hono";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

/**
 * The owner and admins manage the organization and the accounts; editors don't.
 * Returns a `403 forbidden` response for editors, `null` otherwise.
 */
export function managersOnly(c: Context<AppEnv>) {
  return c.var.admin.role === "editor"
    ? problem(c, 403, "forbidden", "Only the owner and admins can do this")
    : null;
}
