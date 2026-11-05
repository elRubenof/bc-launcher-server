import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { assertSha256, BlobMismatchError } from "../sha256";
import type { BlobStore } from "../types";

/** Stores blobs as `<root>/<sha256[0..2]>/<sha256>`. */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  #path(sha256: string) {
    assertSha256(sha256);
    return join(this.root, sha256.slice(0, 2), sha256);
  }

  async head(sha256: string) {
    const info = await statFile(this.#path(sha256));
    return info ? { size: info.size } : null;
  }

  async get(sha256: string) {
    const path = this.#path(sha256);
    const info = await statFile(path);
    if (!info) return null;
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return { body, size: info.size };
  }

  async put(sha256: string, body: ReadableStream<Uint8Array>, size: number) {
    const path = this.#path(sha256);
    const partPath = `${path}.${randomUUID()}.part`;
    await mkdir(join(this.root, sha256.slice(0, 2)), { recursive: true });

    let written = 0;
    const hash = createHash("sha256");
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.byteLength;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
        counter,
        createWriteStream(partPath),
      );
      if (written !== size) {
        throw new BlobMismatchError(`Blob ${sha256} has ${written} bytes, expected ${size}`);
      }
      if (hash.digest("hex") !== sha256) {
        throw new BlobMismatchError(`Blob ${sha256} doesn't match its hash`);
      }
      // Rename is atomic, so readers never see a partial blob.
      await rename(partPath, path);
    } catch (error) {
      await rm(partPath, { force: true });
      throw error;
    }
  }

  async delete(sha256: string) {
    await rm(this.#path(sha256), { force: true });
  }
}

async function statFile(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
