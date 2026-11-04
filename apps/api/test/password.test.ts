import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");

    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct horsE", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$1$a$b")).toBe(false);
  });
});
