import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

export { schema };
export type Schema = typeof schema;

/**
 * Drizzle database shared by both runtimes: D1 on Workers, libSQL (a local SQLite file) on Node.
 * Both are async and support `batch()`, the only way to write atomically on D1.
 */
export type Database = BaseSQLiteDatabase<"async", unknown, Schema> &
  Pick<LibSQLDatabase<Schema>, "batch">;
