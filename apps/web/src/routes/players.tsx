import type { PlayerDetail, PlayerSummary } from "@bc-launcher-server/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { clickableRow } from "@/lib/clickable-row";
import { formatDate, formatRelative } from "@/lib/format";
import {
  type AccessScope,
  api,
  blacklistQuery,
  instancesQuery,
  invalidateAccess,
  PLAYERS_PAGE_SIZE,
  type PlayerFilters,
  playerQuery,
  playersPage,
  settingsQuery,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { BanDialog, BlacklistCard, banExpiry, PlayerAvatar, WhitelistCard } from "./access-lists";

type T = ReturnType<typeof useI18n>["t"];

export function PlayersLayout() {
  const { t } = useI18n();
  const total = useQuery({
    queryKey: ["players", "count"],
    queryFn: () => playersPage({}, 0, 1),
  });
  const bans = useQuery(blacklistQuery(null));
  const tabs = [
    {
      to: "/admin/players",
      label: t("players.tab.players", { count: total.data?.total ?? "…" }),
      exact: true,
    },
    { to: "/admin/players/whitelist", label: t("players.tab.whitelist"), exact: false },
    {
      to: "/admin/players/blacklist",
      label: bans.data
        ? t("players.tab.blacklistCount", { count: bans.data.length })
        : t("players.tab.blacklist"),
      exact: false,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("players.title")} description={t("players.description")} />
      <nav
        aria-label={t("players.tabs")}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact }}
            className="-mb-px border-b-2 border-transparent px-3.5 py-2.5 font-medium whitespace-nowrap text-muted-foreground no-underline hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-semibold data-[status=active]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export function OrgWhitelistPage() {
  const { t } = useI18n();
  const settings = useQuery(settingsQuery);
  return (
    <div className="max-w-3xl">
      <WhitelistCard
        scope={null}
        title={t("players.tab.whitelist")}
        note={settings.data?.visibility === "public" ? t("players.whitelistUnused") : undefined}
      />
    </div>
  );
}

export function OrgBlacklistPage() {
  const { t } = useI18n();
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="m-0 text-[13px] text-muted-foreground">{t("players.blacklistHint")}</p>
      <BlacklistCard scope={null} title={t("players.tab.blacklist")} />
    </div>
  );
}

const STATUSES = ["all", "member", "banned", "not_member", "never_joined"] as const;

export function PlayersListPage() {
  const { t } = useI18n();
  const instances = useQuery(instancesQuery);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PlayerFilters>({});
  const [selected, setSelected] = useState<string | null>(null);
  const ids = { search: useId(), status: useId(), instance: useId() };

  // Searching as you type, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => ({ ...f, q: search.trim() || undefined })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);

  const players = useInfiniteQuery({
    queryKey: ["players", "list", filters],
    queryFn: ({ pageParam }) => playersPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page, pages) => {
      const loaded = pages.length * PLAYERS_PAGE_SIZE;
      return loaded < page.total ? loaded : undefined;
    },
  });
  const rows = players.data?.pages.flatMap((page) => page.items) ?? [];
  const launchable = players.data?.pages[0]?.launchableInstances ?? 0;

  const filterClass =
    "h-10 rounded-md border border-border bg-card px-3 text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section
        aria-label={t("players.list")}
        className="flex min-w-0 flex-[3_1_520px] flex-col gap-3"
      >
        <div className="flex flex-wrap gap-2.5">
          <label
            htmlFor={ids.search}
            className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-input-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring"
          >
            <SearchIcon className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("players.search")}</span>
            <input
              id={ids.search}
              type="search"
              placeholder={t("players.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none"
            />
          </label>
          <label htmlFor={ids.status} className="sr-only">
            {t("players.filterStatus")}
          </label>
          <select
            id={ids.status}
            className={filterClass}
            value={filters.status ?? "all"}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value as PlayerFilters["status"] })
            }
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {t("players.filterStatus")}: {t(`players.status.${status}`)}
              </option>
            ))}
          </select>
          <label htmlFor={ids.instance} className="sr-only">
            {t("players.filterInstance")}
          </label>
          <select
            id={ids.instance}
            className={filterClass}
            value={filters.instance ?? ""}
            onChange={(event) =>
              setFilters({ ...filters, instance: event.target.value || undefined })
            }
          >
            <option value="">
              {t("players.filterInstance")}: {t("players.allInstances")}
            </option>
            {instances.data?.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {t("players.filterInstance")}: {instance.name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {(["player", "lastSeen", "instances", "status"] as const).map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-border px-4 py-3 font-semibold"
                  >
                    {t(`players.column.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((player) => (
                <PlayerRow
                  key={player.uuid}
                  player={player}
                  launchable={launchable}
                  selected={selected === player.uuid}
                  onSelect={() => setSelected(player.uuid)}
                />
              ))}
            </tbody>
          </table>
          {players.isSuccess && rows.length === 0 ? (
            <p className="m-0 px-4 py-5 text-muted-foreground">
              {filters.q || filters.instance || (filters.status && filters.status !== "all")
                ? t("players.noMatches")
                : t("players.empty")}
            </p>
          ) : null}
        </div>
        {players.hasNextPage ? (
          <Button
            variant="outline"
            className="self-center"
            onClick={() => players.fetchNextPage()}
            disabled={players.isFetchingNextPage}
          >
            {t("common.loadMore")}
          </Button>
        ) : null}
      </section>

      {selected ? <PlayerSheet uuid={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function statusBadge(player: PlayerSummary, t: T) {
  if (player.status === "banned") {
    return <Badge variant="destructive">{t("players.badge.banned")}</Badge>;
  }
  if (player.status === "not_member") {
    return <Badge variant="muted">{t("players.badge.notMember")}</Badge>;
  }
  if (player.instanceBans > 0) {
    return (
      <Badge variant="warning">
        {player.instanceBans === 1
          ? t("players.badge.instanceBan")
          : t("players.badge.instanceBans", { count: player.instanceBans })}
      </Badge>
    );
  }
  if (!player.firstSeenAt) return <Badge variant="muted">{t("players.badge.neverJoined")}</Badge>;
  return <Badge variant="success">{t("players.badge.member")}</Badge>;
}

const shortUuid = (uuid: string) => `${uuid.slice(0, 4)}…${uuid.slice(-4)}`;

function PlayerRow({
  player,
  launchable,
  selected,
  onSelect,
}: {
  player: PlayerSummary;
  launchable: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, language } = useI18n();
  const cell = "border-b border-[#2a1d33] px-4 py-3";
  const row = clickableRow(onSelect);
  return (
    <tr
      className={cn(row.className, selected ? "bg-secondary" : "hover:bg-accent/40")}
      onClick={row.onClick}
    >
      <td className={cell}>
        <span className="flex items-center gap-2.5">
          <PlayerAvatar name={player.name} banned={player.status === "banned"} />
          <span className="flex min-w-0 flex-col">
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className="cursor-pointer truncate border-0 bg-transparent p-0 text-left font-medium text-foreground hover:text-link focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {player.name}
            </button>
            <span className="font-mono text-[11px] text-muted-foreground">
              {player.firstSeenAt ? shortUuid(player.uuid) : "—"}
            </span>
          </span>
        </span>
      </td>
      <td className={`${cell} text-subtle-foreground`}>
        {player.lastSeenAt
          ? formatRelative(new Date(player.lastSeenAt), language)
          : t("players.never")}
      </td>
      <td className={`${cell} text-subtle-foreground`}>
        {player.status === "member" && player.firstSeenAt
          ? t("players.instancesOf", { count: player.playableInstances, total: launchable })
          : "—"}
      </td>
      <td className={cell}>{statusBadge(player, t)}</td>
    </tr>
  );
}

function PlayerSheet({ uuid, onClose }: { uuid: string; onClose: () => void }) {
  const { t, language } = useI18n();
  const player = useQuery(playerQuery(uuid));
  const headingId = useId();
  const data = player.data;

  return (
    <aside
      aria-labelledby={headingId}
      className="flex min-w-0 flex-[2_1_340px] flex-col gap-[18px] rounded-xl border border-[#4a3556] bg-card p-5"
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar
          name={data?.name ?? "?"}
          banned={data?.organization.status === "banned"}
          className="size-12 rounded-lg text-lg"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={headingId} className="m-0 truncate text-lg font-bold">
            {data?.name ?? "…"}
          </h2>
          <span className="font-mono text-[11px] break-all text-muted-foreground">{uuid}</span>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label={t("players.closeSheet")}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {data ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-2.5 text-[13px]">
            <div>
              <dt className="text-muted-foreground">{t("players.firstSeen")}</dt>
              <dd className="m-0 mt-0.5">
                {data.firstSeenAt
                  ? formatDate(new Date(data.firstSeenAt), language)
                  : t("players.never")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("players.lastSeen")}</dt>
              <dd className="m-0 mt-0.5">
                {data.lastSeenAt
                  ? formatRelative(new Date(data.lastSeenAt), language)
                  : t("players.never")}
              </dd>
            </div>
          </dl>
          <OrganizationAccess player={data} />
          <InstancesAccess player={data} />
          <BanDialog
            player={{ uuid: data.uuid, name: data.name }}
            instances={data.instances.map((instance) => ({ id: instance.id, name: instance.name }))}
            trigger={
              <Button
                variant="outline"
                className="border-[#7f1d1d] text-destructive-foreground hover:text-destructive-foreground"
              >
                {t("players.banEllipsis")}
              </Button>
            }
          />
        </>
      ) : null}
    </aside>
  );
}

/** Lifts a ban or toggles a whitelist entry, then refreshes everything that shows access. */
function useAccessAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSettled: () => invalidateAccess(queryClient),
  });
}

const rowClass =
  "flex items-center justify-between gap-2.5 rounded-md border bg-input-background px-3 py-2.5";

function SmallButton(props: React.ComponentProps<typeof Button>) {
  return <Button variant="outline" size="sm" className="h-8 flex-none px-2.5 text-xs" {...props} />;
}

function OrganizationAccess({ player }: { player: PlayerDetail }) {
  const { t, language } = useI18n();
  const action = useAccessAction();
  const headingId = useId();
  const { organization } = player;
  const isPrivate = organization.visibility === "private";
  const whitelistToggle = (scope: AccessScope, listed: boolean) =>
    action.mutate(() =>
      listed ? api.removeFromWhitelist(scope, player.uuid) : api.addToWhitelist(scope, player.uuid),
    );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="m-0 text-[13px] font-semibold text-muted-foreground uppercase">
        {t("players.organization")}
      </h3>
      {organization.ban ? (
        <div className={cn(rowClass, "border-[#5b2730]")}>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{t("players.orgBanned")}</span>
            <span className="text-xs text-destructive-foreground">
              {[
                banExpiry(organization.ban.expiresAt, t, language),
                organization.ban.reason
                  ? t("ban.quotedReason", { reason: organization.ban.reason })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <SmallButton
            disabled={action.isPending}
            onClick={() => action.mutate(() => api.unban(null, player.uuid))}
          >
            {t("ban.unban")}
          </SmallButton>
        </div>
      ) : null}
      {organization.ban && !isPrivate ? null : (
        <div className={cn(rowClass, "border-border")}>
          <span className="flex min-w-0 flex-col">
            <span>
              {organization.status === "member" ? t("players.member") : t("players.notMember")}{" "}
              <span className="text-muted-foreground">
                {isPrivate
                  ? organization.whitelisted
                    ? t("players.privateListed")
                    : t("players.privateNotListed")
                  : t("players.publicOrg")}
              </span>
            </span>
          </span>
          {isPrivate ? (
            <SmallButton
              disabled={action.isPending}
              onClick={() => whitelistToggle(null, organization.whitelisted)}
            >
              {organization.whitelisted
                ? t("players.removeFromWhitelist")
                : t("players.addToWhitelist")}
            </SmallButton>
          ) : (
            <span
              className={cn(
                "text-xs font-semibold",
                organization.status === "member" ? "text-success" : "text-destructive-foreground",
              )}
            >
              {organization.status === "member" ? t("players.hasAccess") : t("players.noAccess")}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function InstancesAccess({ player }: { player: PlayerDetail }) {
  const { t, language } = useI18n();
  const action = useAccessAction();
  const headingId = useId();
  if (player.instances.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="m-0 text-[13px] font-semibold text-muted-foreground uppercase">
        {t("players.instances")}
      </h3>
      {player.instances.map((instance) => {
        const mode =
          instance.access === "everyone"
            ? t("instanceAccess.everyone")
            : instance.whitelisted
              ? t("players.inWhitelist")
              : t("players.notInWhitelist");
        let detail = mode;
        let control: React.ReactNode;
        if (instance.ban) {
          detail = [
            t("players.instanceBanned", { until: banExpiry(instance.ban.expiresAt, t, language) }),
            instance.ban.reason ? t("ban.quotedReason", { reason: instance.ban.reason }) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          control = (
            <SmallButton
              disabled={action.isPending}
              onClick={() => action.mutate(() => api.unban(instance.id, player.uuid))}
            >
              {t("ban.unban")}
            </SmallButton>
          );
        } else if (instance.access === "whitelist") {
          control = (
            <SmallButton
              disabled={action.isPending}
              onClick={() =>
                action.mutate(() =>
                  instance.whitelisted
                    ? api.removeFromWhitelist(instance.id, player.uuid)
                    : api.addToWhitelist(instance.id, player.uuid),
                )
              }
            >
              {instance.whitelisted
                ? t("players.removeFromWhitelist")
                : t("players.addToWhitelist")}
            </SmallButton>
          );
        } else {
          control = (
            <span
              className={cn(
                "text-xs font-semibold",
                instance.visible ? "text-success" : "text-muted-foreground",
              )}
            >
              {instance.visible
                ? t("players.visible")
                : instance.launchable
                  ? t("players.hidden")
                  : t("players.notLaunchable")}
            </span>
          );
        }
        return (
          <div
            key={instance.id}
            className={cn(rowClass, instance.ban ? "border-[#5b2730]" : "border-border")}
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{instance.name}</span>
              <span
                className={cn(
                  "text-xs",
                  instance.ban ? "text-destructive-foreground" : "text-muted-foreground",
                )}
              >
                {detail}
              </span>
            </span>
            {control}
          </div>
        );
      })}
    </section>
  );
}
