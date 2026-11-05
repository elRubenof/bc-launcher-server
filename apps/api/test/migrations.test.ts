import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { schema } from "@bc-launcher-server/db";
import { type Client, createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { SOURCE_MIGRATIONS_DIR } from "../src/platform/node/migrate";
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

/** Runs the migration files whose names start with `prefixes`, statement by statement. */
async function runMigrations(client: Client, prefixes: string[]) {
  const files = (await readdir(SOURCE_MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql") && prefixes.some((p) => file.startsWith(p)))
    .sort();
  for (const file of files) {
    const sqlText = await readFile(join(SOURCE_MIGRATIONS_DIR, file), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement);
    }
  }
}

describe("0006_drop_organization_icon", () => {
  it("keeps an icon as the logo when there was no logo", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client, ["0000", "0001", "0002", "0003", "0004", "0005"]);
    await client.execute("UPDATE settings SET icon_blob = 'icon-sha' WHERE id = 1");

    await runMigrations(client, ["0006"]);

    const { rows } = await client.execute("SELECT * FROM settings");
    expect(rows[0]?.logo_blob).toBe("icon-sha");
    expect(rows[0]).not.toHaveProperty("icon_blob");
  });

  it("keeps an existing logo over the icon", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client, ["0000", "0001", "0002", "0003", "0004", "0005"]);
    await client.execute("UPDATE settings SET logo_blob = 'logo-sha', icon_blob = 'icon-sha'");

    await runMigrations(client, ["0006"]);

    const { rows } = await client.execute("SELECT logo_blob FROM settings");
    expect(rows[0]?.logo_blob).toBe("logo-sha");
  });
});

describe("0007_web_tabs", () => {
  it("turns each instance's map into its first web tab", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client, ["0000", "0001", "0002", "0003", "0004", "0005", "0006"]);
    await client.execute("INSERT INTO blobs (sha256, size) VALUES ('bg', 1)");
    for (const [id, map] of [
      ["with-map", "'https://map.example/t3'"],
      ["no-map", "NULL"],
    ]) {
      await client.execute(
        `INSERT INTO instances (id, name, background_blob, colors, map_url, mc_version, loader) VALUES ('${id}', 'x', 'bg', '{}', ${map}, '1.21.1', 'vanilla')`,
      );
    }

    await runMigrations(client, ["0007"]);

    const { rows } = await client.execute("SELECT id, tabs FROM instances ORDER BY id");
    expect(rows.map((row) => [row.id, JSON.parse(String(row.tabs))])).toEqual([
      ["no-map", []],
      [
        "with-map",
        [{ label: "Mapa", url: "https://map.example/t3", icon: "map", openIn: "launcher" }],
      ],
    ]);
    expect(rows[0]).not.toHaveProperty("map_url");
  });
});
