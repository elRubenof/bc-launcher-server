import { instancePathError } from "@bc-launcher-server/contracts/paths";
import { type FormEvent, useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { versionLabel } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { type Changes, type Draft, type DraftFile, inFolder } from "@/lib/content/draft";
import type { Discarded, DiscardReason, HashedEntry } from "@/lib/content/import";
import { formatBytes } from "@/lib/format";

export type ImportMode = "merge" | "replace";

export interface PendingImport {
  name: string;
  /** Hashed, with paths relative to the import's root. */
  entries: HashedEntry[];
  discarded: Discarded[];
}

/** Where the entries land for a target folder, and how they compare with the draft. */
export function planImport(draft: Draft, pending: PendingImport, folder: string, mode: ImportMode) {
  const placed: HashedEntry[] = [];
  const invalid: Discarded[] = [];
  for (const entry of pending.entries) {
    const path = folder ? `${folder}/${entry.path}` : entry.path;
    if (instancePathError(path)) invalid.push({ path: entry.path, reason: "invalid" });
    else placed.push({ ...entry, path });
  }
  const incoming = new Set(placed.map((entry) => entry.path));
  let added = 0;
  let modified = 0;
  let unchanged = 0;
  for (const entry of placed) {
    const current = draft.files.get(entry.path);
    if (!current) added++;
    else if (current.sha256 === entry.sha256) unchanged++;
    else modified++;
  }
  const removed =
    mode === "replace"
      ? [...draft.files.keys()].filter((path) => inFolder(path, folder) && !incoming.has(path))
      : [];
  return { placed, invalid, added, modified, unchanged, removed };
}

export function ImportDialog({
  pending,
  draft,
  folders,
  initialFolder,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport;
  draft: Draft;
  folders: string[];
  initialFolder: string;
  onCancel: () => void;
  onConfirm: (folder: string, mode: ImportMode) => void;
}) {
  const { t, language } = useI18n();
  const folderId = useId();
  const [folder, setFolder] = useState(initialFolder);
  const [mode, setMode] = useState<ImportMode>("merge");
  const plan = planImport(draft, pending, folder, mode);
  const discarded = [...pending.discarded, ...plan.invalid];
  const groups = new Map<DiscardReason, number>();
  for (const item of discarded) groups.set(item.reason, (groups.get(item.reason) ?? 0) + 1);
  const totalSize = pending.entries.reduce((sum, entry) => sum + entry.size, 0);
  const toUpload = plan.added + plan.modified;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent closeLabel={t("common.close")} className="max-w-xl">
        <DialogTitle>{t("content.import.title", { name: pending.name })}</DialogTitle>
        <DialogDescription>
          {t("content.import.summary", {
            count: pending.entries.length,
            size: formatBytes(totalSize, language),
          })}
        </DialogDescription>
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ["added", plan.added, "text-success"],
              ["modified", plan.modified, "text-warning"],
              ["unchanged", plan.unchanged, "text-subtle-foreground"],
            ] as const
          ).map(([key, value, color]) => (
            <div
              key={key}
              className="flex flex-col gap-0.5 rounded-md border border-border bg-input-background p-3"
            >
              <span className={`text-xl font-bold ${color}`}>{value}</span>
              <span className="text-xs text-muted-foreground">{t(`content.import.${key}`)}</span>
            </div>
          ))}
        </div>
        {discarded.length > 0 ? (
          <div
            role="note"
            className="flex flex-col gap-1 rounded-md border border-border bg-input-background p-3 text-[13px]"
          >
            <span className="font-semibold">
              {t("content.import.discarded", { count: discarded.length })}
            </span>
            <span className="text-subtle-foreground">
              {[...groups]
                .map(([reason, count]) => `${t(`content.discard.${reason}`)} (${count})`)
                .join(" · ")}
            </span>
            {groups.has("launcher") ? (
              <span className="text-xs text-muted-foreground">
                {t("content.import.launcherHint")}
              </span>
            ) : null}
            {groups.has("tooLarge") || groups.has("invalid") ? (
              <span className="max-h-20 overflow-auto font-mono text-xs text-muted-foreground">
                {discarded
                  .filter((item) => item.reason === "tooLarge" || item.reason === "invalid")
                  .slice(0, 20)
                  .map((item) => item.path)
                  .join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 font-semibold">{t("content.import.mode")}</legend>
          {(["merge", "replace"] as const).map((value) => (
            <label
              key={value}
              className="flex cursor-pointer gap-2.5 rounded-md border border-input p-2.5 has-checked:border-primary has-checked:bg-secondary"
            >
              <input
                type="radio"
                name="import-mode"
                className="mt-0.5 accent-primary"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{t(`content.import.${value}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {value === "merge"
                    ? t("content.import.mergeHint")
                    : mode !== "replace"
                      ? t("content.import.replaceHint")
                      : plan.removed.length > 0
                        ? t("content.import.replaceCount", { count: plan.removed.length })
                        : t("content.import.replaceNothing")}
                </span>
                {value === "replace" && mode === "replace" && plan.removed.length > 0 ? (
                  <span className="max-h-16 overflow-auto font-mono text-xs text-destructive-foreground">
                    {plan.removed.slice(0, 10).join(", ")}
                    {plan.removed.length > 10 ? "…" : ""}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={folderId}>{t("content.import.into")}</Label>
          <Select id={folderId} value={folder} onChange={(event) => setFolder(event.target.value)}>
            <option value="">{t("content.import.root")}</option>
            {folders.map((path) => (
              <option key={path} value={path}>
                {path}/
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={plan.placed.length === 0 && plan.removed.length === 0}
            onClick={() => onConfirm(folder, mode)}
          >
            {toUpload > 0
              ? t("content.import.confirm", { count: toUpload })
              : t("content.import.confirmNoUpload")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewDialog({
  name,
  contentVersion,
  isActive,
  base,
  draft,
  changes,
  applying,
  error,
  onCancel,
  onApply,
}: {
  name: string;
  contentVersion: number;
  isActive: boolean;
  base: Draft;
  draft: Draft;
  changes: Changes;
  applying: boolean;
  error: string | null;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { t } = useI18n();
  const onceModified = changes.modified.filter((file) => file.policy === "once");
  const modsUnmanaged =
    !draft.managedDirs.has("mods") &&
    [...draft.files.keys()].some((path) => path.startsWith("mods/"));
  const line = (sign: string, color: string, file: DraftFile | string) => {
    const path = typeof file === "string" ? file : file.path;
    return (
      <li key={`${sign}${path}`} className={`font-mono text-xs ${color}`}>
        {sign} {path}
      </li>
    );
  };
  return (
    <Dialog open onOpenChange={(open) => (open || applying ? null : onCancel())}>
      <DialogContent closeLabel={t("common.close")} className="max-w-xl">
        <DialogTitle>{t("content.review.title")}</DialogTitle>
        <DialogDescription>
          {t("content.review.summary", { name, version: contentVersion + 1 })}
          {contentVersion === 0 && isActive ? ` ${t("content.review.firstApply")}` : ""}
        </DialogDescription>
        {changes.count - (changes.versionChanged ? 1 : 0) > 0 ? (
          <ul className="m-0 flex max-h-56 list-none flex-col gap-1 overflow-auto rounded-md border border-border bg-input-background p-3">
            {changes.added.map((file) => line("+", "text-success", file))}
            {changes.modified.map((file) => line("~", "text-warning", file))}
            {changes.deleted.map((file) => line("−", "text-destructive-foreground", file))}
            {changes.dirsAdded.map((dir) =>
              line("+", "text-link", t("content.review.managedAdded", { dir })),
            )}
            {changes.dirsRemoved.map((dir) =>
              line("−", "text-link", t("content.review.managedRemoved", { dir })),
            )}
          </ul>
        ) : null}
        <div className="flex flex-col gap-2 text-[13px]">
          {onceModified.map((file) => (
            <Alert key={file.path} role="note">
              <span aria-hidden="true">!</span>
              <span>{t("content.review.onceModified", { path: file.path })}</span>
            </Alert>
          ))}
          {modsUnmanaged ? (
            <Alert role="note">
              <span aria-hidden="true">!</span>
              <span>{t("content.review.modsUnmanaged")}</span>
            </Alert>
          ) : null}
          <div
            role="note"
            className="flex gap-2.5 rounded-md bg-secondary p-3 text-subtle-foreground"
          >
            <span aria-hidden="true">i</span>
            <span>
              {changes.versionChanged
                ? t("content.review.versionChanged", {
                    from: versionLabel(base.version),
                    to: versionLabel(draft.version),
                  })
                : t("content.review.versionSame", { version: versionLabel(draft.version) })}
            </span>
          </div>
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={applying}>
            {t("common.back")}
          </Button>
          <Button type="button" onClick={onApply} disabled={applying}>
            {applying ? t("content.review.applying") : t("content.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for a path: moving or renaming a file or folder, or naming a new folder. */
export function PathDialog({
  title,
  initial,
  submitLabel,
  validate,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  validate: (path: string) => string | null;
  onCancel: () => void;
  onSubmit: (path: string) => void;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const path = value.trim().replace(/^\/+|\/+$/g, "");
    const problem = validate(path);
    if (problem) return setError(problem);
    onSubmit(path);
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent closeLabel={t("common.close")}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogTitle>{title}</DialogTitle>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>{t("content.detail.path")}</Label>
            <Input
              id={inputId}
              className="font-mono text-[13px]"
              value={value}
              autoFocus
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            {error ? <p className="m-0 text-[13px] text-destructive-foreground">{error}</p> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onStay())}>
      <DialogContent closeLabel={t("common.close")}>
        <DialogTitle>{t("content.leave.title")}</DialogTitle>
        <DialogDescription>{t("content.leave.description")}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onLeave}>
            {t("content.leave.leave")}
          </Button>
          <Button type="button" onClick={onStay}>
            {t("content.leave.stay")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
