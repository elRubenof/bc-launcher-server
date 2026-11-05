import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { InstanceIcon } from "@/components/instance-icon";
import { Badge } from "@/components/ui/badge";
import { versionLabel } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import { instanceQuery } from "@/lib/queries";
import { StatusBadge } from "../instances";

const TABS = [
  { to: "/admin/instances/$id", labelKey: "instance.tab.general", exact: true },
  { to: "/admin/instances/$id/appearance", labelKey: "instance.tab.appearance", exact: false },
] as const;

export function InstanceLayout({ id }: { id: string }) {
  const { t } = useI18n();
  const instance = useQuery(instanceQuery(id));

  if (instance.error instanceof ApiError && instance.error.status === 404) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="m-0 text-[26px] font-bold">{t("instance.notFound")}</h1>
        <Link to="/admin/instances">{t("instance.backToList")}</Link>
      </div>
    );
  }
  const data = instance.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <nav
          aria-label={t("instance.breadcrumb")}
          className="flex gap-2 text-[13px] text-muted-foreground"
        >
          <Link to="/admin/instances">{t("nav.instances")}</Link>
          <span aria-hidden="true">/</span>
          <span>{data?.name ?? id}</span>
        </nav>
        <div className="flex items-center gap-4">
          {data ? <InstanceIcon instance={data} className="size-14 rounded-xl text-lg" /> : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="m-0 truncate text-[26px] font-bold">{data?.name ?? "…"}</h1>
            {data ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-mono text-xs text-muted-foreground">{data.id}</span>
                <StatusBadge instance={data} />
                <Badge variant="muted">
                  {versionLabel({
                    mcVersion: data.minecraft.version,
                    loader: data.loader.type,
                    loaderVersion: data.loader.version,
                  })}
                </Badge>
                {data.contentVersion > 0 ? (
                  <Badge variant="primary">
                    {t("instance.contentVersion", { version: data.contentVersion })}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <nav
          aria-label={t("instance.tabs")}
          className="flex gap-1 overflow-x-auto border-b border-border"
        >
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              params={{ id }}
              activeOptions={{ exact: tab.exact }}
              className="-mb-px border-b-2 border-transparent px-3.5 py-2.5 font-medium whitespace-nowrap text-muted-foreground no-underline hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-semibold data-[status=active]:text-foreground"
            >
              {t(tab.labelKey)}
            </Link>
          ))}
        </nav>
      </header>
      {data ? <Outlet /> : null}
    </div>
  );
}
