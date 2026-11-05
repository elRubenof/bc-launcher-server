import type { ApplyContent, InstanceContent } from "@bc-launcher-server/contracts";
import { type Database, schema } from "@bc-launcher-server/db";
import { and, asc, eq, exists, sql } from "drizzle-orm";
import type { InstanceRow } from "./instances";

export async function readContent(db: Database, instance: InstanceRow): Promise<InstanceContent> {
  const [files, dirs, updatedBy] = await Promise.all([
    readFiles(db, instance.id),
    db
      .select({ path: schema.instanceManagedDirs.path })
      .from(schema.instanceManagedDirs)
      .where(eq(schema.instanceManagedDirs.instanceId, instance.id))
      .orderBy(asc(schema.instanceManagedDirs.path)),
    instance.contentUpdatedBy
      ? db
          .select({ id: schema.admins.id, username: schema.admins.username })
          .from(schema.admins)
          .where(eq(schema.admins.id, instance.contentUpdatedBy))
      : Promise.resolve([]),
  ]);
  return {
    contentVersion: instance.contentVersion,
    minecraft: { version: instance.mcVersion },
    loader: { type: instance.loader, version: instance.loaderVersion },
    managedDirs: dirs.map((dir) => dir.path),
    files,
    updatedAt: instance.contentUpdatedAt?.toISOString() ?? null,
    updatedBy: updatedBy[0] ?? null,
  };
}

export function readFiles(db: Database, instanceId: string) {
  return db
    .select({
      path: schema.instanceFiles.path,
      sha256: schema.instanceFiles.blobSha256,
      size: schema.blobs.size,
      policy: schema.instanceFiles.policy,
    })
    .from(schema.instanceFiles)
    .innerJoin(schema.blobs, eq(schema.blobs.sha256, schema.instanceFiles.blobSha256))
    .where(eq(schema.instanceFiles.instanceId, instanceId))
    .orderBy(asc(schema.instanceFiles.path));
}

/**
 * Paths that can't live together on disk: duplicates (case-insensitively, for Windows and macOS),
 * a file where another file needs a folder, or a managed folder that is a file.
 * Returns a message, or `null` if there is no clash.
 */
export function pathConflict(change: Pick<ApplyContent, "files" | "managedDirs">): string | null {
  const files = new Map<string, string>();
  for (const file of change.files) {
    const key = file.path.toLowerCase();
    const other = files.get(key);
    if (other !== undefined) return `${file.path} and ${other} are the same file`;
    files.set(key, file.path);
  }
  for (const file of change.files) {
    const parts = file.path.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = files.get(parts.slice(0, i).join("/"));
      if (folder !== undefined) return `${folder} is a file, but ${file.path} needs it as a folder`;
    }
  }
  for (const dir of change.managedDirs) {
    const file = files.get(dir.toLowerCase());
    if (file !== undefined) return `${dir} is a file, so it can't be a managed folder`;
  }
  return null;
}

const CAP = 100;

/** What an applied change did to the files, for the audit log (lists capped at 100 paths). */
export function contentDiff(
  before: { path: string; sha256: string; policy: string }[],
  after: ApplyContent["files"],
) {
  const old = new Map(before.map((file) => [file.path, file]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const file of after) {
    const previous = old.get(file.path);
    if (!previous) added.push(file.path);
    else if (previous.sha256 !== file.sha256 || previous.policy !== file.policy) {
      changed.push(file.path);
    }
    old.delete(file.path);
  }
  const removed = [...old.keys()];
  return {
    added: added.slice(0, CAP),
    changed: changed.slice(0, CAP),
    removed: removed.slice(0, CAP),
    counts: { added: added.length, changed: changed.length, removed: removed.length },
  };
}

/**
 * The statements that replace an instance's content, for one `db.batch()`. Every statement only
 * acts while the instance is still at `expected`, and the last one bumps the version, so if
 * another change got in first the whole batch does nothing (the caller sees no row updated).
 * Lists go in as JSON (`json_each`): D1 allows only 100 bound parameters per statement.
 */
export function applyContentStatements(
  db: Database,
  instanceId: string,
  expected: number,
  change: ApplyContent,
  adminId: string,
  details: Record<string, unknown>,
) {
  const now = new Date();
  const atVersion = (version: number) =>
    exists(
      db
        .select({ id: schema.instances.id })
        .from(schema.instances)
        .where(
          and(eq(schema.instances.id, instanceId), eq(schema.instances.contentVersion, version)),
        ),
    );
  const stillExpected = atVersion(expected);
  const loaderVersion = change.loader === "vanilla" ? null : change.loaderVersion;

  return [
    db
      .delete(schema.instanceFiles)
      .where(and(eq(schema.instanceFiles.instanceId, instanceId), stillExpected)),
    db
      .delete(schema.instanceManagedDirs)
      .where(and(eq(schema.instanceManagedDirs.instanceId, instanceId), stillExpected)),
    db
      .insert(schema.instanceFiles)
      .select(
        sql`select ${instanceId}, json_extract(value, '$.path'), json_extract(value, '$.sha256'), json_extract(value, '$.policy') from json_each(${JSON.stringify(change.files)}) where ${stillExpected}`,
      ),
    db
      .insert(schema.instanceManagedDirs)
      .select(
        sql`select ${instanceId}, value from json_each(${JSON.stringify(change.managedDirs)}) where ${stillExpected}`,
      ),
    db
      .insert(schema.auditLog)
      .select(
        sql`select null, ${adminId}, 'instance.content_applied', ${instanceId}, ${JSON.stringify(details)}, ${now.getTime()} where ${stillExpected}`,
      ),
    db
      .update(schema.instances)
      .set({
        contentVersion: expected + 1,
        mcVersion: change.mcVersion,
        loader: change.loader,
        loaderVersion,
        contentUpdatedAt: now,
        contentUpdatedBy: adminId,
        updatedAt: now,
      })
      .where(
        and(eq(schema.instances.id, instanceId), eq(schema.instances.contentVersion, expected)),
      )
      .returning({ contentVersion: schema.instances.contentVersion }),
  ] as const;
}
