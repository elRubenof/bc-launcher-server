import { describe, expect, it } from "vitest";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  setupOwner,
  stubFetch,
  UPSTREAM,
} from "./helpers";

async function setup(fetchFn = stubFetch()) {
  const app = await createTestApp(await createTestPlatform(fetchFn));
  const owner = await setupOwner(app);
  const get = async (path: string) => {
    const res = await jsonRequest(app, "GET", path, undefined, { Cookie: owner });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { app, owner, get };
}

const NEW_INSTANCE = {
  id: "serie-t3",
  name: "Serie T3",
  description: null,
  mcVersion: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.9",
};

describe("Minecraft and loader versions", () => {
  it("lists Minecraft releases, or every version", async () => {
    const { get } = await setup();

    const releases = await get("/api/admin/minecraft/versions");
    expect(releases.status).toBe(200);
    expect((releases.body.versions as { id: string }[]).map((v) => v.id)).toEqual([
      "1.21.1",
      "1.20.1",
    ]);
    const all = await get("/api/admin/minecraft/versions?all=true");
    expect(all.body.versions).toHaveLength(3);
  });

  it("lists Fabric and Quilt versions with the newest stable one recommended", async () => {
    const { get } = await setup();

    expect((await get("/api/admin/loaders/fabric/versions?mc=1.21.1")).body.versions).toEqual([
      { version: "0.16.10-beta.1", stable: false, recommended: false },
      { version: "0.16.9", stable: true, recommended: true },
      { version: "0.16.8", stable: true, recommended: false },
    ]);
    expect((await get("/api/admin/loaders/quilt/versions?mc=1.21.1")).body.versions).toEqual([
      { version: "0.27.0-beta.1", stable: false, recommended: false },
      { version: "0.26.4", stable: true, recommended: true },
    ]);
  });

  it("lists Forge versions for one Minecraft version with its recommended one", async () => {
    const { get } = await setup();

    expect((await get("/api/admin/loaders/forge/versions?mc=1.20.1")).body.versions).toEqual([
      { version: "47.3.0", stable: true, recommended: false },
      { version: "47.2.0", stable: true, recommended: true },
    ]);
  });

  it("maps Minecraft versions to NeoForge's numbering", async () => {
    const { get } = await setup();

    expect((await get("/api/admin/loaders/neoforge/versions?mc=1.21.1")).body.versions).toEqual([
      { version: "21.1.77", stable: true, recommended: true },
      { version: "21.1.76", stable: true, recommended: false },
    ]);
  });

  it("returns an empty list for Minecraft versions a loader doesn't support", async () => {
    const { get } = await setup();

    expect((await get("/api/admin/loaders/fabric/versions?mc=1.20.1")).body.versions).toEqual([]);
  });

  it("answers 502 when the metadata can't be fetched", async () => {
    const { get } = await setup(async () => new Response("down", { status: 503 }));

    const res = await get("/api/admin/loaders/fabric/versions?mc=1.21.1");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "metadata_unavailable" });
  });

  it("checks the versions when creating an instance", async () => {
    const { app, owner } = await setup();
    const create = (body: object) =>
      jsonRequest(
        app,
        "POST",
        "/api/admin/instances",
        { ...NEW_INSTANCE, ...body },
        {
          Cookie: owner,
        },
      );

    for (const bad of [{ mcVersion: "1.99" }, { loaderVersion: "0.1.0" }, { loader: "forge" }]) {
      const res = await create(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_version" });
    }
    expect((await create({ loader: "vanilla", loaderVersion: null })).status).toBe(201);
  });

  it("refuses to create an instance when the versions can't be checked", async () => {
    const { app, owner } = await setup(
      stubFetch({
        ...UPSTREAM,
        "https://meta.fabricmc.net/v2/versions/loader/1.21.1": new Response("", { status: 500 }),
      }),
    );

    const res = await jsonRequest(app, "POST", "/api/admin/instances", NEW_INSTANCE, {
      Cookie: owner,
    });

    expect(res.status).toBe(502);
  });
});
