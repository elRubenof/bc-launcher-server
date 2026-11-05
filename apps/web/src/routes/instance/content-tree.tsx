import type { FilePolicy } from "@bc-launcher-server/contracts";
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, LockIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { DraftFile, FileStatus, TreeRow } from "@/lib/content/draft";
import type { Upload } from "@/lib/content/uploads";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full px-[7px] py-px text-[11px] font-semibold";

function StatusPill({ status }: { status: FileStatus }) {
  const { t } = useI18n();
  if (status === "unchanged") return null;
  const style = {
    new: "bg-success/14 text-success",
    modified: "bg-warning/14 text-warning",
    deleted: "bg-destructive/14 text-destructive-foreground",
  }[status];
  return <span className={cn(pill, style)}>{t(`content.status.${status}`)}</span>;
}

export function UploadState({
  upload,
  onRetry,
  missing,
}: {
  upload: Upload | undefined;
  onRetry: () => void;
  missing: boolean;
}) {
  const { t } = useI18n();
  if (!upload) {
    return missing ? (
      <span className="text-[11px] font-semibold text-destructive-foreground">
        {t("content.upload.missing")}
      </span>
    ) : null;
  }
  if (upload.status === "uploading") {
    const percent = upload.size ? Math.round((upload.loaded / upload.size) * 100) : 0;
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#93c5fd]">
        <span className="inline-block h-[5px] w-[60px] overflow-hidden rounded-[3px] bg-[#2a2f4a]">
          <span className="block h-[5px] bg-[#60a5fa]" style={{ width: `${percent}%` }} />
        </span>
        {percent}%
      </span>
    );
  }
  if (upload.status === "queued" || upload.status === "checking") {
    return (
      <span className="text-[11px] font-semibold text-muted-foreground">
        {t("content.upload.queued")}
      </span>
    );
  }
  if (upload.status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-destructive-foreground">
        {t("content.upload.error")}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
          className="h-6 cursor-pointer rounded-md border border-[#7f1d1d] bg-transparent px-2 text-[11px] text-destructive-foreground"
        >
          {t("content.upload.retry")}
        </button>
      </span>
    );
  }
  return null;
}

export function ContentTree({
  rows,
  selected,
  collapsed,
  managedDirs,
  uploads,
  needed,
  onSelect,
  onToggle,
  onRetry,
}: {
  rows: TreeRow[];
  selected: string | null;
  collapsed: Set<string>;
  managedDirs: Set<string>;
  uploads: Map<string, Upload>;
  needed: Set<string>;
  onSelect: (row: TreeRow) => void;
  onToggle: (path: string) => void;
  onRetry: (sha256: string) => void;
}) {
  const { t, language } = useI18n();
  return (
    <section
      aria-label={t("content.tree")}
      className="min-w-0 flex-[3_1_520px] overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex gap-3 border-b border-border px-3.5 py-2.5 text-xs font-semibold text-muted-foreground">
        <span className="flex-1">{t("content.column.path")}</span>
        <span className="w-[90px]">{t("content.column.policy")}</span>
        <span className="w-[76px] text-right">{t("content.column.size")}</span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 px-3.5 py-6 text-muted-foreground">{t("content.empty")}</p>
      ) : (
        <div role="tree" aria-label={t("content.tree")}>
          {rows.map((row) => {
            const isDir = row.kind === "dir";
            const open = !collapsed.has(row.path);
            const file = row.file as DraftFile | undefined;
            const deleted = row.status === "deleted";
            return (
              <div
                key={`${row.kind}:${row.path}`}
                role="treeitem"
                aria-selected={selected === row.path}
                aria-expanded={isDir ? open : undefined}
                className={cn(
                  "flex min-h-[38px] cursor-pointer items-center gap-3 border-b border-[#251a2c] px-3.5 last:border-b-0 hover:bg-accent/50",
                  selected === row.path && "bg-secondary hover:bg-secondary",
                )}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row);
                  }
                }}
                tabIndex={0}
              >
                <span
                  className="flex min-w-0 flex-1 items-center gap-2"
                  style={{ paddingLeft: row.depth * 20 }}
                >
                  {isDir ? (
                    <button
                      type="button"
                      aria-label={t(open ? "content.collapse" : "content.expand", {
                        name: row.name,
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(row.path);
                      }}
                      className="-ml-1 flex cursor-pointer border-0 bg-transparent p-0.5 text-muted-foreground"
                    >
                      {open ? (
                        <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRightIcon className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                  {isDir ? (
                    <FolderIcon
                      className="size-4 shrink-0 text-subtle-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileIcon className="size-4 shrink-0 text-[#8e7d9a]" aria-hidden="true" />
                  )}
                  <span
                    className={cn(
                      "truncate font-mono text-[13px]",
                      deleted && "text-muted-foreground line-through",
                    )}
                  >
                    {isDir ? `${row.name}/` : row.name}
                  </span>
                  {isDir && managedDirs.has(row.path) ? (
                    <span
                      className={cn(pill, "bg-secondary text-link")}
                      title={t("content.managed")}
                    >
                      <LockIcon className="size-[11px]" aria-hidden="true" />
                      {t("content.managedShort")}
                    </span>
                  ) : null}
                  {row.status ? <StatusPill status={row.status} /> : null}
                  {file && !deleted && needed.has(file.sha256) ? (
                    <UploadState
                      upload={uploads.get(file.sha256)}
                      missing
                      onRetry={() => onRetry(file.sha256)}
                    />
                  ) : null}
                </span>
                <span className="w-[90px] text-xs text-subtle-foreground">
                  {file ? t(`content.policy.${file.policy}`) : ""}
                </span>
                <span className="w-[76px] text-right text-xs text-muted-foreground">
                  {file ? formatBytes(file.size, language) : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 mt-0.5 break-all", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}

function PolicyChoice({
  value,
  onChange,
  name,
}: {
  value: FilePolicy | null;
  onChange: (policy: FilePolicy) => void;
  name: string;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-semibold">{t("content.policy")}</legend>
      {(["always", "once"] as const).map((policy) => (
        <label
          key={policy}
          className="flex cursor-pointer gap-2.5 rounded-md border border-input p-2.5 has-checked:border-primary has-checked:bg-secondary has-focus-visible:ring-2 has-focus-visible:ring-ring"
        >
          <input
            type="radio"
            name={name}
            className="mt-0.5 accent-primary"
            checked={value === policy}
            onChange={() => onChange(policy)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{t(`content.policy.${policy}`)}</span>
            <span className="text-xs text-muted-foreground">
              {t(`content.policy.${policy}Hint`)}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function FileDetail({
  file,
  status,
  upload,
  needsUpload,
  onPolicy,
  onMove,
  onRemove,
  onRestore,
  onRetry,
}: {
  file: DraftFile;
  status: FileStatus;
  upload: Upload | undefined;
  needsUpload: boolean;
  onPolicy: (policy: FilePolicy) => void;
  onMove: () => void;
  onRemove: () => void;
  onRestore: () => void;
  onRetry: () => void;
}) {
  const { t, language } = useI18n();
  const name = file.path.split("/").at(-1) ?? file.path;
  return (
    <aside
      aria-labelledby="content-detail-title"
      className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5 rounded-xl border border-border bg-card p-[18px]"
    >
      <h2 id="content-detail-title" className="m-0 font-mono text-[15px] font-semibold break-all">
        {name}
      </h2>
      <dl className="m-0 flex flex-col gap-2.5 text-[13px]">
        <Field label={t("content.detail.path")} mono>
          {file.path}
        </Field>
        <Field label={t("content.detail.size")}>{formatBytes(file.size, language)}</Field>
        <Field label="SHA-256" mono>
          {`${file.sha256.slice(0, 8)}…${file.sha256.slice(-8)}`}
        </Field>
        <Field label={t("content.detail.state")}>
          <span className="flex flex-wrap items-center gap-2">
            {t(`content.state.${status}`)}
            {needsUpload && status !== "deleted" ? (
              <UploadState upload={upload} missing onRetry={onRetry} />
            ) : null}
          </span>
        </Field>
      </dl>
      {status === "deleted" ? (
        <Button type="button" variant="outline" onClick={onRestore}>
          {t("content.restore")}
        </Button>
      ) : (
        <>
          <PolicyChoice name="file-policy" value={file.policy} onChange={onPolicy} />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onMove}>
              {t("content.move")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-[#7f1d1d] text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
              onClick={onRemove}
            >
              {t("common.remove")}
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}

export function FolderDetail({
  path,
  fileCount,
  size,
  managed,
  policy,
  onManaged,
  onPolicy,
  onMove,
  onRemove,
}: {
  path: string;
  fileCount: number;
  size: number;
  managed: boolean;
  policy: FilePolicy | null;
  onManaged: (managed: boolean) => void;
  onPolicy: (policy: FilePolicy) => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const { t, language } = useI18n();
  return (
    <aside
      aria-labelledby="content-detail-title"
      className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5 rounded-xl border border-border bg-card p-[18px]"
    >
      <h2 id="content-detail-title" className="m-0 font-mono text-[15px] font-semibold break-all">
        {path}/
      </h2>
      <dl className="m-0 flex flex-col gap-2.5 text-[13px]">
        <Field label={t("content.detail.contents")}>
          {t("content.detail.files", { count: fileCount, size: formatBytes(size, language) })}
        </Field>
      </dl>
      <label className="flex cursor-pointer gap-2.5 rounded-md border border-input p-2.5 has-checked:border-primary has-checked:bg-secondary">
        <input
          type="checkbox"
          className="mt-0.5 accent-primary"
          checked={managed}
          onChange={(event) => onManaged(event.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t("content.managed")}</span>
          <span className="text-xs text-muted-foreground">{t("content.managedHint")}</span>
        </span>
      </label>
      {fileCount > 0 ? (
        <>
          <PolicyChoice name="folder-policy" value={policy} onChange={onPolicy} />
          <span className="-mt-2 text-xs text-muted-foreground">
            {t("content.folderPolicyHint")}
          </span>
        </>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onMove}>
          {t("content.move")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-[#7f1d1d] text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
          onClick={onRemove}
        >
          {t("content.removeFolder")}
        </Button>
      </div>
    </aside>
  );
}
