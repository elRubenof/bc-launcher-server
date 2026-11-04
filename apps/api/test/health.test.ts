import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers";

describe("GET /health", () => {
  it("responds ok", async () => {
    const res = await createTestApp().request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
