import { schema } from "@bc-launcher-server/db";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveConfig } from "../src/platform/config";
import { getOrCreateSecret } from "../src/platform/secrets";
import { createTestPlatform } from "./helpers";

const env = {
  PUBLIC_URL: "https://launcher.example.com/",
  JWT_SECRET: "j".repeat(32),
};

describe("loadConfig", () => {
  it("reads the config and normalizes the public URL", () => {
    expect(loadConfig(env)).toEqual({
      publicUrl: "https://launcher.example.com",
      jwtSecret: env.JWT_SECRET,
    });
  });

  it("keeps a base path without the trailing slash", () => {
    expect(loadConfig({ ...env, PUBLIC_URL: "https://example.com/bc/" }).publicUrl).toBe(
      "https://example.com/bc",
    );
  });

  it("requires a public URL", () => {
    expect(() => loadConfig({ JWT_SECRET: env.JWT_SECRET })).toThrow(
      "Missing required environment variables: PUBLIC_URL",
    );
  });

  it("falls back to the default URL only without PUBLIC_URL", () => {
    expect(loadConfig({}, "https://bc.example.workers.dev").publicUrl).toBe(
      "https://bc.example.workers.dev",
    );
    expect(loadConfig(env, "https://bc.example.workers.dev").publicUrl).toBe(
      "https://launcher.example.com",
    );
  });

  it("leaves JWT_SECRET to the database when unset or empty", () => {
    expect(loadConfig({ PUBLIC_URL: env.PUBLIC_URL }).jwtSecret).toBeUndefined();
    expect(loadConfig({ ...env, JWT_SECRET: "" }).jwtSecret).toBeUndefined();
  });

  it("refuses a short JWT secret", () => {
    expect(() => loadConfig({ ...env, JWT_SECRET: "change-me" })).toThrow(
      "JWT_SECRET must be at least 32 characters",
    );
  });

  it("rejects an invalid public URL", () => {
    expect(() => loadConfig({ ...env, PUBLIC_URL: "not a url" })).toThrow();
  });
});

describe("resolveConfig", () => {
  it("prefers JWT_SECRET from the environment and stores nothing", async () => {
    const { db } = await createTestPlatform();

    const config = await resolveConfig(loadConfig(env), db);

    expect(config.jwtSecret).toBe(env.JWT_SECRET);
    expect(await db.select().from(schema.serverSecrets)).toHaveLength(0);
  });

  it("generates the secret once and keeps it", async () => {
    const { db } = await createTestPlatform();
    const envConfig = loadConfig({ PUBLIC_URL: env.PUBLIC_URL });

    const first = await resolveConfig(envConfig, db);
    const second = await resolveConfig(envConfig, db);

    expect(first.jwtSecret).toMatch(/^[\w-]{43}$/);
    expect(second.jwtSecret).toBe(first.jwtSecret);
    expect(await db.select().from(schema.serverSecrets)).toMatchObject([
      { name: "jwt", value: first.jwtSecret },
    ]);
  });
});

describe("getOrCreateSecret", () => {
  it("gives concurrent first calls the same secret", async () => {
    const { db } = await createTestPlatform();

    const values = await Promise.all(Array.from({ length: 5 }, () => getOrCreateSecret(db, "jwt")));

    expect(new Set(values).size).toBe(1);
  });

  it("keeps each secret apart", async () => {
    const { db } = await createTestPlatform();

    expect(await getOrCreateSecret(db, "a")).not.toBe(await getOrCreateSecret(db, "b"));
  });
});
