import { instancePathError } from "@bc-launcher-server/contracts/paths";
import { Unzip, UnzipInflate } from "fflate";

/** Mirrors the API's per-file limit (Workers refuse bodies over 100 MB). */
export const MAX_FILE_BYTES = 100_000_000;

/** Folders the launcher fills itself, and player data that isn't shared. */
const DISCARDED_DIRS = new Set([
  "versions",
  "libraries",
  "assets",
  "saves",
  "logs",
  "crash-reports",
  "screenshots",
]);
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

export interface ImportEntry {
  /** Relative to the import's root, posix. */
  path: string;
  blob: Blob;
}

export interface HashedEntry extends ImportEntry {
  sha256: string;
  size: number;
}

export type DiscardReason = "launcher" | "junk" | "tooLarge" | "invalid";

export interface Discarded {
  path: string;
  reason: DiscardReason;
}

/** Why a file is left out of an import, or `null` to keep it. Checked before reading it. */
function discardReason(path: string, size: number): DiscardReason | null {
  const parts = path.split("/");
  if (parts.some((part) => JUNK.test(part) || part === "__MACOSX")) return "junk";
  if (parts.length > 1 && DISCARDED_DIRS.has((parts[0] as string).toLowerCase())) return "launcher";
  if (size > MAX_FILE_BYTES) return "tooLarge";
  return null;
}

/** Drops a top folder shared by every entry ("SerieT3/mods/a.jar" → "mods/a.jar"). */
function stripCommonRoot<T extends { path: string }>(entries: T[]): T[] {
  const first = entries[0]?.path.split("/")[0];
  if (!first || !entries.every((entry) => entry.path.startsWith(`${first}/`))) return entries;
  return entries.map((entry) => ({ ...entry, path: entry.path.slice(first.length + 1) }));
}

export interface Collected {
  entries: ImportEntry[];
  discarded: Discarded[];
  /** The name to show: the folder or zip's name, or the number of files. */
  name: string;
}

function split(raw: { path: string; blob: Blob; size: number }[], name: string): Collected {
  const entries: ImportEntry[] = [];
  const discarded: Discarded[] = [];
  for (const item of stripCommonRoot(raw)) {
    const reason = discardReason(item.path, item.size);
    if (reason) discarded.push({ path: item.path, reason });
    else entries.push({ path: item.path, blob: item.blob });
  }
  return { entries, discarded, name };
}

/** Files from an `<input type="file">`, with or without `webkitdirectory`. */
export function fromFileList(files: FileList | File[]): Collected {
  const list = [...files];
  const raw = list.map((file) => ({
    path: file.webkitRelativePath || file.name,
    blob: file,
    size: file.size,
  }));
  const folder = list[0]?.webkitRelativePath.split("/")[0];
  return split(raw, folder || String(list.length));
}

/** Unzips in the browser, streaming; entries that will be discarded are never inflated. */
export async function fromZip(file: File): Promise<Collected> {
  const raw: { path: string; blob: Blob; size: number }[] = [];
  const skipped: { path: string; size: number }[] = [];
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  let failure: unknown = null;
  unzip.onfile = (entry) => {
    if (entry.name.endsWith("/")) return;
    const size = entry.originalSize ?? 0;
    const path = entry.name.replaceAll("\\", "/");
    // Junk and oversized files are reported but not read.
    if (discardReason(path, size) === "junk" || size > MAX_FILE_BYTES) {
      skipped.push({ path, size });
      return;
    }
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    entry.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      chunks.push(data.slice());
      if (final)
        raw.push({
          path,
          blob: new Blob(chunks),
          size: chunks.reduce((n, c) => n + c.byteLength, 0),
        });
    };
    entry.start();
  };
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    unzip.push(value);
    if (failure) throw failure;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  const collected = split(
    [...raw, ...skipped.map((item) => ({ ...item, blob: new Blob([]) }))],
    file.name.replace(/\.zip$/i, ""),
  );
  return collected;
}

/** Files and folders dropped on the page. */
export async function fromDrop(dataTransfer: DataTransfer): Promise<Collected> {
  const roots = [...dataTransfer.items]
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  // Without the entries API (or with synthetic drops) only plain files are available.
  if (roots.length === 0) return fromFileList(dataTransfer.files);
  // A single dropped zip is imported like "Import zip".
  const onlyFile = roots.length === 1 && roots[0]?.isFile ? dataTransfer.files[0] : undefined;
  if (onlyFile && /\.zip$/i.test(onlyFile.name)) return fromZip(onlyFile);

  const raw: { path: string; blob: Blob; size: number }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      raw.push({ path, blob: file, size: file.size });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns the folder in batches until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path);
    }
  };
  for (const root of roots) await walk(root, "");
  const name = roots.length === 1 && roots[0]?.isDirectory ? roots[0].name : String(raw.length);
  // A single dropped folder is its own root, like "Import folder".
  return split(raw, name);
}

/** Puts the entries under `folder` and validates the final paths. */
export function placeEntries(collected: Collected, folder: string) {
  const entries: ImportEntry[] = [];
  const discarded = [...collected.discarded];
  for (const entry of collected.entries) {
    const path = folder ? `${folder}/${entry.path}` : entry.path;
    if (instancePathError(path)) discarded.push({ path: entry.path, reason: "invalid" });
    else entries.push({ path, blob: entry.blob });
  }
  return { entries, discarded };
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hashes every entry in the browser (WebCrypto), one at a time to keep memory flat. */
export async function hashEntries(
  entries: ImportEntry[],
  onProgress: (done: number, total: number) => void,
): Promise<HashedEntry[]> {
  const hashed: HashedEntry[] = [];
  for (const [index, entry] of entries.entries()) {
    hashed.push({ ...entry, sha256: await sha256Hex(entry.blob), size: entry.blob.size });
    onProgress(index + 1, entries.length);
  }
  return hashed;
}
