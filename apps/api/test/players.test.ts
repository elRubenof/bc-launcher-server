import type { PlayerDetail, PlayerSummary } from "@bc-launcher-server/contracts";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  PROFILES,
  playerAuth,
  setupOwner,
} from "./helpers";

const NYXAR = PROFILES.Nyxar as string;
const TOMATE = PROFILES.Tomate_89 as string;

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const request = (method: string, path: string, body?: unknown) =>
    jsonRequest(app, method, path, body, { Cookie: owner });

  const mod = new TextEncoder().encode("sodium");
  const sha256 = await sha256Hex(mod);
  await app.request(`/api/admin/blobs/${sha256}`, {
    method: "PUT",
    headers: { Cookie: owner, Origin: "http://localhost", "Content-Length": "6" },
    body: mod,
  });
  for (const id of ["serie-t3", "evento"]) {
    await request("POST", "/api/admin/instances", {
      id,
      name: id,
      description: null,
      mcVersion: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
    });
    await request("PUT", `/api/admin/instances/${id}/content`, {
      expectedContentVersion: 0,
      mcVersion: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
      managedDirs: [],
      files: [{ path: "mods/sodium.jar", sha256, policy: "always" }],
    });
  }
  await playerAuth(app, "Nyxar");
  await playerAuth(app, "Tomate_89");
  await request("POST", "/api/admin/instances/evento/blacklist", {
    player: "Tomate_89",
    reason: "Griefing",
    expiresAt: null,
  });
  await request("POST", "/api/admin/blacklist", {
    player: "GrieferX",
    reason: null,
    expiresAt: null,
  });
  return { app, request };
}

type Page = { items: PlayerSummary[]; total: number; launchableInstances: number };

describe("players", () => {
  it("lists players with their status and how many instances they can play", async () => {
    const { request } = await setup();
    const page = (await (await request("GET", "/api/admin/players")).json()) as Page;

    expect(page.total).toBe(3);
    expect(page.launchableInstances).toBe(2);
    const byName = Object.fromEntries(page.items.map((item) => [item.name, item]));
    expect(byName.Nyxar).toMatchObject({ status: "member", playableInstances: 2, instanceBans: 0 });
    expect(byName.Tomate_89).toMatchObject({
      status: "member",
      playableInstances: 1,
      instanceBans: 1,
    });
    expect(byName.GrieferX).toMatchObject({
      status: "banned",
      playableInstances: 0,
      firstSeenAt: null,
    });
    // Never seen last.
    expect(page.items.at(-1)?.name).toBe("GrieferX");
  });

  it("filters by name, status and instance", async () => {
    const { request } = await setup();
    const names = async (query: string) =>
      ((await (await request("GET", `/api/admin/players?${query}`)).json()) as Page).items
        .map((item) => item.name)
        .sort();

    expect(await names("q=e_8")).toEqual(["Tomate_89"]);
    expect(await names("q=ma")).toEqual(["Tomate_89"]);
    // `_` is literal, not a wildcard.
    expect(await names("q=x_")).toEqual([]);
    expect(await names(`q=${NYXAR.slice(0, 6)}`)).toEqual(["Nyxar"]);
    expect(await names("status=banned")).toEqual(["GrieferX", "Tomate_89"]);
    expect(await names("status=member")).toEqual(["Nyxar", "Tomate_89"]);
    expect(await names("status=never_joined")).toEqual(["GrieferX"]);
    expect(await names("instance=evento")).toEqual(["Nyxar"]);
    expect(await names("limit=1&offset=1")).toHaveLength(1);
  });

  it("shows a player's access to the organization and each instance", async () => {
    const { request } = await setup();
    const res = await request("GET", `/api/admin/players/${TOMATE}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as PlayerDetail;

    expect(detail.organization).toEqual({
      visibility: "public",
      status: "member",
      whitelisted: false,
      ban: null,
    });
    expect(detail.instances).toEqual([
      expect.objectContaining({
        id: "evento",
        visible: false,
        ban: expect.objectContaining({ reason: "Griefing", addedBy: expect.anything() }),
      }),
      expect.objectContaining({ id: "serie-t3", visible: true, ban: null, launchable: true }),
    ]);

    expect(
      (await request("GET", "/api/admin/players/00000000-0000-0000-0000-000000000000")).status,
    ).toBe(404);
  });
});
