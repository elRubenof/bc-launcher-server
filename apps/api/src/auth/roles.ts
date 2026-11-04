import type { Context } from "hono";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

/** Returns a `403 forbidden` response unless the signed-in admin is an owner. */
export function ownerOnly(c: Context<AppEnv>) {
  return c.var.admin.role === "owner"
    ? null
    : problem(c, 403, "forbidden", "Only owners can do this");
}
