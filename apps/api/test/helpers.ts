import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/platform/memory";
import type { Platform } from "../src/platform/types";

export function createTestPlatform(): Platform {
  return {
    blobs: new MemoryBlobStore(),
    config: {
      publicUrl: "http://localhost:8787",
      sessionSecret: "test-session-secret",
      jwtSecret: "test-jwt-secret",
    },
  };
}

export function createTestApp(platform = createTestPlatform()) {
  return createApp(() => platform);
}
