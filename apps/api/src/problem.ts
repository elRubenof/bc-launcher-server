import type { Problem } from "@bc-launcher-server/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Responds with an `application/problem+json` body, typed as JSON for the route contracts. */
export function problem<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: string,
  title: string,
  detail?: string,
) {
  const body: Problem = { type: "about:blank", title, status, code };
  if (detail) body.detail = detail;
  return c.json(body, status, { "Content-Type": "application/problem+json" });
}
