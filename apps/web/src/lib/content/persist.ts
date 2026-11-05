import type { InstanceContent } from "@bc-launcher-server/contracts";
import type { Draft, DraftFile } from "./draft";

/**
 * Pending content changes, kept in IndexedDB per admin and instance so they survive closing the
 * panel. Only paths and hashes are kept, not the files: the ones that weren't uploaded yet must be
 * imported again (the browser loses access to them).
 */
export interface SavedDraft {
  /** The server's content the changes were made on, to replay them if it changed since. */
  base: InstanceContent;
  draft: {
    files: DraftFile[];
    managedDirs: string[];
    version: Draft["version"];
    folders: string[];
  };
  savedAt: number;
}

const DB_NAME = "bcls";
const STORE = "content-drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const draftKey = (adminId: string, instanceId: string) => `${adminId}:${instanceId}`;

export function serializeDraft(base: InstanceContent, draft: Draft): SavedDraft {
  return {
    base,
    draft: {
      files: [...draft.files.values()],
      managedDirs: [...draft.managedDirs],
      version: draft.version,
      folders: [...draft.folders],
    },
    savedAt: Date.now(),
  };
}

export function deserializeDraft(saved: SavedDraft): Draft {
  return {
    files: new Map(saved.draft.files.map((file) => [file.path, file])),
    managedDirs: new Set(saved.draft.managedDirs),
    version: saved.draft.version,
    folders: new Set(saved.draft.folders),
  };
}

// Storage can be unavailable (private mode, blocked site data): the editor then works without it.
export async function loadDraft(key: string): Promise<SavedDraft | null> {
  try {
    return ((await run("readonly", (store) => store.get(key))) as SavedDraft | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(key: string, value: SavedDraft) {
  try {
    await run("readwrite", (store) => store.put(value, key));
  } catch {
    // Not kept; the changes still work for this visit.
  }
}

export async function deleteDraft(key: string) {
  try {
    await run("readwrite", (store) => store.delete(key));
  } catch {
    // Nothing to do.
  }
}
