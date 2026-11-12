import type { BlacklistEntry, WhitelistEntry } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { cleanupExpiredBans } from "../src/cleanup";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  mojangFetch,
  PROFILES,
  playerAuth,
  setupOwner,
  signInAs,
  verifyPlayer,
} from "./helpers";

const NYXAR = PROFILES.Nyxar as string;
const TOMATE = PROFILES.Tomate_89 as string;

async function setup(fetchFn?: typeof fetch) {
  const platform = await createTestPlatform(fetchFn);
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const request = (method: string, path: string, body?: unknown) =>
    jsonRequest(app, method, path, body, { Cookie: owner });
  return { app, platform, owner, request };
}

const settings = (visibility: "public" | "private") => ({
  name: "Bocom",
  description: null,
  discordUrl: null,
  webUrl: null,
  visibility,
  minLauncherVersion: null,
});

async function activity(request: (method: string, path: string) => Response | Promise<Response>) {
  const { items } = (await (await request("GET", "/api/admin/activity")).json()) as {
    items: { action: string; target: string; details: Record<string, unknown> }[];
  };
  return items;
}

describe("organization whitelist", () => {
  it("adds players by name before they ever join, and lets them in", async () => {
    const { app, request } = await setup();
    await request("PUT", "/api/admin/settings", settings("private"));
    expect((await verifyPlayer(app, "Tomate_89")).status).toBe(403);

    const added = await request("POST", "/api/admin/whitelist", { player: "tomate_89" });
    expect(added.status).toBe(201);
    const entry = (await added.json()) as WhitelistEntry;
    // Tomate_89 tried to sign in before, but non-members aren't recorded.
    expect(entry).toMatchObject({
      player: { uuid: TOMATE, name: "Tomate_89", joined: false },
      addedBy: { username: "owner" },
    });

    const nyxar = (await (
      await request("POST", "/api/admin/whitelist", { player: "Nyxar" })
    ).json()) as WhitelistEntry;
    expect(nyxar.player).toEqual({ uuid: NYXAR, name: "Nyxar", joined: false });

    expect((await verifyPlayer(app, "Tomate_89")).status).toBe(200);
    expect((await verifyPlayer(app, "Nyxar")).status).toBe(200);

    const list = (await (await request("GET", "/api/admin/whitelist")).json()) as WhitelistEntry[];
    expect(list.map((item) => item.player.name)).toEqual(["Nyxar", "Tomate_89"]);
    expect((await activity(request))[0]).toMatchObject({
      action: "whitelist.added",
      target: NYXAR,
      details: { name: "Nyxar" },
    });
  });

  it("refuses duplicates and unknown names, and reports Mojang being down", async () => {
    const { request } = await setup();
    await request("POST", "/api/admin/whitelist", { player: "Nyxar" });

    const again = await request("POST", "/api/admin/whitelist", { player: NYXAR });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already_listed" });

    const unknown = await request("POST", "/api/admin/whitelist", { player: "Nobody" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "player_not_found" });

    expect((await request("POST", "/api/admin/whitelist", { player: "not a name" })).status).toBe(
      400,
    );

    const down = await setup(async () => new Response("down", { status: 500 }));
    const res = await down.request("POST", "/api/admin/whitelist", { player: "Nyxar" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "mojang_unavailable" });
  });

  it("looks players up on playerdb.co and falls back to Mojang", async () => {
    const mojang = mojangFetch();
    const playerDbDown = await setup(async (input, init) =>
      new URL(String(input)).host === "playerdb.co"
        ? new Response("<html>bad gateway</html>", { status: 502 })
        : mojang(input, init),
    );
    const viaMojang = await playerDbDown.request("POST", "/api/admin/whitelist", {
      player: "Nyxar",
    });
    expect(viaMojang.status).toBe(201);

    // As on Cloudflare: Mojang refuses, playerdb.co answers.
    const mojangBlocked = await setup(async (input, init) =>
      new URL(String(input)).host === "playerdb.co"
        ? mojang(input, init)
        : new Response("<html>blocked</html>", { status: 403 }),
    );
    const viaPlayerDb = await mojangBlocked.request("POST", "/api/admin/whitelist", {
      player: NYXAR,
    });
    expect(viaPlayerDb.status).toBe(201);
  });

  it("revokes a running token when the player is removed", async () => {
    const { app, request } = await setup();
    await request("POST", "/api/admin/whitelist", { player: "Nyxar" });
    await request("PUT", "/api/admin/settings", settings("private"));
    const auth = await playerAuth(app, "Nyxar");

    const removed = await request("DELETE", `/api/admin/whitelist/${NYXAR}`);
    expect(removed.status).toBe(204);
    expect((await app.request("/api/v1/instances", { headers: auth })).status).toBe(403);
    expect((await request("DELETE", `/api/admin/whitelist/${NYXAR}`)).status).toBe(404);
    expect((await activity(request))[0]).toMatchObject({ action: "whitelist.removed" });
  });

  it("is open to editors", async () => {
    const { app, platform } = await setup();
    const editor = await signInAs(app, platform, "marta", "editor");
    const res = await jsonRequest(
      app,
      "POST",
      "/api/admin/whitelist",
      { player: "Nyxar" },
      { Cookie: editor },
    );
    expect(res.status).toBe(201);
  });
});

describe("organization blacklist", () => {
  it("bans with a reason and an expiry, wins over the whitelist, and unbans", async () => {
    const { app, request } = await setup();
    await request("POST", "/api/admin/whitelist", { player: "Nyxar" });
    await request("PUT", "/api/admin/settings", settings("private"));
    const auth = await playerAuth(app, "Nyxar");
    const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();

    const banned = await request("POST", "/api/admin/blacklist", {
      player: "Nyxar",
      reason: "Griefing",
      expiresAt,
    });
    expect(banned.status).toBe(201);
    expect(await banned.json()).toMatchObject({ reason: "Griefing", expiresAt });
    expect((await app.request("/api/v1/instances", { headers: auth })).status).toBe(403);
    expect((await activity(request))[0]).toMatchObject({
      action: "player.banned",
      details: { name: "Nyxar", reason: "Griefing", expiresAt },
    });

    // Banning again replaces the ban.
    await request("POST", "/api/admin/blacklist", {
      player: NYXAR,
      reason: null,
      expiresAt: null,
    });
    const list = (await (await request("GET", "/api/admin/blacklist")).json()) as BlacklistEntry[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: null, expiresAt: null });

    expect((await request("DELETE", `/api/admin/blacklist/${NYXAR}`)).status).toBe(204);
    // Still on the whitelist: back to the access they had.
    expect((await app.request("/api/v1/instances", { headers: auth })).status).toBe(200);
    expect((await activity(request))[0]).toMatchObject({ action: "player.unbanned" });
  });

  it("refuses expiries in the past", async () => {
    const { request } = await setup();
    const res = await request("POST", "/api/admin/blacklist", {
      player: "Nyxar",
      reason: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_expiry" });
  });

  it("hides expired bans and the cleanup deletes them", async () => {
    const { platform, request } = await setup();
    await request("POST", "/api/admin/blacklist", {
      player: "Nyxar",
      reason: null,
      expiresAt: null,
    });
    await platform.db.insert(schema.orgBlacklist).values({
      playerUuid: (
        (await (
          await request("POST", "/api/admin/whitelist", { player: "Tomate_89" })
        ).json()) as WhitelistEntry
      ).player.uuid,
      expiresAt: new Date(Date.now() - 1000),
    });

    const list = (await (await request("GET", "/api/admin/blacklist")).json()) as BlacklistEntry[];
    expect(list.map((entry) => entry.player.name)).toEqual(["Nyxar"]);

    await cleanupExpiredBans(platform.db);
    const rows = await platform.db.select().from(schema.orgBlacklist);
    expect(rows.map((row) => row.playerUuid)).toEqual([NYXAR]);
  });
});

describe("instance lists", () => {
  async function withInstance() {
    const context = await setup();
    await context.request("POST", "/api/admin/instances", {
      id: "serie-t3",
      name: "Serie T3",
      description: null,
      mcVersion: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
    });
    return context;
  }

  it("manages an instance's whitelist and blacklist", async () => {
    const { request } = await withInstance();
    const base = "/api/admin/instances/serie-t3";

    expect((await request("POST", `${base}/whitelist`, { player: "Nyxar" })).status).toBe(201);
    expect(
      (
        await request("POST", `${base}/blacklist`, {
          player: "Tomate_89",
          reason: "X-ray",
          expiresAt: null,
        })
      ).status,
    ).toBe(201);

    const whitelist = (await (
      await request("GET", `${base}/whitelist`)
    ).json()) as WhitelistEntry[];
    const blacklist = (await (
      await request("GET", `${base}/blacklist`)
    ).json()) as BlacklistEntry[];
    expect(whitelist.map((entry) => entry.player.name)).toEqual(["Nyxar"]);
    expect(blacklist.map((entry) => entry.reason)).toEqual(["X-ray"]);
    // The organization's lists are separate.
    expect(await (await request("GET", "/api/admin/whitelist")).json()).toEqual([]);

    const log = await activity(request);
    expect(log[0]).toMatchObject({
      action: "player.banned",
      details: { name: "Tomate_89", instance: "serie-t3" },
    });
    expect(log[1]).toMatchObject({
      action: "whitelist.added",
      details: { name: "Nyxar", instance: "serie-t3" },
    });

    expect((await request("DELETE", `${base}/whitelist/${NYXAR}`)).status).toBe(204);
    expect((await request("DELETE", `${base}/blacklist/${TOMATE}`)).status).toBe(204);
    expect((await request("DELETE", `${base}/blacklist/${TOMATE}`)).status).toBe(404);
  });

  it("answers 404 for unknown instances and drops the lists with the instance", async () => {
    const { platform, request } = await withInstance();
    expect((await request("GET", "/api/admin/instances/nope/whitelist")).status).toBe(404);
    expect(
      (await request("POST", "/api/admin/instances/nope/whitelist", { player: "Nyxar" })).status,
    ).toBe(404);

    await request("POST", "/api/admin/instances/serie-t3/whitelist", { player: "Nyxar" });
    await request("POST", "/api/admin/instances/serie-t3/blacklist", {
      player: "Nyxar",
      reason: null,
      expiresAt: null,
    });
    expect((await request("DELETE", "/api/admin/instances/serie-t3")).status).toBe(204);
    expect(await platform.db.select().from(schema.instanceWhitelist)).toEqual([]);
    expect(await platform.db.select().from(schema.instanceBlacklist)).toEqual([]);
  });

  it("looks up unknown uuids at Mojang", async () => {
    const { request } = await withInstance();
    const res = await request("POST", "/api/admin/instances/serie-t3/whitelist", {
      player: PROFILES.GrieferX,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as WhitelistEntry).player.name).toBe("GrieferX");
  });

  it("changes who can play an instance, and logs it", async () => {
    const { request } = await withInstance();
    const res = await request("PUT", "/api/admin/instances/serie-t3/access", {
      access: "whitelist",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access: "whitelist" });
    const instance = (await (await request("GET", "/api/admin/instances/serie-t3")).json()) as {
      access: string;
    };
    expect(instance.access).toBe("whitelist");
    expect((await activity(request))[0]).toMatchObject({
      action: "instance.access_changed",
      target: "serie-t3",
      details: { from: "everyone", to: "whitelist" },
    });
    expect(
      (await request("PUT", "/api/admin/instances/nope/access", { access: "everyone" })).status,
    ).toBe(404);
  });
});
