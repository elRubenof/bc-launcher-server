import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { createTestPlatform } from "./helpers";

describe("migrations", () => {
  it("create the default settings row", async () => {
    const { db } = await createTestPlatform();

    const rows = await db.select().from(schema.settings);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, name: "BC Launcher Server", visibility: "public" });
  });

  it("allow only one settings row", async () => {
    const { db } = await createTestPlatform();

    await expect(db.insert(schema.settings).values({ id: 2, name: "Other" })).rejects.toThrow();
  });
});
