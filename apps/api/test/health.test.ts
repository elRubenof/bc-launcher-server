import type { Database } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { createTestApp, createTestPlatform } from "./helpers";

describe("GET /health", () => {
  it("responds ok", async () => {
    const res = await createTestApp().request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("responds 503 when the database is unreachable", async () => {
    const platform = createTestPlatform();
    platform.db = {
      run: () => Promise.reject(new Error("database is down")),
    } as unknown as Database;

    const res = await createTestApp(platform).request("/health");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
  });
});
