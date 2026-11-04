import { createApp } from "../src/app";
import { MemoryBlobStore } from "../src/platform/memory";
import { createLibsqlDatabase } from "../src/platform/node/libsql-database";
import { migrateLibsqlDatabase, SOURCE_MIGRATIONS_DIR } from "../src/platform/node/migrate";
import type { Platform } from "../src/platform/types";

/** A platform with a migrated in-memory database and in-memory blobs. */
export async function createTestPlatform(): Promise<Platform> {
  const db = createLibsqlDatabase(":memory:");
  await migrateLibsqlDatabase(db, SOURCE_MIGRATIONS_DIR);
  return {
    db,
    blobs: new MemoryBlobStore(),
    config: {
      publicUrl: "http://localhost:8787",
      sessionSecret: "test-session-secret",
      jwtSecret: "test-jwt-secret",
    },
  };
}

export async function createTestApp(platform?: Platform) {
  const resolved = platform ?? (await createTestPlatform());
  return createApp(() => resolved);
}
