import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { InstanceIcon } from "@/components/instance-icon";
import { Card } from "@/components/ui/card";
import { versionLabel } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { formatRelative } from "@/lib/format";
import { instancesQuery, organizationQuery } from "@/lib/queries";
import { StatusBadge } from "./instances";

export function HomePage() {
  const { t, language } = useI18n();
  const organization = useQuery(organizationQuery);
  const instances = useQuery(instancesQuery);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-[26px] font-bold">{t("home.title")}</h1>
        <p className="m-0 text-muted-foreground">
          {t("home.subtitle", { name: organization.data?.name ?? "…" })}
        </p>
      </header>
      <section aria-labelledby="home-instances" className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <h2 id="home-instances" className="m-0 text-base font-semibold">
            {t("home.instances")}
          </h2>
          <Link to="/admin/instances" className="text-[13px]">
            {t("home.allInstances")}
          </Link>
        </div>
        {instances.data?.length === 0 ? (
          <Card className="p-6 text-muted-foreground">{t("home.noInstances")}</Card>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {instances.data?.map((instance) => (
              <Link
                key={instance.id}
                to="/admin/instances/$id"
                params={{ id: instance.id }}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-[18px] text-foreground no-underline hover:border-input hover:text-foreground"
              >
                <span className="flex items-center gap-3">
                  <InstanceIcon instance={instance} className="size-10" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{instance.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{instance.id}</span>
                  </span>
                  <span className="ml-auto">
                    <StatusBadge instance={instance} />
                  </span>
                </span>
                <span className="text-[13px] text-subtle-foreground">
                  {versionLabel({
                    mcVersion: instance.minecraft.version,
                    loader: instance.loader.type,
                    loaderVersion: instance.loader.version,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {instance.contentVersion > 0 && instance.contentUpdatedAt
                    ? t("home.contentLine", {
                        version: instance.contentVersion,
                        when: formatRelative(new Date(instance.contentUpdatedAt), language),
                        files: instance.fileCount,
                      })
                    : t("instances.notApplied")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
