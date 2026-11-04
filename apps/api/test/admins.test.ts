import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  sessionCookie,
  setupOwner,
  signInAs,
} from "./helpers";

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  return { app, platform, owner };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

const createAdmin = (app: App, cookie: string, body: object) =>
  jsonRequest(app, "POST", "/api/admin/admins", body, { Cookie: cookie });

const login = (app: App, username: string, password: string) =>
  jsonRequest(app, "POST", "/api/admin/auth/login", { username, password });

describe("admin management", () => {
  it("creates editors and owners who can sign in", async () => {
    const { app, owner } = await setup();

    const res = await createAdmin(app, owner, {
      username: "Marta",
      password: "marta-password",
      role: "editor",
    });
    await createAdmin(app, owner, { username: "co-owner", password: "co-password", role: "owner" });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ username: "marta", role: "editor", lastSeenAt: null });
    expect((await login(app, "marta", "marta-password")).status).toBe(200);

    const list = (await (
      await app.request("/api/admin/admins", { headers: { Cookie: owner } })
    ).json()) as { username: string; lastSeenAt: string | null }[];
    expect(list.map((admin) => admin.username)).toEqual(["co-owner", "owner", "marta"]);
    expect(list.find((admin) => admin.username === "marta")?.lastSeenAt).not.toBeNull();
  });

  it("rejects a taken username", async () => {
    const { app, owner } = await setup();

    const res = await createAdmin(app, owner, {
      username: "OWNER",
      password: "another-password",
      role: "editor",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "username_taken" });
  });

  it("resets another admin's password and ends their sessions", async () => {
    const { app, owner } = await setup();
    const created = (await (
      await createAdmin(app, owner, { username: "marta", password: "old-password", role: "editor" })
    ).json()) as { id: string };
    const martaSession = sessionCookie(await login(app, "marta", "old-password"));

    const res = await jsonRequest(
      app,
      "PUT",
      `/api/admin/admins/${created.id}/password`,
      { password: "new-password" },
      { Cookie: owner },
    );

    expect(res.status).toBe(204);
    const me = await app.request("/api/admin/auth/me", { headers: { Cookie: martaSession } });
    expect(me.status).toBe(401);
    expect((await login(app, "marta", "old-password")).status).toBe(401);
    expect((await login(app, "marta", "new-password")).status).toBe(200);
  });

  it("removes an admin, their sessions and logs it", async () => {
    const { app, platform, owner } = await setup();
    const created = (await (
      await createAdmin(app, owner, {
        username: "marta",
        password: "marta-password",
        role: "editor",
      })
    ).json()) as { id: string };
    const martaSession = sessionCookie(await login(app, "marta", "marta-password"));

    const res = await jsonRequest(app, "DELETE", `/api/admin/admins/${created.id}`, undefined, {
      Cookie: owner,
    });

    expect(res.status).toBe(204);
    const me = await app.request("/api/admin/auth/me", { headers: { Cookie: martaSession } });
    expect(me.status).toBe(401);
    const log = await platform.db.select().from(schema.auditLog);
    expect(log.at(-1)).toMatchObject({ action: "admin.removed", target: created.id });
  });

  it("doesn't let an owner reset or remove their own account", async () => {
    const { app, owner } = await setup();
    const me = (await (
      await app.request("/api/admin/auth/me", { headers: { Cookie: owner } })
    ).json()) as { id: string };

    const reset = await jsonRequest(
      app,
      "PUT",
      `/api/admin/admins/${me.id}/password`,
      { password: "new-password" },
      { Cookie: owner },
    );
    const remove = await jsonRequest(app, "DELETE", `/api/admin/admins/${me.id}`, undefined, {
      Cookie: owner,
    });

    expect(reset.status).toBe(400);
    expect(remove.status).toBe(400);
    expect(await remove.json()).toMatchObject({ code: "cannot_target_self" });
  });

  it("lets editors see the list but not change it", async () => {
    const { app, platform } = await setup();
    const editor = await signInAs(app, platform, "editor", "editor");

    expect((await app.request("/api/admin/admins", { headers: { Cookie: editor } })).status).toBe(
      200,
    );
    const res = await createAdmin(app, editor, {
      username: "sneaky",
      password: "sneaky-password",
      role: "owner",
    });
    expect(res.status).toBe(403);
  });

  it("answers 404 for an unknown admin", async () => {
    const { app, owner } = await setup();

    const res = await jsonRequest(app, "DELETE", "/api/admin/admins/nope", undefined, {
      Cookie: owner,
    });

    expect(res.status).toBe(404);
  });
});
