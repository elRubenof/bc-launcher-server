import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/platform/config";

const env = {
  PUBLIC_URL: "https://launcher.example.com/",
  SESSION_SECRET: "session",
  JWT_SECRET: "jwt",
};

describe("loadConfig", () => {
  it("reads the config and normalizes the public URL", () => {
    expect(loadConfig(env)).toEqual({
      publicUrl: "https://launcher.example.com",
      sessionSecret: "session",
      jwtSecret: "jwt",
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

  it("rejects an invalid public URL", () => {
    expect(() => loadConfig({ ...env, PUBLIC_URL: "not a url" })).toThrow();
  });
});
