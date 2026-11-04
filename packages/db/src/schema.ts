import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** The organization's identity. A single row (`id = 1`), created by the first migration. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    logoBlob: text("logo_blob"),
    iconBlob: text("icon_blob"),
    discordUrl: text("discord_url"),
    webUrl: text("web_url"),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    minLauncherVersion: text("min_launcher_version"),
    updatedAt: timestamp("updated_at").notNull().default(now),
  },
  (table) => [check("settings_single_row", sql`${table.id} = 1`)],
);

export const admins = sqliteTable(
  "admins",
  {
    id: text("id").primaryKey(),
    /** Stored lowercase; unique. */
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "editor"] }).notNull(),
    createdAt: timestamp("created_at").notNull().default(now),
    updatedAt: timestamp("updated_at").notNull().default(now),
  },
  // There is exactly one owner. This also makes setup atomic: of two simultaneous setups,
  // only one owner insert can succeed.
  (table) => [uniqueIndex("admins_single_owner").on(table.role).where(sql`role = 'owner'`)],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    /** sha256 of the session token; the token itself is only in the cookie. */
    id: text("id").primaryKey(),
    adminId: text("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    lastUsedAt: timestamp("last_used_at").notNull().default(now),
    createdAt: timestamp("created_at").notNull().default(now),
  },
  (table) => [index("admin_sessions_admin_id").on(table.adminId)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    adminId: text("admin_id").references(() => admins.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    details: text("details", { mode: "json" }),
    createdAt: timestamp("created_at").notNull().default(now),
  },
  (table) => [index("audit_log_created_at").on(table.createdAt)],
);
