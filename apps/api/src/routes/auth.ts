import { loginRoute, logoutRoute, meRoute } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth/password";
import { endSession, startSession } from "../auth/sessions";
import type { AppEnv } from "../platform/types";
import { problem } from "../problem";

// Verified when the username doesn't exist, so both failures take the same time. Created lazily:
// Workers don't allow generating random values outside a request.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => {
  dummyHash ??= hashPassword("dummy password");
  return dummyHash;
};

export function registerAuth(app: OpenAPIHono<AppEnv>) {
  app.openapi(loginRoute, async (c) => {
    const { username, password } = c.req.valid("json");
    const [admin] = await c.var.platform.db
      .select()
      .from(schema.admins)
      .where(eq(schema.admins.username, username));

    const valid = await verifyPassword(password, admin?.passwordHash ?? (await getDummyHash()));
    if (!admin || !valid) {
      return problem(c, 401, "invalid_credentials", "Wrong username or password");
    }

    await startSession(c, admin.id);
    return c.json({ id: admin.id, username: admin.username, role: admin.role }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    await endSession(c);
    return c.body(null, 204);
  });

  app.openapi(meRoute, (c) => c.json(c.var.admin, 200));
}
