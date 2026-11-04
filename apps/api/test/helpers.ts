import { schema } from "@bc-launcher-server/db";
import { createApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import { MemoryBlobStore } from "../src/platform/memory";
import { createLibsqlDatabase } from "../src/platform/node/libsql-database";
import { migrateLibsqlDatabase, SOURCE_MIGRATIONS_DIR } from "../src/platform/node/migrate";
import type { Platform } from "../src/platform/types";

/** A platform with a migrated in-memory database and in-memory blobs. */
export async function createTestPlatform(): Promise<Platform> {
  const db = createLibsqlDatabase(":memory:");
  await migrateLibsqlDatabase(db, SOURCE_MIGRATIONS_DIR);
  return {
    db,
    blobs: new MemoryBlobStore(),
    config: {
      publicUrl: "http://localhost:8787",
      sessionSecret: "test-session-secret",
      jwtSecret: "test-jwt-secret",
    },
  };
}

export async function createTestApp(platform?: Platform) {
  const resolved = platform ?? (await createTestPlatform());
  return createApp(() => resolved);
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** A same-origin JSON request, as the panel sends it. */
export function jsonRequest(
  app: TestApp,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method,
    headers: { Origin: "http://localhost", "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const OWNER = { organizationName: "Bocom", username: "owner", password: "owner-password" };

/** Reads the session cookie (`name=value`) from a response. */
export function sessionCookie(res: Response): string {
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session cookie in the response");
  return cookie;
}

/** Runs setup and returns the owner's session cookie. */
export async function setupOwner(app: TestApp) {
  const res = await jsonRequest(app, "POST", "/api/admin/setup", OWNER);
  if (res.status !== 201) throw new Error(`Setup failed: ${res.status}`);
  return sessionCookie(res);
}

/** Inserts an admin directly and returns its session cookie, for role tests. */
export async function signInAs(
  app: TestApp,
  platform: Platform,
  username: string,
  role: "admin" | "editor",
) {
  const password = `${username}-password`;
  await platform.db.insert(schema.admins).values({
    id: crypto.randomUUID(),
    username,
    passwordHash: await hashPassword(password),
    role,
  });
  const res = await jsonRequest(app, "POST", "/api/admin/auth/login", { username, password });
  return sessionCookie(res);
}
