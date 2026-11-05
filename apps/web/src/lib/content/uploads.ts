import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/queries";

const CONCURRENCY = 3;

export type UploadStatus = "checking" | "queued" | "uploading" | "done" | "error";

export interface Upload {
  sha256: string;
  blob: Blob;
  size: number;
  status: UploadStatus;
  loaded: number;
}

/** PUT /api/admin/blobs/:sha256 with progress (fetch can't report upload progress). */
function putBlob(upload: Upload, onProgress: (loaded: number) => void) {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", `/api/admin/blobs/${upload.sha256}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new Error("Aborted"));
    xhr.send(upload.blob);
  });
  return { done, abort: () => xhr.abort() };
}

/**
 * Uploads files in the background as soon as they're imported: asks the server which hashes it
 * lacks (`blobs/check`), then uploads those, three at a time. Files the server has are done.
 */
export function useUploads() {
  const [uploads, setUploads] = useState<Map<string, Upload>>(new Map());
  const running = useRef(new Map<string, () => void>());

  const patch = useCallback((sha256: string, change: Partial<Upload>) => {
    setUploads((current) => {
      const upload = current.get(sha256);
      if (!upload) return current;
      return new Map(current).set(sha256, { ...upload, ...change });
    });
  }, []);

  const add = useCallback(
    async (files: { sha256: string; blob: Blob }[]) => {
      const fresh = files.filter((file) => {
        const existing = uploads.get(file.sha256);
        return !existing || existing.status === "error";
      });
      if (fresh.length === 0) return;
      setUploads((current) => {
        const next = new Map(current);
        for (const file of fresh) {
          next.set(file.sha256, {
            sha256: file.sha256,
            blob: file.blob,
            size: file.blob.size,
            status: "checking",
            loaded: 0,
          });
        }
        return next;
      });
      try {
        const { missing } = await api.checkBlobs([...new Set(fresh.map((file) => file.sha256))]);
        const lacking = new Set(missing);
        setUploads((current) => {
          const next = new Map(current);
          for (const file of fresh) {
            const upload = next.get(file.sha256);
            if (upload?.status !== "checking") continue;
            next.set(file.sha256, {
              ...upload,
              status: lacking.has(file.sha256) ? "queued" : "done",
              loaded: lacking.has(file.sha256) ? 0 : upload.size,
            });
          }
          return next;
        });
      } catch {
        // If the check fails, upload them all; the server skips the ones it has.
        for (const file of fresh) patch(file.sha256, { status: "queued" });
      }
    },
    [uploads, patch],
  );

  /** Uploads again: failed ones, or files the server says it no longer has. */
  const retry = useCallback((sha256s?: string[]) => {
    setUploads((current) => {
      const next = new Map(current);
      for (const upload of current.values()) {
        const wanted = sha256s ? sha256s.includes(upload.sha256) : upload.status === "error";
        if (wanted && upload.status !== "uploading") {
          next.set(upload.sha256, { ...upload, status: "queued", loaded: 0 });
        }
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    for (const abort of running.current.values()) abort();
    running.current.clear();
    setUploads(new Map());
  }, []);

  // Starts queued uploads while there are free slots.
  useEffect(() => {
    const free = CONCURRENCY - running.current.size;
    if (free <= 0) return;
    const next = [...uploads.values()]
      .filter((upload) => upload.status === "queued" && !running.current.has(upload.sha256))
      .slice(0, free);
    for (const upload of next) {
      const { done, abort } = putBlob(upload, (loaded) => patch(upload.sha256, { loaded }));
      running.current.set(upload.sha256, abort);
      patch(upload.sha256, { status: "uploading", loaded: 0 });
      // Free the slot before the state change, so the next render starts the next upload.
      done.then(
        () => {
          running.current.delete(upload.sha256);
          patch(upload.sha256, { status: "done", loaded: upload.size });
        },
        () => {
          running.current.delete(upload.sha256);
          patch(upload.sha256, { status: "error", loaded: 0 });
        },
      );
    }
  }, [uploads, patch]);

  useEffect(
    () => () => {
      for (const abort of running.current.values()) abort();
    },
    [],
  );

  return { uploads, add, retry, clear };
}
