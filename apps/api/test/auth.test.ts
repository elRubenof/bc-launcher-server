import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  OWNER,
  sessionCookie,
  setupOwner,
} from "./helpers";

async function signedOut() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  await setupOwner(app);
  return { app, platform };
}

const login = (
  app: Awaited<ReturnType<typeof createTestApp>>,
  username: string,
  password: string,
) => jsonRequest(app, "POST", "/api/admin/auth/login", { username, password });

const me = (app: Awaited<ReturnType<typeof createTestApp>>, cookie?: string) =>
  app.request("/api/admin/auth/me", cookie ? { headers: { Cookie: cookie } } : {});

describe("admin auth", () => {
  it("setup signs the owner in", async () => {
    const app = await createTestApp();
    const cookie = await setupOwner(app);

    const res = await me(app, cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "owner", role: "owner" });
  });

  it("logs in with a case-insensitive username and sets a strict HttpOnly cookie", async () => {
    const { app } = await signedOut();

    const res = await login(app, " OWNER ", OWNER.password);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "owner" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^bcls_session=[\w-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect((await me(app, sessionCookie(res))).status).toBe(200);
  });

  it("rejects a wrong password and an unknown user the same way", async () => {
    const { app } = await signedOut();

    for (const res of [await login(app, "owner", "wrong"), await login(app, "nobody", "x")]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "invalid_credentials" });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("requires a session on admin routes", async () => {
    const { app } = await signedOut();

    for (const cookie of [undefined, "bcls_session=not-a-session"]) {
      const res = await me(app, cookie);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    }
  });

  it("logout ends only the current session", async () => {
    const { app } = await signedOut();
    const first = sessionCookie(await login(app, "owner", OWNER.password));
    const second = sessionCookie(await login(app, "owner", OWNER.password));

    const res = await jsonRequest(app, "POST", "/api/admin/auth/logout", undefined, {
      Cookie: first,
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^bcls_session=;.*Max-Age=0/);
    expect((await me(app, first)).status).toBe(401);
    expect((await me(app, second)).status).toBe(200);
  });

  it("rejects expired sessions", async () => {
    const { app, platform } = await signedOut();
    const cookie = sessionCookie(await login(app, "owner", OWNER.password));

    await platform.db.update(schema.adminSessions).set({ expiresAt: new Date(Date.now() - 1) });

    expect((await me(app, cookie)).status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    const { app, platform } = await signedOut();
    const token = sessionCookie(await login(app, "owner", OWNER.password)).split("=")[1];

    const sessions = await platform.db.select().from(schema.adminSessions);

    expect(sessions.map((session) => session.id)).not.toContain(token);
    expect(sessions.every((session) => /^[0-9a-f]{64}$/.test(session.id))).toBe(true);
  });
});
