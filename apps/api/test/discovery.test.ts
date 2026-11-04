import { DiscoveryDocument } from "@bc-launcher-server/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers";

describe("GET /.well-known/bc-launcher", () => {
  it("returns a valid discovery document with the defaults", async () => {
    const res = await (await createTestApp()).request("/.well-known/bc-launcher");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");

    const body = DiscoveryDocument.parse(await res.json());
    expect(body).toMatchObject({
      discoveryVersion: 1,
      visibility: "public",
      apiVersions: [1],
      auth: { type: "mojang-session" },
    });
    expect(body.serverVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
