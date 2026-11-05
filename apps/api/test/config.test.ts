import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/platform/config";

const env = {
  PUBLIC_URL: "https://launcher.example.com/",
  SESSION_SECRET: "s".repeat(32),
  JWT_SECRET: "j".repeat(32),
};

describe("loadConfig", () => {
  it("reads the config and normalizes the public URL", () => {
    expect(loadConfig(env)).toEqual({
      publicUrl: "https://launcher.example.com",
      sessionSecret: env.SESSION_SECRET,
      jwtSecret: env.JWT_SECRET,
    });
  });

  it("keeps a base path without the trailing slash", () => {
    expect(loadConfig({ ...env, PUBLIC_URL: "https://example.com/bc/" }).publicUrl).toBe(
      "https://example.com/bc",
    );
  });

  it("lists every missing variable", () => {
    expect(() => loadConfig({ PUBLIC_URL: env.PUBLIC_URL })).toThrow(
      "Missing required environment variables: SESSION_SECRET, JWT_SECRET",
    );
  });

  it("falls back to the default URL only without PUBLIC_URL", () => {
    const { PUBLIC_URL: _, ...secrets } = env;
    expect(loadConfig(secrets, "https://bc.example.workers.dev").publicUrl).toBe(
      "https://bc.example.workers.dev",
    );
    expect(loadConfig(env, "https://bc.example.workers.dev").publicUrl).toBe(
      "https://launcher.example.com",
    );
  });

  it("refuses short secrets", () => {
    expect(() => loadConfig({ ...env, SESSION_SECRET: "change-me" })).toThrow(
      "SESSION_SECRET must be at least 32 characters",
    );
  });

  it("rejects an invalid public URL", () => {
    expect(() => loadConfig({ ...env, PUBLIC_URL: "not a url" })).toThrow();
  });
});
