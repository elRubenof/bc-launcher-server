import { assertSha256 } from "../sha256";
import type { BlobStore } from "../types";

/** Stores blobs in R2 keyed by their sha256. */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async head(sha256: string) {
    assertSha256(sha256);
    const object = await this.bucket.head(sha256);
    return object ? { size: object.size } : null;
  }

  async get(sha256: string) {
    assertSha256(sha256);
    const object = await this.bucket.get(sha256);
    return object ? { body: object.body, size: object.size } : null;
  }

  async put(sha256: string, body: ReadableStream<Uint8Array>, size: number) {
    assertSha256(sha256);
    // R2 needs a known length to stream; FixedLengthStream also fails if the body doesn't match.
    await this.bucket.put(sha256, body.pipeThrough(new FixedLengthStream(size)));
  }

  async delete(sha256: string) {
    assertSha256(sha256);
    await this.bucket.delete(sha256);
  }
}
