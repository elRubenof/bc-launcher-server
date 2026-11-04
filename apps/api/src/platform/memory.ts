import type { BlobStore } from "./types";

/** In-memory `BlobStore` for tests. */
export class MemoryBlobStore implements BlobStore {
  readonly #blobs = new Map<string, Uint8Array<ArrayBuffer>>();

  async head(sha256: string) {
    const data = this.#blobs.get(sha256);
    return data ? { size: data.byteLength } : null;
  }

  async get(sha256: string) {
    const data = this.#blobs.get(sha256);
    if (!data) return null;
    return { body: new Blob([data]).stream(), size: data.byteLength };
  }

  async put(sha256: string, body: ReadableStream<Uint8Array>, size: number) {
    const data = new Uint8Array(await new Response(body).arrayBuffer());
    if (data.byteLength !== size) {
      throw new Error(`Blob ${sha256} has ${data.byteLength} bytes, expected ${size}`);
    }
    this.#blobs.set(sha256, data);
  }

  async delete(sha256: string) {
    this.#blobs.delete(sha256);
  }
}
