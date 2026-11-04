import { fileURLToPath } from "node:url";
import type { Database } from "@bc-launcher-server/db";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/** `packages/db/migrations` when running from source. The bundled server sets `MIGRATIONS_DIR`. */
export const SOURCE_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../../packages/db/migrations", import.meta.url),
);

/** Applies pending migrations (Cloudflare uses `wrangler d1 migrations apply` instead). */
export async function migrateLibsqlDatabase(db: Database, migrationsFolder: string) {
  await migrate(db as unknown as LibSQLDatabase, { migrationsFolder });
}
