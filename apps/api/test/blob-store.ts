import { describe, expect, it } from "vitest";
import { BlobMismatchError } from "../src/platform/sha256";
import type { BlobStore } from "../src/platform/types";

const toStream = (text: string) => new Blob([text]).stream();
/** sha256("hello"). */
const SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

/** Behavior every `BlobStore` adapter must satisfy. */
export function describeBlobStore(name: string, create: () => BlobStore | Promise<BlobStore>) {
  describe(`BlobStore: ${name}`, () => {
    it("returns null for a missing blob", async () => {
      const store = await create();

      expect(await store.head(SHA)).toBeNull();
      expect(await store.get(SHA)).toBeNull();
    });

    it("stores and reads a blob", async () => {
      const store = await create();
      await store.put(SHA, toStream("hello"), 5);

      expect(await store.head(SHA)).toEqual({ size: 5 });
      const blob = await store.get(SHA);
      expect(blob?.size).toBe(5);
      expect(await new Response(blob?.body).text()).toBe("hello");
    });

    it("overwrites a blob with the same key", async () => {
      const store = await create();
      await store.put(SHA, toStream("hello"), 5);
      await store.put(SHA, toStream("hello"), 5);

      expect(await store.head(SHA)).toEqual({ size: 5 });
    });

    it("rejects a body whose size doesn't match", async () => {
      const store = await create();

      await expect(store.put(SHA, toStream("hello"), 4)).rejects.toThrow(BlobMismatchError);
      expect(await store.head(SHA)).toBeNull();
    });

    it("rejects a body that doesn't hash to its key, keeping what was there", async () => {
      const store = await create();

      await expect(store.put(SHA, toStream("HELLO"), 5)).rejects.toThrow(BlobMismatchError);
      expect(await store.head(SHA)).toBeNull();

      await store.put(SHA, toStream("hello"), 5);
      await expect(store.put(SHA, toStream("HELLO"), 5)).rejects.toThrow(BlobMismatchError);
      expect(await new Response((await store.get(SHA))?.body).text()).toBe("hello");
    });

    it("deletes a blob, and deleting a missing one is a no-op", async () => {
      const store = await create();
      await store.put(SHA, toStream("hello"), 5);

      await store.delete(SHA);
      await store.delete(SHA);

      expect(await store.head(SHA)).toBeNull();
    });

    it("rejects keys that aren't a sha256", async () => {
      const store = await create();

      for (const key of ["../etc/passwd", "ABC", "a".repeat(63), `${"a".repeat(63)}/`]) {
        await expect(store.head(key)).rejects.toThrow("Invalid sha256");
      }
    });
  });
}
