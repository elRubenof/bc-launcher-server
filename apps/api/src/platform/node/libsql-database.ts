import { type Database, schema } from "@bc-launcher-server/db";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/** Opens a libSQL database: `file:/data/db.sqlite` in Docker, `:memory:` in tests. */
export function createLibsqlDatabase(url: string): Database {
  return drizzle(createClient({ url }), { schema });
}
