import type { NewsItem } from "@bc-launcher-server/contracts";
import { schema } from "@bc-launcher-server/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto";
import { cleanupOrphanBlobs, ORPHAN_GRACE_MS } from "../src/cleanup";
import {
  createTestApp,
  createTestPlatform,
  jsonRequest,
  playerAuth,
  setupOwner,
  signInAs,
} from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

const ITEM = {
  title: "¡Empieza la Temporada 3!",
  body: "Arrancamos el **viernes**.",
  imageSha256: null,
  link: "https://youtube.com/@bocom",
  pinned: false,
  publishedAt: null,
};

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  const request = (method: string, path: string, body?: unknown, cookie = owner) =>
    jsonRequest(app, method, path, body, { Cookie: cookie });
  await request("POST", "/api/admin/instances", {
    id: "serie-t3",
    name: "Serie T3",
    description: null,
    mcVersion: "1.21.1",
    loader: "vanilla",
    loaderVersion: null,
  });
  const uploadImage = async (bytes = PNG) => {
    const res = await app.request("/api/admin/images", {
      method: "POST",
      headers: { Cookie: owner, Origin: "http://localhost", "Content-Type": "image/png" },
      body: bytes,
    });
    return res;
  };
  return { app, platform, owner, request, uploadImage };
}

const base = "/api/admin/instances/serie-t3/news";

describe("news (panel)", () => {
  it("creates, lists, updates and deletes news, and logs it", async () => {
    const { request } = await setup();

    const created = await request("POST", base, ITEM);
    expect(created.status).toBe(201);
    const item = (await created.json()) as NewsItem;
    expect(item).toMatchObject({
      instanceId: "serie-t3",
      title: ITEM.title,
      pinned: false,
      createdBy: { username: "owner" },
    });
    expect(Date.parse(item.publishedAt)).toBeLessThanOrEqual(Date.now());

    const scheduledAt = new Date(Date.now() + 86400_000).toISOString();
    await request("POST", base, { ...ITEM, title: "Programada", publishedAt: scheduledAt });
    await request("POST", base, { ...ITEM, title: "Fijada", pinned: true });

    const list = (await (await request("GET", base)).json()) as NewsItem[];
    expect(list.map((news) => news.title)).toEqual(["Fijada", "Programada", ITEM.title]);

    const updated = await request("PUT", `${base}/${item.id}`, { ...ITEM, title: "Nuevo título" });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as NewsItem).title).toBe("Nuevo título");

    expect((await request("DELETE", `${base}/${item.id}`)).status).toBe(204);
    expect((await request("DELETE", `${base}/${item.id}`)).status).toBe(404);

    const { items } = (await (await request("GET", "/api/admin/activity?type=news")).json()) as {
      items: { action: string; target: string; details: { title: string } }[];
    };
    expect(items.map((entry) => entry.action)).toEqual([
      "news.deleted",
      "news.updated",
      "news.created",
      "news.created",
      "news.created",
    ]);
    expect(items[0]).toMatchObject({ target: "serie-t3", details: { title: "Nuevo título" } });
  });

  it("uses uploaded images and refuses anything else", async () => {
    const { request, uploadImage } = await setup();
    const res = await uploadImage();
    expect(res.status).toBe(201);
    const { sha256, url } = (await res.json()) as { sha256: string; url: string };
    expect(url).toBe(`http://localhost:8787/api/v1/assets/${sha256}`);

    const item = (await (
      await request("POST", base, { ...ITEM, imageSha256: sha256 })
    ).json()) as NewsItem;
    expect(item).toMatchObject({ imageSha256: sha256, imageUrl: url });

    const bad = await request("POST", base, { ...ITEM, imageSha256: "a".repeat(64) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_image" });

    const notImage = await uploadImage(new TextEncoder().encode("hello"));
    expect(notImage.status).toBe(400);
  });

  it("keeps used images in the cleanup and deletes unused uploads", async () => {
    const { platform, request, uploadImage } = await setup();
    const used = ((await (await uploadImage()).json()) as { sha256: string }).sha256;
    const unused = (
      (await (await uploadImage(new Uint8Array([...PNG, 1]))).json()) as { sha256: string }
    ).sha256;
    await request("POST", base, { ...ITEM, imageSha256: used });

    const now = Date.now();
    await cleanupOrphanBlobs(platform, now);
    await cleanupOrphanBlobs(platform, now + ORPHAN_GRACE_MS + 1000);

    const left = (await platform.db.select().from(schema.blobs)).map((blob) => blob.sha256);
    expect(left).toContain(used);
    expect(left).not.toContain(unused);
  });

  it("validates, answers 404 for unknown instances, is open to editors and goes with the instance", async () => {
    const { app, platform, request } = await setup();
    expect((await request("POST", base, { ...ITEM, title: " " })).status).toBe(400);
    expect((await request("POST", base, { ...ITEM, link: "javascript:alert(1)" })).status).toBe(
      400,
    );
    expect((await request("GET", "/api/admin/instances/nope/news")).status).toBe(404);
    expect((await request("POST", "/api/admin/instances/nope/news", ITEM)).status).toBe(404);

    const editor = await signInAs(app, platform, "marta", "editor");
    expect((await request("POST", base, ITEM, editor)).status).toBe(201);

    expect((await request("DELETE", "/api/admin/instances/serie-t3")).status).toBe(204);
    expect(await platform.db.select().from(schema.news)).toEqual([]);
  });
});

describe("news (launcher)", () => {
  async function withContent() {
    const context = await setup();
    const { app, owner, request } = context;
    const mod = new TextEncoder().encode("sodium");
    const sha256 = await sha256Hex(mod);
    await app.request(`/api/admin/blobs/${sha256}`, {
      method: "PUT",
      headers: { Cookie: owner, Origin: "http://localhost", "Content-Length": "6" },
      body: mod,
    });
    await request("PUT", "/api/admin/instances/serie-t3/content", {
      expectedContentVersion: 0,
      mcVersion: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
      managedDirs: [],
      files: [{ path: "mods/sodium.jar", sha256, policy: "always" }],
    });
    const player = await playerAuth(app, "Nyxar");
    const news = async (query = "") => {
      const res = await app.request(`/api/v1/instances/serie-t3/news${query}`, {
        headers: player,
      });
      return res;
    };
    return { ...context, news };
  }

  type Page = { items: { title: string; pinned: boolean }[]; nextCursor: string | null };

  it("serves published news, pinned first, and hides scheduled news", async () => {
    const { request, news } = await withContent();
    await request("POST", base, {
      ...ITEM,
      title: "Antigua",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    await request("POST", base, { ...ITEM, title: "Reciente" });
    await request("POST", base, {
      ...ITEM,
      title: "Fijada",
      pinned: true,
      publishedAt: "2025-01-01T00:00:00.000Z",
    });
    await request("POST", base, {
      ...ITEM,
      title: "Programada",
      publishedAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const res = await news();
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    expect(page.items.map((item) => item.title)).toEqual(["Fijada", "Reciente", "Antigua"]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[1]).toEqual({
      id: expect.any(String),
      title: "Reciente",
      body: ITEM.body,
      imageUrl: null,
      link: ITEM.link,
      pinned: false,
      publishedAt: expect.any(String),
    });
  });

  it("pages through news with a cursor", async () => {
    const { platform, news } = await withContent();
    // 45 items with some equal dates, to check the tie-breaker.
    await platform.db.insert(schema.news).values(
      Array.from({ length: 45 }, (_, i) => ({
        id: crypto.randomUUID(),
        instanceId: "serie-t3",
        title: `N${i}`,
        body: "",
        pinned: i % 10 === 0,
        publishedAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 3))),
      })),
    );

    const titles: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = (await (await news(cursor ? `?cursor=${cursor}` : "")).json()) as Page;
      titles.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(new Set(titles).size).toBe(45);
    expect(titles.slice(0, 5)).toEqual(["N40", "N30", "N20", "N10", "N0"]);
    expect((await news("?cursor=nope")).status).toBe(400);
  });

  it("is invisible when the player can't play the instance", async () => {
    const { platform, news, app } = await withContent();
    await platform.db
      .update(schema.instances)
      .set({ access: "whitelist" })
      .where(eq(schema.instances.id, "serie-t3"));
    expect((await news()).status).toBe(404);
    expect((await app.request("/api/v1/instances/serie-t3/news")).status).toBe(401);
  });
});
