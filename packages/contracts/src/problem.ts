import { z } from "@hono/zod-openapi";

/** RFC 9457 error body (`application/problem+json`). Clients branch on `code`, never on `title`. */
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    code: z.string(),
    detail: z.string().optional(),
  })
  .openapi("Problem");

export type Problem = z.infer<typeof Problem>;

export function problemResponse(description: string) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}
