import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/platform/memory";
import { createLibsqlDatabase } from "../src/platform/node/libsql-database";
import type { Platform } from "../src/platform/types";

export function createTestPlatform(): Platform {
  return {
    db: createLibsqlDatabase(":memory:"),
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
