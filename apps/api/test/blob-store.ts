import { describe, expect, it } from "vitest";
import type { BlobStore } from "../src/platform/types";

const toStream = (text: string) => new Blob([text]).stream();

/** Behavior every `BlobStore` adapter must satisfy. */
export function describeBlobStore(name: string, create: () => BlobStore | Promise<BlobStore>) {
  describe(`BlobStore: ${name}`, () => {
    it("returns null for a missing blob", async () => {
      const store = await create();

      expect(await store.head("missing")).toBeNull();
      expect(await store.get("missing")).toBeNull();
    });

    it("stores and reads a blob", async () => {
      const store = await create();
      await store.put("abc", toStream("hello"), 5);

      expect(await store.head("abc")).toEqual({ size: 5 });
      const blob = await store.get("abc");
      expect(blob?.size).toBe(5);
      expect(await new Response(blob?.body).text()).toBe("hello");
    });

    it("rejects a body whose size doesn't match", async () => {
      const store = await create();

      await expect(store.put("abc", toStream("hello"), 4)).rejects.toThrow();
      expect(await store.head("abc")).toBeNull();
    });

    it("deletes a blob, and deleting a missing one is a no-op", async () => {
      const store = await create();
      await store.put("abc", toStream("hello"), 5);

      await store.delete("abc");
      await store.delete("abc");

      expect(await store.head("abc")).toBeNull();
    });
  });
}
