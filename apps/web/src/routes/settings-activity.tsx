import type { ActivityEntry } from "@bc-launcher-server/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type MessageKey, useI18n } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { type ActivityFilters, activityPage, adminsQuery } from "@/lib/queries";

const TYPES = ["admin", "org", "instance"] as const;

const DOT: Record<string, string> = {
  admin: "bg-warning",
  org: "bg-link",
  instance: "bg-success",
};

export function SettingsActivityPage() {
  const { t } = useI18n();
  const admins = useQuery(adminsQuery);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const adminFilterId = useId();
  const typeFilterId = useId();

  const activity = useInfiniteQuery({
    queryKey: ["activity", filters],
    queryFn: ({ pageParam }) => activityPage(filters, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
  const entries = activity.data?.pages.flatMap((page) => page.items) ?? [];

  const selectClass =
    "h-[38px] rounded-md border border-border bg-card px-3 text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2.5">
        <div className="flex items-center gap-2">
          <label htmlFor={adminFilterId} className="text-subtle-foreground">
            {t("activity.filterAdmin")}
          </label>
          <select
            id={adminFilterId}
            className={selectClass}
            value={filters.adminId ?? ""}
            onChange={(event) =>
              setFilters({ ...filters, adminId: event.target.value || undefined })
            }
          >
            <option value="">{t("common.all")}</option>
            {admins.data?.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {admin.username}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={typeFilterId} className="text-subtle-foreground">
            {t("activity.filterType")}
          </label>
          <select
            id={typeFilterId}
            className={selectClass}
            value={filters.type ?? ""}
            onChange={(event) => setFilters({ ...filters, type: event.target.value || undefined })}
          >
            <option value="">{t("common.all")}</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`activity.type.${type}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card className="px-[22px] py-2" aria-label={t("activity.log")} role="region">
        {activity.isSuccess && entries.length === 0 ? (
          <p className="my-4 text-muted-foreground">{t("activity.empty")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </Card>

      {activity.hasNextPage ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => activity.fetchNextPage()}
          disabled={activity.isFetchingNextPage}
        >
          {t("common.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { t, language } = useI18n();
  const { text, detail } = describe(entry, t);
  const type = entry.action.split(".")[0] ?? "";

  return (
    <li className="flex gap-3.5 border-b border-[#2a1d33] py-4 last:border-b-0">
      <span
        aria-hidden="true"
        className={`mt-[5px] size-2.5 shrink-0 rounded-full ${DOT[type] ?? "bg-muted-foreground"}`}
      />
      <div className="flex min-w-0 flex-1 flex-wrap justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span>
            <strong>{entry.admin?.username ?? t("activity.removedAdmin")}</strong> {text}
          </span>
          {detail ? <span className="text-[13px] text-muted-foreground">{detail}</span> : null}
        </span>
        <time dateTime={entry.createdAt} className="text-[13px] text-muted-foreground">
          {formatDateTime(new Date(entry.createdAt), language)}
        </time>
      </div>
    </li>
  );
}

type T = ReturnType<typeof useI18n>["t"];

function fieldList(details: Record<string, unknown>, t: T) {
  const fields = Array.isArray(details.changed) ? (details.changed as string[]) : [];
  return fields.map((field) => t(`field.${field}` as MessageKey)).join(", ");
}

/** Turns an audit log entry into a sentence; unknown actions show their code. */
function describe(entry: ActivityEntry, t: T): { text: string; detail?: string } {
  const details = (entry.details ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof details[key] === "string" ? (details[key] as string) : "");
  const instance = entry.target ?? "";

  switch (entry.action) {
    case "admin.created":
      if (details.setup) return { text: t("action.setup") };
      return {
        text: t("action.admin.created", { username: str("username") }),
        detail: t("action.admin.created.detail", {
          role: t(`role.${str("role") || "editor"}` as MessageKey),
        }),
      };
    case "admin.role_changed":
      return {
        text: t("action.admin.role_changed", { username: str("username") }),
        detail: t("action.admin.role_changed.detail", {
          from: t(`role.${str("from") || "editor"}` as MessageKey),
          to: t(`role.${str("to") || "editor"}` as MessageKey),
        }),
      };
    case "admin.removed":
    case "admin.password_reset":
      return { text: t(`action.${entry.action}`, { username: str("username") }) };
    case "org.settings_changed":
      return {
        text: t("action.org.settings_changed"),
        detail: t("action.org.settings_changed.detail", { fields: fieldList(details, t) }),
      };
    case "instance.updated":
      return {
        text: t("action.instance.updated", { instance }),
        detail: t("action.instance.updated.detail", { fields: fieldList(details, t) }),
      };
    case "instance.content_applied": {
      const counts = (details.counts ?? {}) as Record<string, number>;
      return {
        text: t("action.instance.content_applied", { instance, version: Number(details.to) }),
        detail: t("action.instance.content_applied.detail", {
          added: counts.added ?? 0,
          changed: counts.changed ?? 0,
          removed: counts.removed ?? 0,
        }),
      };
    }
    case "instance.created":
    case "instance.colors_changed":
    case "instance.icon_changed":
    case "instance.icon_removed":
    case "instance.background_changed":
    case "instance.background_reset":
    case "instance.deleted":
      return { text: t(`action.${entry.action}`, { instance }) };
    case "org.visibility_changed":
      return {
        text: t("action.org.visibility_changed"),
        detail: t("action.org.visibility_changed.detail", {
          visibility: t(`visibility.${str("to") || "public"}` as MessageKey),
        }),
      };
    case "admin.password_changed":
    case "org.logo_changed":
    case "org.logo_removed":
    case "org.icon_changed":
    case "org.icon_removed":
      return { text: t(`action.${entry.action}`) };
    default:
      return { text: entry.action };
  }
}
