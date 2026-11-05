import type { ApplyContent, FilePolicy, InstanceContent } from "@bc-launcher-server/contracts";
import type { VersionChoice } from "@/components/version-picker";

export interface DraftFile {
  path: string;
  sha256: string;
  size: number;
  policy: FilePolicy;
}

/**
 * The content as it will be once applied. The pending changes are its difference with the
 * server's content (`base`); nothing is sent until "Apply changes".
 */
export interface Draft {
  files: Map<string, DraftFile>;
  managedDirs: Set<string>;
  version: VersionChoice;
  /** Folders created in the panel that have no files yet (they don't exist on the server). */
  folders: Set<string>;
}

export function draftFrom(content: InstanceContent): Draft {
  return {
    files: new Map(content.files.map((file) => [file.path, { ...file }])),
    managedDirs: new Set(content.managedDirs),
    version: {
      mcVersion: content.minecraft.version,
      loader: content.loader.type,
      loaderVersion: content.loader.version,
    },
    folders: new Set(),
  };
}

export function cloneDraft(draft: Draft): Draft {
  return {
    files: new Map(draft.files),
    managedDirs: new Set(draft.managedDirs),
    version: { ...draft.version },
    folders: new Set(draft.folders),
  };
}

export type FileStatus = "unchanged" | "new" | "modified" | "deleted";

export interface Changes {
  added: DraftFile[];
  modified: DraftFile[];
  deleted: DraftFile[];
  dirsAdded: string[];
  dirsRemoved: string[];
  versionChanged: boolean;
  count: number;
}

const sameVersion = (a: VersionChoice, b: VersionChoice) =>
  a.mcVersion === b.mcVersion &&
  a.loader === b.loader &&
  (a.loader === "vanilla" || a.loaderVersion === b.loaderVersion);

export function fileStatus(base: Map<string, DraftFile>, file: DraftFile): FileStatus {
  const before = base.get(file.path);
  if (!before) return "new";
  return before.sha256 === file.sha256 && before.policy === file.policy ? "unchanged" : "modified";
}

export function changesOf(base: Draft, draft: Draft): Changes {
  const added: DraftFile[] = [];
  const modified: DraftFile[] = [];
  for (const file of draft.files.values()) {
    const status = fileStatus(base.files, file);
    if (status === "new") added.push(file);
    else if (status === "modified") modified.push(file);
  }
  const deleted = [...base.files.values()].filter((file) => !draft.files.has(file.path));
  const dirsAdded = [...draft.managedDirs].filter((dir) => !base.managedDirs.has(dir));
  const dirsRemoved = [...base.managedDirs].filter((dir) => !draft.managedDirs.has(dir));
  const versionChanged = !sameVersion(base.version, draft.version);
  const byPath = (a: DraftFile, b: DraftFile) => a.path.localeCompare(b.path);
  return {
    added: added.sort(byPath),
    modified: modified.sort(byPath),
    deleted: deleted.sort(byPath),
    dirsAdded,
    dirsRemoved,
    versionChanged,
    count:
      added.length +
      modified.length +
      deleted.length +
      dirsAdded.length +
      dirsRemoved.length +
      (versionChanged ? 1 : 0),
  };
}

/**
 * Replays the changes made on `oldBase` on top of `newBase` (after someone else applied a change).
 * Returns the new draft and the paths both sides touched, where ours won.
 */
export function rebase(oldBase: Draft, draft: Draft, newBase: Draft) {
  const next = cloneDraft(newBase);
  next.folders = new Set(draft.folders);
  const changes = changesOf(oldBase, draft);
  const conflicts: string[] = [];
  const touchedByThem = (path: string) => {
    const before = oldBase.files.get(path);
    const after = newBase.files.get(path);
    return before?.sha256 !== after?.sha256 || before?.policy !== after?.policy;
  };
  for (const file of [...changes.added, ...changes.modified]) {
    if (touchedByThem(file.path)) conflicts.push(file.path);
    next.files.set(file.path, file);
  }
  for (const file of changes.deleted) {
    if (touchedByThem(file.path)) conflicts.push(file.path);
    next.files.delete(file.path);
  }
  for (const dir of changes.dirsAdded) next.managedDirs.add(dir);
  for (const dir of changes.dirsRemoved) next.managedDirs.delete(dir);
  if (changes.versionChanged) next.version = { ...draft.version };
  return { draft: next, conflicts: conflicts.sort() };
}

export function toApply(draft: Draft, expectedContentVersion: number): ApplyContent {
  return {
    expectedContentVersion,
    mcVersion: draft.version.mcVersion,
    loader: draft.version.loader,
    loaderVersion: draft.version.loader === "vanilla" ? null : draft.version.loaderVersion,
    managedDirs: [...draft.managedDirs].sort(),
    files: [...draft.files.values()].map(({ path, sha256, policy }) => ({ path, sha256, policy })),
  };
}

/** Every folder in the draft: parents of files, managed folders and folders made in the panel. */
export function allFolders(draft: Draft, extra: Iterable<string> = []): Set<string> {
  const folders = new Set<string>();
  const addParents = (path: string, includeSelf: boolean) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length + (includeSelf ? 1 : 0); i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  };
  for (const path of draft.files.keys()) addParents(path, false);
  for (const path of extra) addParents(path, false);
  for (const dir of [...draft.managedDirs, ...draft.folders]) addParents(dir, true);
  return folders;
}

export const inFolder = (path: string, folder: string) =>
  folder === "" || path.startsWith(`${folder}/`);

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  kind: "dir" | "file";
  file?: DraftFile;
  status?: FileStatus;
}

/** The tree of the resulting content (with deleted files), as rows in display order. */
export function treeRows(base: Draft, draft: Draft, collapsed: Set<string>): TreeRow[] {
  const deleted = [...base.files.values()].filter((file) => !draft.files.has(file.path));
  const folders = allFolders(
    draft,
    deleted.map((file) => file.path),
  );
  const children = new Map<string, { dirs: string[]; files: DraftFile[] }>();
  const entry = (parent: string) => {
    let value = children.get(parent);
    if (!value) {
      value = { dirs: [], files: [] };
      children.set(parent, value);
    }
    return value;
  };
  const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
  for (const folder of folders) entry(parentOf(folder)).dirs.push(folder);
  for (const file of [...draft.files.values(), ...deleted])
    entry(parentOf(file.path)).files.push(file);

  const rows: TreeRow[] = [];
  const walk = (parent: string, depth: number) => {
    const node = children.get(parent);
    if (!node) return;
    for (const dir of node.dirs.sort((a, b) => a.localeCompare(b))) {
      rows.push({ path: dir, name: dir.split("/").at(-1) ?? dir, depth, kind: "dir" });
      if (!collapsed.has(dir)) walk(dir, depth + 1);
    }
    for (const file of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
      const status = draft.files.has(file.path) ? fileStatus(base.files, file) : "deleted";
      rows.push({
        path: file.path,
        name: file.path.split("/").at(-1) ?? file.path,
        depth,
        kind: "file",
        file,
        status,
      });
    }
  };
  walk("", 0);
  return rows;
}
