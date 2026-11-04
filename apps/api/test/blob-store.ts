import { describe, expect, it } from "vitest";
import type { BlobStore } from "../src/platform/types";

const toStream = (text: string) => new Blob([text]).stream();
const SHA = "a".repeat(64);

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

      await expect(store.put(SHA, toStream("hello"), 4)).rejects.toThrow();
      expect(await store.head(SHA)).toBeNull();
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
