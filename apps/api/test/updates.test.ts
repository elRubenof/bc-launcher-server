import { beforeEach, describe, expect, it } from "vitest";
import { checkUpdates, isNewer, LATEST_RELEASE_URL, resetUpdatesCache } from "../src/updates";
import { createTestApp, createTestPlatform, setupOwner, signInAs } from "./helpers";

const RELEASES = "https://github.com/elRubenof/bc-launcher-server/releases";

/** A fetch that answers the latest-release URL with a redirect to `location`, counting calls. */
function githubFetch(location: string | null, calls = { count: 0 }): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe(LATEST_RELEASE_URL);
    calls.count++;
    return new Response(null, location ? { status: 302, headers: { location } } : { status: 500 });
  };
}

beforeEach(() => resetUpdatesCache());

describe("isNewer", () => {
  it("compares each part as a number", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });
});

describe("checkUpdates", () => {
  it("reports a newer release from GitHub's redirect", async () => {
    const platform = await createTestPlatform(githubFetch(`${RELEASES}/tag/v0.2.0`));

    expect(await checkUpdates(platform, "0.1.0")).toEqual({
      current: "0.1.0",
      latest: "0.2.0",
      url: `${RELEASES}/tag/v0.2.0`,
      updateAvailable: true,
    });
  });

  it("reports no update when up to date", async () => {
    const platform = await createTestPlatform(githubFetch(`${RELEASES}/tag/v0.1.0`));

    expect((await checkUpdates(platform, "0.1.0")).updateAvailable).toBe(false);
  });

  it("returns no latest version without releases or when GitHub fails", async () => {
    for (const fetchFn of [githubFetch(RELEASES), githubFetch(null)]) {
      resetUpdatesCache();
      const platform = await createTestPlatform(fetchFn);
      expect(await checkUpdates(platform, "0.1.0")).toEqual({
        current: "0.1.0",
        latest: null,
        url: null,
        updateAvailable: false,
      });
    }
    const throwing = await createTestPlatform(async () => {
      throw new Error("offline");
    });
    resetUpdatesCache();
    expect((await checkUpdates(throwing, "0.1.0")).latest).toBeNull();
  });

  it("checks GitHub at most every 6 hours, and 30 minutes after a failure", async () => {
    const calls = { count: 0 };
    const platform = await createTestPlatform(githubFetch(`${RELEASES}/tag/v0.2.0`, calls));
    const start = Date.now();

    await checkUpdates(platform, "0.1.0", start);
    await checkUpdates(platform, "0.1.0", start + 5 * 3600_000);
    expect(calls.count).toBe(1);
    await checkUpdates(platform, "0.1.0", start + 6 * 3600_000);
    expect(calls.count).toBe(2);

    resetUpdatesCache();
    const failures = { count: 0 };
    const failing = await createTestPlatform(githubFetch(null, failures));
    await checkUpdates(failing, "0.1.0", start);
    await checkUpdates(failing, "0.1.0", start + 29 * 60_000);
    expect(failures.count).toBe(1);
    await checkUpdates(failing, "0.1.0", start + 30 * 60_000);
    expect(failures.count).toBe(2);
  });
});

describe("GET /api/admin/updates", () => {
  it("is for the owner and admins only", async () => {
    const platform = await createTestPlatform(githubFetch(`${RELEASES}/tag/v99.0.0`));
    const app = await createTestApp(platform);
    const owner = await setupOwner(app);
    const admin = await signInAs(app, platform, "ana", "admin");
    const editor = await signInAs(app, platform, "bea", "editor");

    for (const cookie of [owner, admin]) {
      const res = await app.request("/api/admin/updates", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ latest: "99.0.0", updateAvailable: true });
    }
    const res = await app.request("/api/admin/updates", { headers: { Cookie: editor } });
    expect(res.status).toBe(403);
    expect((await app.request("/api/admin/updates")).status).toBe(401);
  });
});
