const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256(value: string): boolean {
  return SHA256_HEX.test(value);
}

/** Blob keys end up in file paths and URLs, so anything else is rejected. */
export function assertSha256(value: string): void {
  if (!isSha256(value)) throw new Error(`Invalid sha256: ${JSON.stringify(value)}`);
}

/** A blob's bytes don't match its key (sha256) or its declared size. Nothing was stored. */
export class BlobMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobMismatchError";
  }
}
