import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FsBlobStore } from "../src/platform/node/fs-blob-store";
import { describeBlobStore } from "./blob-store";

const roots: string[] = [];

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "bcls-blobs-"));
  roots.push(root);
  return { root, store: new FsBlobStore(root) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describeBlobStore("filesystem", async () => (await createStore()).store);

it("FsBlobStore leaves no partial file when a write fails", async () => {
  const { root, store } = await createStore();
  const sha = "b".repeat(64);

  await expect(store.put(sha, new Blob(["hello"]).stream(), 99)).rejects.toThrow();

  expect(await readdir(join(root, "bb"))).toEqual([]);
});
