import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform, jsonRequest, setupOwner } from "./helpers";

type Page = {
  items: { action: string; admin: { username: string } | null }[];
  nextBefore: number | null;
};

async function setup() {
  const platform = await createTestPlatform();
  const app = await createTestApp(platform);
  const owner = await setupOwner(app);
  // setup → admin.created; three more creations; one settings change.
  for (const username of ["ana", "bea", "carla"]) {
    await jsonRequest(
      app,
      "POST",
      "/api/admin/admins",
      { username, password: `${username}-password`, role: "editor" },
      { Cookie: owner },
    );
  }
  await jsonRequest(
    app,
    "PUT",
    "/api/admin/settings",
    {
      name: "Bocom",
      description: null,
      discordUrl: null,
      webUrl: null,
      visibility: "private",
      minLauncherVersion: null,
    },
    { Cookie: owner },
  );
  return { app, owner };
}

const get = async (app: Awaited<ReturnType<typeof setup>>["app"], cookie: string, query = "") =>
  (await (
    await app.request(`/api/admin/activity${query}`, { headers: { Cookie: cookie } })
  ).json()) as Page;

describe("activity", () => {
  it("lists entries newest first with who did them", async () => {
    const { app, owner } = await setup();

    const page = await get(app, owner);

    expect(page.items.map((entry) => entry.action)).toEqual([
      "org.visibility_changed",
      "admin.created",
      "admin.created",
      "admin.created",
      "admin.created",
    ]);
    expect(page.items[0]?.admin?.username).toBe("owner");
    expect(page.nextBefore).toBeNull();
  });

  it("pages with `before`", async () => {
    const { app, owner } = await setup();

    const first = await get(app, owner, "?limit=2");
    const second = await get(app, owner, `?limit=2&before=${first.nextBefore}`);
    const third = await get(app, owner, `?limit=2&before=${second.nextBefore}`);

    expect([...first.items, ...second.items, ...third.items]).toHaveLength(5);
    expect(third.nextBefore).toBeNull();
  });

  it("filters by type", async () => {
    const { app, owner } = await setup();

    const page = await get(app, owner, "?type=org");

    expect(page.items.map((entry) => entry.action)).toEqual(["org.visibility_changed"]);
  });
});
