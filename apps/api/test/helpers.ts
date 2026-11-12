import { schema } from "@bc-launcher-server/db";
import { createApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import { MemoryBlobStore } from "../src/platform/memory";
import { createLibsqlDatabase } from "../src/platform/node/libsql-database";
import { migrateLibsqlDatabase, SOURCE_MIGRATIONS_DIR } from "../src/platform/node/migrate";
import type { Platform } from "../src/platform/types";
import { markSeen } from "../src/players";

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
    { loader: { version: "0.16.8", stable: false } },
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

/** Minecraft profiles the stubbed Mojang knows: name → uuid (lowercase with dashes). */
export const PROFILES: Record<string, string> = {
  Nyxar: "8a1f2b3c-4d5e-4f60-8a1b-2c3d4e5fc3d2",
  Tomate_89: "4f3a9c1e-7b2d-4e8a-9c0f-1d2e3f4a5b6c",
  GrieferX: "77ab0c1d-2e3f-4a5b-8c6d-7e8f9a0be012",
};

/**
 * Upstream stub that also plays Mojang and playerdb.co: `hasJoined` confirms every known profile
 * (whatever the `serverId`), and the profile lookups by name and uuid answer from `PROFILES`.
 */
export function mojangFetch(
  profiles: Record<string, string> = PROFILES,
  upstream: typeof fetch = stubFetch(),
): typeof fetch {
  const byName = (name: string | null) =>
    Object.entries(profiles).find(([known]) => known.toLowerCase() === name?.toLowerCase());
  const profile = ([name, uuid]: [string, string]) =>
    Response.json({ id: uuid.replaceAll("-", ""), name });
  return async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.host === "sessionserver.mojang.com") {
      if (url.pathname.endsWith("/hasJoined")) {
        const found = byName(url.searchParams.get("username"));
        return found ? profile(found) : new Response(null, { status: 204 });
      }
      const id = url.pathname.split("/").at(-1);
      const found = Object.entries(profiles).find(([, uuid]) => uuid.replaceAll("-", "") === id);
      return found ? profile(found) : new Response(null, { status: 204 });
    }
    if (url.host === "playerdb.co") {
      const ref = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const found =
        byName(ref) ??
        Object.entries(profiles).find(([, uuid]) => uuid.replaceAll("-", "") === ref);
      return found
        ? Response.json({
            code: "player.found",
            success: true,
            data: { player: { username: found[0], id: found[1], raw_id: ref } },
          })
        : Response.json(
            { code: "minecraft.invalid_username", success: false, data: {} },
            { status: 400 },
          );
    }
    if (url.host === "api.mojang.com") {
      const found = byName(decodeURIComponent(url.pathname.split("/").at(-1) ?? ""));
      return found ? profile(found) : new Response(null, { status: 404 });
    }
    return upstream(input, init);
  };
}

/** A platform with a migrated in-memory database, in-memory blobs and stubbed upstream HTTP. */
export async function createTestPlatform(fetchFn = mojangFetch()): Promise<Platform> {
  const db = createLibsqlDatabase(":memory:");
  await migrateLibsqlDatabase(db, SOURCE_MIGRATIONS_DIR);
  return {
    db,
    blobs: new MemoryBlobStore(),
    fetch: fetchFn,
    config: {
      publicUrl: "http://localhost:8787",
      jwtSecret: "test-jwt-secret",
      playerAuth: "mojang-session",
      mojangSessionUrl: "https://sessionserver.mojang.com/session/minecraft",
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

/** Signs a player in through `challenge` + `verify`; returns the response of `verify`. */
export async function verifyPlayer(app: TestApp, username: string) {
  const challenge = (await (
    await app.request("/api/v1/auth/challenge", { method: "POST" })
  ).json()) as {
    serverId: string;
  };
  return jsonRequest(app, "POST", "/api/v1/auth/verify", {
    username,
    serverId: challenge.serverId,
  });
}

/** Signs a player in and returns the `Authorization` header for launcher requests. */
export async function playerAuth(app: TestApp, username: string) {
  const res = await verifyPlayer(app, username);
  if (res.status !== 200) throw new Error(`Player sign-in failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return { Authorization: `Bearer ${token}` };
}

/** Signs a player in and records an access, as entering an instance does (`presence`). */
export async function joinPlayer(app: TestApp, platform: Platform, username: string) {
  const auth = await playerAuth(app, username);
  await markSeen(platform.db, PROFILES[username] as string, new Date());
  return auth;
}
