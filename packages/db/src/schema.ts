import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** The organization's identity. A single row (`id = 1`), created by the first migration. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** sha256 of the logo in `blobs`. */
    logoBlob: text("logo_blob"),
    /** sha256 of the icon in `blobs`. */
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
    role: text("role", { enum: ["owner", "admin", "editor"] }).notNull(),
    /** Last sign-in or session use; `null` if the admin never signed in. */
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().default(now),
    updatedAt: timestamp("updated_at").notNull().default(now),
  },
  // There is exactly one owner: the one who set the server up.
  (table) => [uniqueIndex("admins_single_owner").on(table.role).where(sql`role = 'owner'`)],
);

/**
 * A single row once setup is done. Setup inserts it in the same batch as the first owner, so a
 * second setup fails on the primary key and the whole batch rolls back.
 */
export const setupLock = sqliteTable(
  "setup_lock",
  {
    id: integer("id").primaryKey(),
    completedAt: timestamp("completed_at").notNull().default(now),
  },
  (table) => [check("setup_lock_single_row", sql`${table.id} = 1`)],
);

/**
 * Every file in the BlobStore, keyed by its sha256 (content-addressed: stored once, never
 * overwritten). Instance files, the organization's logo and icon, and instance icons and
 * backgrounds all point here.
 */
export const blobs = sqliteTable("blobs", {
  sha256: text("sha256").primaryKey(),
  size: integer("size").notNull(),
  /** The image type for blobs served as public images (`/api/v1/assets`); null for content files. */
  contentType: text("content_type"),
  createdAt: timestamp("created_at").notNull().default(now),
  /**
   * When the cleanup first found the blob unreferenced; null while something references it. A blob
   * that stays unreferenced for 24 h is deleted.
   */
  orphanedAt: timestamp("orphaned_at"),
});

export type InstanceColors = {
  primary: string;
  primaryDark: string;
  background: string;
  text: string;
};

/** A series, event or server: what players see and play in the launcher. */
export const instances = sqliteTable(
  "instances",
  {
    /** Readable and immutable (`serie-t3`): used in URLs and as the launcher's local folder. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    iconBlob: text("icon_blob").references(() => blobs.sha256),
    /** Never empty: new instances get BC Launcher's default background. */
    backgroundBlob: text("background_blob")
      .notNull()
      .references(() => blobs.sha256),
    colors: text("colors", { mode: "json" }).$type<InstanceColors>().notNull(),
    mapUrl: text("map_url"),
    /** Own links; when null the API falls back to the organization's. */
    discordUrl: text("discord_url"),
    webUrl: text("web_url"),
    mcVersion: text("mc_version").notNull(),
    loader: text("loader", { enum: ["vanilla", "fabric", "quilt", "forge", "neoforge"] }).notNull(),
    /** Null for vanilla. */
    loaderVersion: text("loader_version"),
    /** `host` or `host:port`, for auto-connect. */
    serverAddress: text("server_address"),
    recommendedRamMb: integer("recommended_ram_mb"),
    access: text("access", { enum: ["everyone", "whitelist"] })
      .notNull()
      .default("everyone"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /** +1 on every applied content change; 0 = no content yet (hidden in the launcher). */
    contentVersion: integer("content_version").notNull().default(0),
    contentUpdatedAt: timestamp("content_updated_at"),
    contentUpdatedBy: text("content_updated_by").references(() => admins.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().default(now),
    updatedAt: timestamp("updated_at").notNull().default(now),
  },
  (table) => [index("instances_created_at").on(table.createdAt)],
);

/** The files of an instance's current content. */
export const instanceFiles = sqliteTable(
  "instance_files",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    /** Relative posix path inside the instance folder (`mods/sodium.jar`). */
    path: text("path").notNull(),
    blobSha256: text("blob_sha256")
      .notNull()
      .references(() => blobs.sha256),
    /** `always`: the server's copy wins on every launch. `once`: copied only if missing. */
    policy: text("policy", { enum: ["always", "once"] })
      .notNull()
      .default("always"),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.path] }),
    index("instance_files_blob").on(table.blobSha256),
  ],
);

/** Folders where the launcher deletes anything that isn't in the manifest (`mods`). */
export const instanceManagedDirs = sqliteTable(
  "instance_managed_dirs",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.path] })],
);

/**
 * Minecraft players: everyone who signed in with the launcher, plus those added to a list by name
 * before ever joining (`first_seen_at` null).
 */
export const players = sqliteTable(
  "players",
  {
    /** Mojang profile id, lowercase with dashes. */
    uuid: text("uuid").primaryKey(),
    /** Last known Minecraft name (names can change; updated on every sign-in and lookup). */
    name: text("name").notNull(),
    firstSeenAt: timestamp("first_seen_at"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().default(now),
  },
  (table) => [index("players_last_seen_at").on(table.lastSeenAt)],
);

const listedPlayer = () =>
  text("player_uuid")
    .notNull()
    .references(() => players.uuid);
const addedBy = () => text("created_by").references(() => admins.id, { onDelete: "set null" });

/** Members of a private organization. Ignored while the organization is public. */
export const orgWhitelist = sqliteTable("org_whitelist", {
  playerUuid: listedPlayer().primaryKey(),
  createdBy: addedBy(),
  createdAt: timestamp("created_at").notNull().default(now),
});

/** Who can play an instance whose `access` is `whitelist`. */
export const instanceWhitelist = sqliteTable(
  "instance_whitelist",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    playerUuid: listedPlayer(),
    createdBy: addedBy(),
    createdAt: timestamp("created_at").notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.playerUuid] }),
    index("instance_whitelist_player").on(table.playerUuid),
  ],
);

/** Players banned from the whole organization. Always wins over visibility and whitelists. */
export const orgBlacklist = sqliteTable("org_blacklist", {
  playerUuid: listedPlayer().primaryKey(),
  /** Only admins see it. */
  reason: text("reason"),
  /** Null = permanent. A ban whose expiry has passed no longer counts. */
  expiresAt: timestamp("expires_at"),
  createdBy: addedBy(),
  createdAt: timestamp("created_at").notNull().default(now),
});

/** Players banned from one instance: it is invisible to them. */
export const instanceBlacklist = sqliteTable(
  "instance_blacklist",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    playerUuid: listedPlayer(),
    reason: text("reason"),
    expiresAt: timestamp("expires_at"),
    createdBy: addedBy(),
    createdAt: timestamp("created_at").notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.playerUuid] }),
    index("instance_blacklist_player").on(table.playerUuid),
  ],
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
