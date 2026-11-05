import type { Instance } from "@bc-launcher-server/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { InstanceIcon } from "@/components/instance-icon";
import { Card } from "@/components/ui/card";
import { versionLabel } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { formatRelative } from "@/lib/format";
import { activityPage, instancesQuery, organizationQuery, playersPage } from "@/lib/queries";
import { PlayerAvatar } from "./access-lists";
import { StatusBadge } from "./instances";
import { NewInstanceDialog } from "./new-instance-dialog";
import { DOT, describe } from "./settings-activity";

const RECENT = 5;

export function HomePage() {
  const { t } = useI18n();
  const organization = useQuery(organizationQuery);
  const instances = useQuery(instancesQuery);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-bold">{t("home.title")}</h1>
          <p className="m-0 text-muted-foreground">
            {t("home.subtitle", { name: organization.data?.name ?? "…" })}
          </p>
        </div>
        <NewInstanceDialog />
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
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
            {instances.data?.map((instance) => (
              <InstanceCard key={instance.id} instance={instance} />
            ))}
          </div>
        )}
      </section>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-4">
        <RecentPlayers />
        <RecentActivity />
      </div>
    </div>
  );
}

function InstanceCard({ instance }: { instance: Instance }) {
  const { t, language } = useI18n();
  const launchable = instance.isActive && instance.contentVersion > 0;
  const footer = !instance.isActive
    ? t("home.hidden")
    : instance.contentUpdatedAt
      ? t(instance.contentUpdatedBy ? "home.appliedBy" : "home.applied", {
          when: formatRelative(new Date(instance.contentUpdatedAt), language),
          admin: instance.contentUpdatedBy?.username ?? "",
        })
      : t("instances.notApplied");

  return (
    <Link
      to="/admin/instances/$id"
      params={{ id: instance.id }}
      className="flex flex-col gap-3.5 rounded-xl border border-border bg-card p-[18px] text-foreground no-underline hover:border-input hover:text-foreground"
    >
      <span className="flex items-center gap-3">
        <InstanceIcon instance={instance} className="size-11 rounded-[10px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold">{instance.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{instance.id}</span>
        </span>
        <StatusBadge instance={instance} />
      </span>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
        <div>
          <dt className="text-muted-foreground">{t("instances.column.version")}</dt>
          <dd className="m-0 mt-0.5">
            {versionLabel({
              mcVersion: instance.minecraft.version,
              loader: instance.loader.type,
              loaderVersion: instance.loader.version,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("instances.column.content")}</dt>
          <dd className="m-0 mt-0.5">
            {instance.contentVersion > 0
              ? t("home.contentShort", {
                  version: instance.contentVersion,
                  files: instance.fileCount,
                })
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("instances.column.access")}</dt>
          <dd className="m-0 mt-0.5">{t(`instances.access.${instance.access}`)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("home.playersWithAccess")}</dt>
          <dd className="m-0 mt-0.5">{launchable ? instance.playersWithAccess : "—"}</dd>
        </div>
      </dl>
      <p className="m-0 border-t border-border pt-3 text-xs text-muted-foreground">{footer}</p>
    </Link>
  );
}

function RecentPlayers() {
  const { t, language } = useI18n();
  const players = useQuery({
    queryKey: ["players", "recent"],
    queryFn: () => playersPage({ status: "joined" }, 0, RECENT),
  });

  return (
    <Card role="region" aria-labelledby="home-players" className="flex flex-col gap-3 p-[18px]">
      <div className="flex items-center justify-between">
        <h2 id="home-players" className="m-0 text-base font-semibold">
          {t("home.recentPlayers")}
        </h2>
        <Link to="/admin/players" className="text-[13px]">
          {t("home.allPlayers")}
        </Link>
      </div>
      {players.data?.items.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("home.noPlayers")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {players.data?.items.map((player) => (
            <li
              key={player.uuid}
              className="flex items-center gap-3 border-t border-[#2a1d33] py-2"
            >
              <PlayerAvatar
                uuid={player.uuid}
                name={player.name}
                banned={player.status === "banned"}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{player.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {player.lastSeenAt ? formatRelative(new Date(player.lastSeenAt), language) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentActivity() {
  const { t, language } = useI18n();
  const activity = useQuery({
    queryKey: ["activity", "recent"],
    queryFn: () => activityPage({}, undefined, RECENT),
  });

  return (
    <Card role="region" aria-labelledby="home-activity" className="flex flex-col gap-3 p-[18px]">
      <div className="flex items-center justify-between">
        <h2 id="home-activity" className="m-0 text-base font-semibold">
          {t("home.recentActivity")}
        </h2>
        <Link to="/admin/settings/activity" className="text-[13px]">
          {t("home.allActivity")}
        </Link>
      </div>
      {activity.data?.items.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("activity.empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {activity.data?.items.map((entry) => {
            const { text } = describe(entry, t, language);
            const type = entry.action.split(".")[0] ?? "";
            return (
              <li key={entry.id} className="flex gap-3 border-t border-[#2a1d33] py-2">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 flex-none rounded-full ${DOT[type] ?? "bg-muted-foreground"}`}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span>
                    <strong className="font-semibold">
                      {entry.admin?.username ?? t("activity.removedAdmin")}
                    </strong>{" "}
                    {text}
                  </span>
                  <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">
                    {formatRelative(new Date(entry.createdAt), language)}
                  </time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
