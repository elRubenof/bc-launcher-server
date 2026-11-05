import type { Instance } from "@bc-launcher-server/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { InstanceIcon } from "@/components/instance-icon";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { versionLabel } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { clickableRow } from "@/lib/clickable-row";
import { formatDate, formatRelative } from "@/lib/format";
import { instancesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { NewInstanceDialog } from "./new-instance-dialog";

type Status = "active" | "inactive" | "empty";

export function instanceStatus(instance: Instance): Status {
  if (instance.contentVersion === 0) return "empty";
  return instance.isActive ? "active" : "inactive";
}

export function StatusBadge({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const status = instanceStatus(instance);
  const variant = { active: "success", inactive: "muted", empty: "warning" } as const;
  return <Badge variant={variant[status]}>{t(`instances.status.${status}`)}</Badge>;
}

export function InstancesPage() {
  const { t, language } = useI18n();
  const instances = useQuery(instancesQuery);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const searchId = useId();
  const statusId = useId();

  const term = search.trim().toLowerCase();
  const rows = (instances.data ?? []).filter(
    (instance) =>
      (!term || instance.name.toLowerCase().includes(term) || instance.id.includes(term)) &&
      (!status || instanceStatus(instance) === status),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={t("instances.title")} description={t("instances.subtitle")} />
        <NewInstanceDialog />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <label
          htmlFor={searchId}
          className="flex h-10 max-w-[360px] flex-1 items-center gap-2 rounded-md border border-border bg-input-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring"
        >
          <SearchIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("instances.search")}</span>
          <input
            id={searchId}
            type="search"
            placeholder={t("instances.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          <label htmlFor={statusId} className="text-subtle-foreground">
            {t("instances.filterStatus")}
          </label>
          <Select
            id={statusId}
            className="w-auto bg-card"
            value={status}
            onChange={(event) => setStatus(event.target.value as Status | "")}
          >
            <option value="">{t("common.all")}</option>
            <option value="active">{t("instances.status.active")}</option>
            <option value="inactive">{t("instances.status.inactive")}</option>
            <option value="empty">{t("instances.status.empty")}</option>
          </Select>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {(["instance", "version", "access", "status", "content", "created"] as const).map(
                (column) => (
                  <th key={column} scope="col" className="border-b px-4 py-3 font-semibold">
                    {t(`instances.column.${column}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((instance) => (
              <InstanceRow key={instance.id} instance={instance}>
                <td className="border-b border-[#2a1d33] px-4 py-3.5">
                  <Link
                    to="/admin/instances/$id"
                    params={{ id: instance.id }}
                    className="flex items-center gap-3 text-foreground no-underline hover:text-foreground"
                  >
                    <InstanceIcon instance={instance} />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold">{instance.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{instance.id}</span>
                    </span>
                  </Link>
                </td>
                <td className="border-b border-[#2a1d33] px-4 py-3.5">
                  {versionLabel({
                    mcVersion: instance.minecraft.version,
                    loader: instance.loader.type,
                    loaderVersion: instance.loader.version,
                  })}
                </td>
                <td className="border-b border-[#2a1d33] px-4 py-3.5">
                  {t(`instances.access.${instance.access}`)}
                </td>
                <td className="border-b border-[#2a1d33] px-4 py-3.5">
                  <StatusBadge instance={instance} />
                </td>
                <td className="border-b border-[#2a1d33] px-4 py-3.5 text-subtle-foreground">
                  {instance.contentVersion === 0 || !instance.contentUpdatedAt
                    ? t("instances.notApplied")
                    : `v${instance.contentVersion} · ${formatRelative(new Date(instance.contentUpdatedAt), language)}`}
                </td>
                <td className="border-b border-[#2a1d33] px-4 py-3.5 text-muted-foreground">
                  {formatDate(new Date(instance.createdAt), language)}
                </td>
              </InstanceRow>
            ))}
          </tbody>
        </table>
        {instances.isSuccess && rows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-muted-foreground">
            {instances.data.length === 0 ? t("instances.empty") : t("instances.noMatches")}
          </p>
        ) : null}
      </Card>
      <p className="m-0 text-[13px] text-muted-foreground">{t("instances.hint")}</p>
    </div>
  );
}

/** A table row that opens the instance from anywhere on it (cmd/ctrl-click: in a new tab). */
function InstanceRow({ instance, children }: { instance: Instance; children: ReactNode }) {
  const navigate = useNavigate();
  const row = clickableRow((event) => {
    if (event.metaKey || event.ctrlKey) {
      window.open(`/admin/instances/${encodeURIComponent(instance.id)}`, "_blank", "noopener");
    } else {
      void navigate({ to: "/admin/instances/$id", params: { id: instance.id } });
    }
  });
  return (
    <tr className={cn(row.className, "hover:bg-accent/40")} onClick={row.onClick}>
      {children}
    </tr>
  );
}
