import type { FilePolicy, Instance, InstanceContent } from "@bc-launcher-server/contracts";
import { instancePathError } from "@bc-launcher-server/contracts/paths";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { FilePlusIcon, FolderPlusIcon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type VersionChoice, VersionPicker } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import {
  allFolders,
  changesOf,
  cloneDraft,
  type Draft,
  draftFrom,
  fileStatus,
  inFolder,
  rebase,
  toApply,
  treeRows,
} from "@/lib/content/draft";
import { type Collected, fromDrop, fromFileList, fromZip, hashEntries } from "@/lib/content/import";
import {
  deleteDraft,
  deserializeDraft,
  draftKey,
  loadDraft,
  type SavedDraft,
  saveDraft,
  serializeDraft,
} from "@/lib/content/persist";
import { useUploads } from "@/lib/content/uploads";
import { formatBytes, formatRelative } from "@/lib/format";
import { api, contentQuery, instanceQuery, instancesQuery, meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  ImportDialog,
  type ImportMode,
  LeaveDialog,
  PathDialog,
  type PendingImport,
  planImport,
  ReviewDialog,
} from "./content-dialogs";
import { ContentTree, FileDetail, FolderDetail } from "./content-tree";

/** Files players own after the first copy. */
const ONCE_BY_DEFAULT = new Set(["options.txt", "servers.dat"]);

export function InstanceContentPage({ id }: { id: string }) {
  const instance = useQuery(instanceQuery(id));
  const content = useQuery(contentQuery(id));
  if (!instance.data || !content.data) return null;
  return <ContentEditor instance={instance.data} initial={content.data} />;
}

type PathPrompt =
  | { kind: "move"; path: string; isFolder: boolean }
  | { kind: "folder"; parent: string };

type Notice = { tone: "success" | "warning" | "error"; text: string; paths?: string[] };

function ContentEditor({ instance, initial }: { instance: Instance; initial: InstanceContent }) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [server, setServer] = useState(initial);
  const base = useMemo(() => draftFrom(server), [server]);
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const { uploads, add: addUploads, adopt, retry, clear: clearUploads } = useUploads();
  const me = useQuery(meQuery);
  const storageKey = me.data ? draftKey(me.data.id, instance.id) : null;
  // Changes saved in this browser by an earlier visit, waiting for "Continue" or "Discard".
  const [restorable, setRestorable] = useState<SavedDraft | null>(null);
  // Saving starts once we know there's nothing to restore, so a fresh editor doesn't wipe it.
  const [persisting, setPersisting] = useState(false);
  const [selected, setSelected] = useState<{ path: string; kind: "dir" | "file" } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importFolder, setImportFolder] = useState("");
  const [hashing, setHashing] = useState<{ done: number; total: number } | null>(null);
  const [prompt, setPrompt] = useState<PathPrompt | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const changes = useMemo(() => changesOf(base, draft), [base, draft]);
  const dirty = changes.count > 0 || draft.folders.size > 0;
  const rows = useMemo(() => treeRows(base, draft, collapsed), [base, draft, collapsed]);
  const folders = useMemo(() => [...allFolders(draft)].sort(), [draft]);

  // Files the server doesn't have yet: they must be uploaded before applying.
  const baseShas = useMemo(() => new Set(server.files.map((file) => file.sha256)), [server]);
  const needed = useMemo(
    () =>
      new Set(
        [...draft.files.values()].map((file) => file.sha256).filter((sha) => !baseShas.has(sha)),
      ),
    [draft, baseShas],
  );
  const progress = useMemo(() => {
    let done = 0;
    let uploading = 0;
    let errors = 0;
    let missing = 0;
    let loaded = 0;
    let total = 0;
    for (const sha of needed) {
      const upload = uploads.get(sha);
      if (!upload) {
        missing++;
        continue;
      }
      total += upload.size;
      loaded += upload.status === "done" ? upload.size : upload.loaded;
      if (upload.status === "done") done++;
      else if (upload.status === "uploading") uploading++;
      else if (upload.status === "error") errors++;
    }
    return { done, uploading, errors, missing, loaded, total, count: needed.size };
  }, [needed, uploads]);
  const ready = progress.done === progress.count && changes.count > 0;

  // Pending changes are kept in this browser; only files still uploading are lost by leaving.
  const uploadsUnfinished = dirty && progress.done < progress.count;
  const blocker = useBlocker({
    shouldBlockFn: () => uploadsUnfinished,
    enableBeforeUnload: () => uploadsUnfinished,
    withResolver: true,
  });

  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    void loadDraft(storageKey).then((saved) => {
      if (cancelled) return;
      const hasChanges =
        saved &&
        (changesOf(draftFrom(saved.base), deserializeDraft(saved)).count > 0 ||
          saved.draft.folders.length > 0);
      if (hasChanges) setRestorable(saved);
      else setPersisting(true);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!persisting || !storageKey) return;
    const timer = setTimeout(() => {
      if (dirty) void saveDraft(storageKey, serializeDraft(server, draft));
      else void deleteDraft(storageKey);
    }, 300);
    return () => clearTimeout(timer);
  }, [persisting, storageKey, dirty, server, draft]);

  async function restore(saved: SavedDraft) {
    const savedDraft = deserializeDraft(saved);
    const result =
      saved.base.contentVersion === server.contentVersion
        ? { draft: savedDraft, conflicts: [] as string[] }
        : rebase(draftFrom(saved.base), savedDraft, base);
    setDraft(result.draft);
    setRestorable(null);
    setPersisting(true);

    // Files uploaded before leaving are on the server; the rest must be imported again.
    const pendingFiles = [...result.draft.files.values()].filter(
      (file) => !baseShas.has(file.sha256),
    );
    let missing = 0;
    if (pendingFiles.length > 0) {
      try {
        const lacking = new Set(
          (await api.checkBlobs([...new Set(pendingFiles.map((file) => file.sha256))])).missing,
        );
        adopt(pendingFiles.filter((file) => !lacking.has(file.sha256)));
        missing = new Set(pendingFiles.filter((f) => lacking.has(f.sha256)).map((f) => f.sha256))
          .size;
      } catch {
        missing = pendingFiles.length;
      }
    }
    const texts = [
      saved.base.contentVersion === server.contentVersion
        ? null
        : t(result.conflicts.length > 0 ? "content.conflictPaths" : "content.conflict", {
            version: server.contentVersion,
          }),
      missing > 0 ? t("content.restore.missing", { count: missing }) : null,
    ].filter((text): text is string => text !== null);
    setNotice(
      texts.length > 0 ? { tone: "warning", text: texts.join(" "), paths: result.conflicts } : null,
    );
  }

  function dropSaved() {
    if (storageKey) void deleteDraft(storageKey);
    setRestorable(null);
    setPersisting(true);
  }

  const edit = useCallback((change: (next: Draft) => void) => {
    setDraft((current) => {
      const next = cloneDraft(current);
      change(next);
      return next;
    });
    setNotice(null);
  }, []);

  const setVersion = useCallback(
    (version: VersionChoice) =>
      setDraft((current) =>
        current.version.mcVersion === version.mcVersion &&
        current.version.loader === version.loader &&
        current.version.loaderVersion === version.loaderVersion
          ? current
          : { ...cloneDraft(current), version },
      ),
    [],
  );

  // ---- Import -------------------------------------------------------------------------------

  /** The folder imports and new files go into: the selected folder, or the selected file's. */
  const targetFolder = () => {
    if (!selected) return "";
    if (selected.kind === "dir") return selected.path;
    return selected.path.split("/").slice(0, -1).join("/");
  };

  async function startImport(collect: () => Promise<Collected> | Collected) {
    setNotice(null);
    try {
      const collected = await collect();
      if (collected.entries.length === 0 && collected.discarded.length === 0) return;
      setHashing({ done: 0, total: collected.entries.length });
      const entries = await hashEntries(collected.entries, (done, total) =>
        setHashing({ done, total }),
      );
      setImportFolder(targetFolder());
      setPending({ name: collected.name, entries, discarded: collected.discarded });
    } catch (error) {
      console.error("Import failed", error);
      setNotice({ tone: "error", text: t("content.import.failed") });
    } finally {
      setHashing(null);
    }
  }

  function confirmImport(folder: string, mode: ImportMode) {
    if (!pending) return;
    const plan = planImport(draft, pending, folder, mode);
    const wasEmpty = draft.files.size === 0;
    edit((next) => {
      for (const path of plan.removed) next.files.delete(path);
      for (const entry of plan.placed) {
        const current = next.files.get(entry.path);
        if (current?.sha256 === entry.sha256) continue;
        const name = entry.path.split("/").at(-1) ?? "";
        const policy: FilePolicy =
          current?.policy ??
          (ONCE_BY_DEFAULT.has(name) && !entry.path.includes("/") ? "once" : "always");
        next.files.set(entry.path, {
          path: entry.path,
          sha256: entry.sha256,
          size: entry.size,
          policy,
        });
      }
      // A new instance's mods are the server's: suggest managing mods/.
      if (wasEmpty && plan.placed.some((entry) => entry.path.startsWith("mods/"))) {
        next.managedDirs.add("mods");
      }
    });
    const toUpload = plan.placed.filter((entry) => !baseShas.has(entry.sha256));
    void addUploads(toUpload.map((entry) => ({ sha256: entry.sha256, blob: entry.blob })));
    setPending(null);
  }

  // Files can be dropped anywhere on the page. The latest startImport is read through a ref.
  const dropImport = useRef<(transfer: DataTransfer) => void>(() => {});
  dropImport.current = (transfer) => void startImport(() => fromDrop(transfer));
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: globalThis.DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;
    const over = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const enter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const leave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      dropImport.current(event.dataTransfer);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }, []);

  // ---- Edits on the selection ---------------------------------------------------------------

  const setPolicy = (paths: string[], policy: FilePolicy) =>
    edit((next) => {
      for (const path of paths) {
        const file = next.files.get(path);
        if (file) next.files.set(path, { ...file, policy });
      }
    });

  const removeFolder = (folder: string) =>
    edit((next) => {
      for (const path of [...next.files.keys()])
        if (inFolder(path, folder)) next.files.delete(path);
      for (const dir of [...next.managedDirs]) {
        if (dir === folder || inFolder(dir, folder)) next.managedDirs.delete(dir);
      }
      for (const dir of [...next.folders]) {
        if (dir === folder || inFolder(dir, folder)) next.folders.delete(dir);
      }
    });

  const move = (from: string, to: string, isFolder: boolean) =>
    edit((next) => {
      const rename = (path: string) => (isFolder ? `${to}${path.slice(from.length)}` : to);
      const moving = [...next.files.values()].filter((file) =>
        isFolder ? inFolder(file.path, from) : file.path === from,
      );
      for (const file of moving) next.files.delete(file.path);
      for (const file of moving)
        next.files.set(rename(file.path), { ...file, path: rename(file.path) });
      if (isFolder) {
        for (const set of [next.managedDirs, next.folders]) {
          for (const dir of [...set]) {
            if (dir === from || inFolder(dir, from)) {
              set.delete(dir);
              set.add(rename(dir));
            }
          }
        }
      }
    });

  const validateTarget = (from: string | null, isFolder: boolean) => (path: string) => {
    const problem = instancePathError(path);
    if (problem) return t("content.pathInvalid", { reason: problem });
    if (from !== null && path === from) return null;
    if (isFolder && from !== null && inFolder(path, from)) return t("content.pathInsideItself");
    const lower = path.toLowerCase();
    const clash =
      [...draft.files.keys()].some((existing) => existing.toLowerCase() === lower) ||
      folders.some((folder) => folder.toLowerCase() === lower);
    return clash ? t("content.pathTaken") : null;
  };

  // ---- Apply --------------------------------------------------------------------------------

  const refreshInstance = () => {
    void queryClient.invalidateQueries({
      queryKey: instanceQuery(instance.id).queryKey,
      exact: true,
    });
    void queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey, exact: true });
  };

  const apply = useMutation({
    mutationFn: () => api.applyContent(instance.id, toApply(draft, server.contentVersion)),
    onSuccess: (next) => {
      queryClient.setQueryData(contentQuery(instance.id).queryKey, next);
      setServer(next);
      setDraft(draftFrom(next));
      clearUploads();
      setReviewing(false);
      setNotice({ tone: "success", text: t("content.applied", { version: next.contentVersion }) });
      refreshInstance();
    },
    onError: async (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.code === "content_conflict") {
        // Someone applied first: replay our changes on top of what they applied.
        const latest = await queryClient.fetchQuery({ ...contentQuery(instance.id), staleTime: 0 });
        const result = rebase(base, draft, draftFrom(latest));
        setServer(latest);
        setDraft(result.draft);
        setReviewing(false);
        refreshInstance();
        setNotice({
          tone: "warning",
          text: t(result.conflicts.length > 0 ? "content.conflictPaths" : "content.conflict", {
            version: latest.contentVersion,
          }),
          paths: result.conflicts,
        });
      } else if (error.code === "missing_blobs") {
        // The cleanup removed a file that was uploaded too long ago: upload them again.
        retry([...needed]);
        setReviewing(false);
        setNotice({ tone: "warning", text: t("content.missingBlobs") });
      }
    },
  });
  const applyError =
    apply.error instanceof ApiError && apply.error.code === "invalid_version"
      ? t("version.invalid")
      : apply.error instanceof ApiError && apply.error.code === "metadata_unavailable"
        ? t("version.metadataUnavailable")
        : apply.error instanceof ApiError &&
            ["content_conflict", "missing_blobs"].includes(apply.error.code)
          ? null
          : apply.error
            ? t("common.unexpectedError")
            : null;

  function discard() {
    setDraft(draftFrom(server));
    clearUploads();
    setSelected(null);
    setNotice(null);
  }

  // ---- Render -------------------------------------------------------------------------------

  const selectedFile =
    selected?.kind === "file"
      ? (draft.files.get(selected.path) ?? base.files.get(selected.path))
      : undefined;
  const selectedFolderFiles =
    selected?.kind === "dir"
      ? [...draft.files.values()].filter((file) => inFolder(file.path, selected.path))
      : [];
  const folderPolicies = new Set(selectedFolderFiles.map((file) => file.policy));
  const totalSize = server.files.reduce((sum, file) => sum + file.size, 0);

  if (restorable) {
    return (
      <section
        aria-labelledby="content-restore"
        className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-[18px]"
      >
        <h2 id="content-restore" className="m-0 text-base font-semibold text-warning">
          {t("content.restore.title")}
        </h2>
        <p className="m-0 text-subtle-foreground">
          {t("content.restore.description", {
            when: formatRelative(new Date(restorable.savedAt), language),
            count: changesOf(draftFrom(restorable.base), deserializeDraft(restorable)).count,
          })}
          {restorable.base.contentVersion !== server.contentVersion
            ? ` ${t("content.restore.serverChanged", { version: server.contentVersion })}`
            : ""}
        </p>
        <div className="flex gap-2">
          <Button type="button" onClick={() => void restore(restorable)}>
            {t("content.restore.continue")}
          </Button>
          <Button type="button" variant="outline" onClick={dropSaved}>
            {t("common.discard")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-5",
        dragging && "rounded-xl outline-2 outline-offset-8 outline-dashed outline-primary",
      )}
    >
      <section
        aria-label={t("content.versionSection")}
        className="flex flex-wrap items-end gap-3.5 rounded-xl border border-border bg-card px-[18px] py-4 [&>div]:min-w-[150px] [&>div]:text-[13px]"
      >
        <VersionPicker value={draft.version} onChange={setVersion} layout="row" />
        <div className="ml-auto flex flex-col gap-0.5 text-right text-[13px]">
          <span className="font-semibold">
            {server.contentVersion > 0
              ? t("instance.contentVersion", { version: server.contentVersion })
              : t("content.noContentYet")}
          </span>
          {server.updatedAt ? (
            <span className="text-muted-foreground">
              {t("content.lastApplied", {
                when: formatRelative(new Date(server.updatedAt), language),
                who: server.updatedBy?.username ?? t("activity.removedAdmin"),
                files: server.files.length,
                size: formatBytes(totalSize, language),
              })}
            </span>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => folderInput.current?.click()}
          disabled={hashing !== null}
        >
          <UploadIcon aria-hidden="true" />
          {t("content.importFolder")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => zipInput.current?.click()}
          disabled={hashing !== null}
        >
          {t("content.importZip")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => filesInput.current?.click()}
          disabled={hashing !== null}
        >
          <FilePlusIcon aria-hidden="true" />
          {t("content.addFiles")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setPrompt({ kind: "folder", parent: targetFolder() })}
        >
          <FolderPlusIcon aria-hidden="true" />
          {t("content.newFolder")}
        </Button>
        <span className="ml-auto text-[13px] text-muted-foreground">
          {hashing
            ? t("content.hashing", { done: hashing.done, total: hashing.total })
            : t("content.dropHint")}
        </span>
        <input
          ref={folderInput}
          type="file"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          {...{ webkitdirectory: "" }}
          multiple
          onChange={(event) => {
            const files = event.target.files ? [...event.target.files] : [];
            event.target.value = "";
            if (files.length > 0) void startImport(() => fromFileList(files));
          }}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void startImport(() => fromZip(file));
          }}
        />
        <input
          ref={filesInput}
          type="file"
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const files = event.target.files ? [...event.target.files] : [];
            event.target.value = "";
            if (files.length > 0) void startImport(() => fromFileList(files));
          }}
        />
      </div>

      {notice ? (
        <Alert
          role={notice.tone === "error" ? "alert" : "status"}
          variant={notice.tone === "error" ? "destructive" : "warning"}
          className={cn("flex-col", notice.tone === "success" && "bg-success/10 text-success")}
        >
          <span>{notice.text}</span>
          {notice.paths && notice.paths.length > 0 ? (
            <span className="font-mono text-xs">{notice.paths.join(", ")}</span>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <ContentTree
          rows={rows}
          selected={selected?.path ?? null}
          collapsed={collapsed}
          managedDirs={draft.managedDirs}
          uploads={uploads}
          needed={needed}
          onSelect={(row) => setSelected({ path: row.path, kind: row.kind })}
          onToggle={(path) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            })
          }
          onRetry={(sha) => retry([sha])}
        />
        {selectedFile && selected ? (
          <FileDetail
            file={selectedFile}
            status={
              draft.files.has(selectedFile.path) ? fileStatus(base.files, selectedFile) : "deleted"
            }
            upload={uploads.get(selectedFile.sha256)}
            needsUpload={needed.has(selectedFile.sha256)}
            onPolicy={(policy) => setPolicy([selectedFile.path], policy)}
            onMove={() => setPrompt({ kind: "move", path: selectedFile.path, isFolder: false })}
            onRemove={() => edit((next) => next.files.delete(selectedFile.path))}
            onRestore={() =>
              edit((next) => {
                const original = base.files.get(selectedFile.path);
                if (original) next.files.set(original.path, original);
              })
            }
            onRetry={() => retry([selectedFile.sha256])}
          />
        ) : selected?.kind === "dir" ? (
          <FolderDetail
            path={selected.path}
            fileCount={selectedFolderFiles.length}
            size={selectedFolderFiles.reduce((sum, file) => sum + file.size, 0)}
            managed={draft.managedDirs.has(selected.path)}
            policy={folderPolicies.size === 1 ? ([...folderPolicies][0] as FilePolicy) : null}
            onManaged={(managed) =>
              edit((next) => {
                if (managed) next.managedDirs.add(selected.path);
                else next.managedDirs.delete(selected.path);
              })
            }
            onPolicy={(policy) =>
              setPolicy(
                selectedFolderFiles.map((file) => file.path),
                policy,
              )
            }
            onMove={() => setPrompt({ kind: "move", path: selected.path, isFolder: true })}
            onRemove={() => {
              removeFolder(selected.path);
              setSelected(null);
            }}
          />
        ) : (
          <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-2 rounded-xl border border-border bg-card p-[18px] text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground">{t("content.noSelection")}</span>
            {t("content.noSelectionHint")}
          </aside>
        )}
      </div>

      {dirty ? (
        <PendingBar
          changes={changes}
          progress={progress}
          ready={ready}
          onDiscard={discard}
          onRetry={() => retry()}
          onReview={() => {
            apply.reset();
            setReviewing(true);
          }}
        />
      ) : null}

      {pending ? (
        <ImportDialog
          pending={pending}
          draft={draft}
          folders={folders}
          initialFolder={importFolder}
          onCancel={() => setPending(null)}
          onConfirm={confirmImport}
        />
      ) : null}

      {prompt?.kind === "move" ? (
        <PathDialog
          title={t(prompt.isFolder ? "content.moveFolderTitle" : "content.moveTitle")}
          initial={prompt.path}
          submitLabel={t("content.move")}
          validate={validateTarget(prompt.path, prompt.isFolder)}
          onCancel={() => setPrompt(null)}
          onSubmit={(path) => {
            if (path !== prompt.path) move(prompt.path, path, prompt.isFolder);
            setSelected({ path, kind: prompt.isFolder ? "dir" : "file" });
            setPrompt(null);
          }}
        />
      ) : null}

      {prompt?.kind === "folder" ? (
        <PathDialog
          title={t("content.newFolder")}
          initial={prompt.parent ? `${prompt.parent}/` : ""}
          submitLabel={t("content.createFolder")}
          validate={validateTarget(null, true)}
          onCancel={() => setPrompt(null)}
          onSubmit={(path) => {
            edit((next) => next.folders.add(path));
            setSelected({ path, kind: "dir" });
            setPrompt(null);
          }}
        />
      ) : null}

      {reviewing ? (
        <ReviewDialog
          name={instance.name}
          contentVersion={server.contentVersion}
          isActive={instance.isActive}
          base={base}
          draft={draft}
          changes={changes}
          applying={apply.isPending}
          error={applyError}
          onCancel={() => setReviewing(false)}
          onApply={() => apply.mutate()}
        />
      ) : null}

      {blocker.status === "blocked" ? (
        <LeaveDialog onStay={() => blocker.reset()} onLeave={() => blocker.proceed()} />
      ) : null}
    </div>
  );
}

function PendingBar({
  changes,
  progress,
  ready,
  onDiscard,
  onRetry,
  onReview,
}: {
  changes: ReturnType<typeof changesOf>;
  progress: {
    done: number;
    uploading: number;
    errors: number;
    missing: number;
    loaded: number;
    total: number;
    count: number;
  };
  ready: boolean;
  onDiscard: () => void;
  onRetry: () => void;
  onReview: () => void;
}) {
  const { t, language } = useI18n();
  const percent = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 100;
  const parts = [
    changes.added.length > 0 ? (
      <span key="a" className="text-success">
        {t("content.pending.added", { count: changes.added.length })}
      </span>
    ) : null,
    changes.modified.length > 0 ? (
      <span key="m" className="text-warning">
        {t("content.pending.modified", { count: changes.modified.length })}
      </span>
    ) : null,
    changes.deleted.length > 0 ? (
      <span key="d" className="text-destructive-foreground">
        {t("content.pending.deleted", { count: changes.deleted.length })}
      </span>
    ) : null,
    changes.dirsAdded.length + changes.dirsRemoved.length > 0 ? (
      <span key="f" className="text-link">
        {t("content.pending.managed")}
      </span>
    ) : null,
    changes.versionChanged ? (
      <span key="v" className="text-link">
        {t("content.pending.version")}
      </span>
    ) : null,
  ].filter(Boolean);

  return (
    <section
      aria-label={t("content.pending")}
      className="sticky bottom-0 -mx-4 mt-1 flex flex-wrap items-center gap-4 border-t border-[#4a3556] bg-[#24182c] px-4 py-3.5 sm:-mx-10 sm:px-10"
    >
      <div className="flex min-w-[300px] flex-1 flex-col gap-1.5">
        <span className="font-semibold">
          {t("content.pending")}:{" "}
          {parts.length > 0
            ? parts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))
            : t("content.pending.foldersOnly")}
        </span>
        {progress.count > 0 ? (
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-subtle-foreground">
            <span className="inline-block h-1.5 w-[220px] overflow-hidden rounded-[3px] bg-border">
              <span className="block h-1.5 bg-[#60a5fa]" style={{ width: `${percent}%` }} />
            </span>
            {t("content.pending.uploads", {
              done: progress.done,
              count: progress.count,
              loaded: formatBytes(progress.loaded, language),
              total: formatBytes(progress.total, language),
            })}
            {progress.uploading > 0
              ? ` · ${t("content.pending.uploading", { count: progress.uploading })}`
              : ""}
            {progress.errors > 0 ? (
              <span className="text-destructive-foreground">
                · {t("content.pending.errors", { count: progress.errors })}{" "}
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-link underline"
                  onClick={onRetry}
                >
                  {t("content.upload.retryAll")}
                </button>
              </span>
            ) : null}
            {progress.missing > 0 ? (
              <span className="text-destructive-foreground">
                · {t("content.pending.missing", { count: progress.missing })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <Button type="button" variant="outline" onClick={onDiscard}>
        {t("common.discard")}
      </Button>
      <Button
        type="button"
        disabled={!ready}
        title={ready ? undefined : t("content.reviewDisabled")}
        onClick={onReview}
      >
        {t("content.review")}
      </Button>
    </section>
  );
}
