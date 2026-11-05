import { schema } from "@bc-launcher-server/db";
import { createApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import { MemoryBlobStore } from "../src/platform/memory";
import { createLibsqlDatabase } from "../src/platform/node/libsql-database";
import { migrateLibsqlDatabase, SOURCE_MIGRATIONS_DIR } from "../src/platform/node/migrate";
import type { Platform } from "../src/platform/types";

/** Upstream metadata the tests know about (Mojang, Fabric, Quilt, Forge, NeoForge). */
export const UPSTREAM: Record<string, unknown> = {
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json": {
    versions: [
      { id: "24w14a", type: "snapshot", releaseTime: "2024-04-03T12:00:00+00:00" },
      { id: "1.21.1", type: "release", releaseTime: "2024-08-08T12:00:00+00:00" },
      { id: "1.20.1", type: "release", releaseTime: "2023-06-12T12:00:00+00:00" },
    ],
  },
  "https://meta.fabricmc.net/v2/versions/loader/1.21.1": [
    { loader: { version: "0.16.10-beta.1", stable: false } },
    { loader: { version: "0.16.9", stable: true } },
    { loader: { version: "0.16.8", stable: true } },
  ],
  "https://meta.quiltmc.org/v3/versions/loader/1.21.1": [
    { loader: { version: "0.27.0-beta.1" } },
    { loader: { version: "0.26.4" } },
  ],
  "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml":
    "<metadata><versioning><versions><version>1.20.1-47.2.0</version><version>1.20.1-47.3.0</version><version>1.21.1-52.0.1</version></versions></versioning></metadata>",
  "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json": {
    promos: { "1.20.1-recommended": "47.2.0" },
  },
  "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml":
    "<metadata><versioning><versions><version>21.1.76</version><version>21.1.77</version><version>21.2.0-beta</version></versions></versioning></metadata>",
};

/** A `fetch` that answers from `responses` (JSON, or text for strings) and 404s anything else. */
export function stubFetch(responses: Record<string, unknown> = UPSTREAM): typeof fetch {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!(url in responses)) return new Response("Not found", { status: 404 });
    const body = responses[url];
    if (body instanceof Response) return body;
    return typeof body === "string" ? new Response(body) : Response.json(body);
  };
}

/** A platform with a migrated in-memory database, in-memory blobs and stubbed upstream HTTP. */
export async function createTestPlatform(fetchFn = stubFetch()): Promise<Platform> {
  const db = createLibsqlDatabase(":memory:");
  await migrateLibsqlDatabase(db, SOURCE_MIGRATIONS_DIR);
  return {
    db,
    blobs: new MemoryBlobStore(),
    fetch: fetchFn,
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
