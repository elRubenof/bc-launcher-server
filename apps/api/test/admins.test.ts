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
  const ownerId = ((await (await me(app, owner)).json()) as { id: string }).id;
  return { app, platform, owner, ownerId };
}

type App = Awaited<ReturnType<typeof createTestApp>>;

const me = (app: App, cookie: string) =>
  app.request("/api/admin/auth/me", { headers: { Cookie: cookie } });

const createAdmin = async (app: App, cookie: string, body: object) =>
  jsonRequest(app, "POST", "/api/admin/admins", body, { Cookie: cookie });

const createAndGetId = async (app: App, cookie: string, username: string, role: string) => {
  const res = await createAdmin(app, cookie, { username, password: `${username}-password`, role });
  return ((await res.json()) as { id: string }).id;
};

const login = (app: App, username: string, password: string) =>
  jsonRequest(app, "POST", "/api/admin/auth/login", { username, password });

const changeRole = (app: App, cookie: string, id: string, role: string) =>
  jsonRequest(app, "PUT", `/api/admin/admins/${id}/role`, { role }, { Cookie: cookie });

const resetPassword = (app: App, cookie: string, id: string) =>
  jsonRequest(
    app,
    "PUT",
    `/api/admin/admins/${id}/password`,
    { password: "new-password" },
    { Cookie: cookie },
  );

const remove = (app: App, cookie: string, id: string) =>
  jsonRequest(app, "DELETE", `/api/admin/admins/${id}`, undefined, { Cookie: cookie });

describe("accounts", () => {
  it("creates admins and editors who can sign in, listed owner first", async () => {
    const { app, owner } = await setup();

    const res = await createAdmin(app, owner, {
      username: "Marta",
      password: "marta-password",
      role: "editor",
    });
    await createAndGetId(app, owner, "alex", "admin");

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ username: "marta", role: "editor", lastSeenAt: null });
    expect((await login(app, "marta", "marta-password")).status).toBe(200);

    const list = (await (
      await app.request("/api/admin/admins", { headers: { Cookie: owner } })
    ).json()) as { username: string; role: string; lastSeenAt: string | null }[];
    expect(list.map((account) => [account.username, account.role])).toEqual([
      ["owner", "owner"],
      ["alex", "admin"],
      ["marta", "editor"],
    ]);
    expect(list.find((account) => account.username === "marta")?.lastSeenAt).not.toBeNull();
  });

  it("never creates a second owner", async () => {
    const { app, platform, owner } = await setup();

    const res = await createAdmin(app, owner, {
      username: "co-owner",
      password: "co-password",
      role: "owner",
    });

    expect(res.status).toBe(400);
    await expect(
      platform.db
        .insert(schema.admins)
        .values({ id: "x", username: "sneaky", passwordHash: "x", role: "owner" }),
    ).rejects.toThrow();
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

  it("resets another account's password and ends its sessions", async () => {
    const { app, owner } = await setup();
    const id = await createAndGetId(app, owner, "marta", "editor");
    const martaSession = sessionCookie(await login(app, "marta", "marta-password"));

    const res = await resetPassword(app, owner, id);

    expect(res.status).toBe(204);
    expect((await me(app, martaSession)).status).toBe(401);
    expect((await login(app, "marta", "marta-password")).status).toBe(401);
    expect((await login(app, "marta", "new-password")).status).toBe(200);
  });

  it("removes an account and its sessions, and logs it", async () => {
    const { app, platform, owner } = await setup();
    const id = await createAndGetId(app, owner, "marta", "editor");
    const martaSession = sessionCookie(await login(app, "marta", "marta-password"));

    const res = await remove(app, owner, id);

    expect(res.status).toBe(204);
    expect((await me(app, martaSession)).status).toBe(401);
    const log = await platform.db.select().from(schema.auditLog);
    expect(log.at(-1)).toMatchObject({ action: "admin.removed", target: id });
  });

  it("changes roles, effective on the account's next request", async () => {
    const { app, platform, owner } = await setup();
    const id = await createAndGetId(app, owner, "alex", "admin");
    const alex = sessionCookie(await login(app, "alex", "alex-password"));

    const res = await changeRole(app, owner, id, "editor");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "editor" });
    expect(await (await me(app, alex)).json()).toMatchObject({ role: "editor" });
    expect(
      (await createAdmin(app, alex, { username: "x-y-z", password: "12345678", role: "editor" }))
        .status,
    ).toBe(403);
    const log = await platform.db.select().from(schema.auditLog);
    expect(log.at(-1)).toMatchObject({
      action: "admin.role_changed",
      details: { from: "admin", to: "editor" },
    });
  });

  it("lets admins manage other admins and editors", async () => {
    const { app, owner } = await setup();
    await createAndGetId(app, owner, "alex", "admin");
    const alex = sessionCookie(await login(app, "alex", "alex-password"));
    const otherAdmin = await createAndGetId(app, alex, "bea", "admin");
    const editor = await createAndGetId(app, alex, "carla", "editor");

    expect((await changeRole(app, alex, otherAdmin, "editor")).status).toBe(200);
    expect((await resetPassword(app, alex, editor)).status).toBe(204);
    expect((await remove(app, alex, editor)).status).toBe(204);
  });

  it("never lets anyone act on the owner", async () => {
    const { app, owner, ownerId } = await setup();
    await createAndGetId(app, owner, "alex", "admin");
    const alex = sessionCookie(await login(app, "alex", "alex-password"));

    for (const res of [
      await changeRole(app, alex, ownerId, "editor"),
      await resetPassword(app, alex, ownerId),
      await remove(app, alex, ownerId),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "owner_protected" });
    }
    expect((await login(app, "owner", "owner-password")).status).toBe(200);
  });

  it("doesn't let anyone act on their own account", async () => {
    const { app, owner, ownerId } = await setup();

    for (const res of [
      await changeRole(app, owner, ownerId, "admin"),
      await resetPassword(app, owner, ownerId),
      await remove(app, owner, ownerId),
    ]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "cannot_target_self" });
    }
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
      role: "admin",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
  });

  it("answers 404 for an unknown account", async () => {
    const { app, owner } = await setup();

    expect((await remove(app, owner, "nope")).status).toBe(404);
  });
});
