import type { BlacklistEntry, WhitelistEntry } from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type MessageKey, useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  type AccessScope,
  api,
  blacklistQuery,
  invalidateAccess,
  whitelistQuery,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const PLAYER_REF =
  /^([A-Za-z0-9_]{1,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The player's initial in a square, as in the mockups. */
export function PlayerAvatar({
  name,
  banned = false,
  className,
}: {
  name: string;
  banned?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold",
        banned ? "bg-[#3a1f26] text-destructive-foreground" : "bg-border",
        className,
      )}
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

/** A sentence for the API errors of the list endpoints. */
export function accessErrorMessage(error: unknown, t: ReturnType<typeof useI18n>["t"]) {
  const code = error instanceof ApiError ? error.code : "";
  const known = ["player_not_found", "mojang_unavailable", "already_listed", "invalid_expiry"];
  return known.includes(code)
    ? t(`access.error.${code}` as MessageKey)
    : t("common.unexpectedError");
}

/** A whitelist with its add-by-name form. `note` explains when the list has no effect. */
export function WhitelistCard({
  scope,
  note,
  title,
}: {
  scope: AccessScope;
  note?: string | undefined;
  title?: string;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const list = useQuery(whitelistQuery(scope));
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const headingId = useId();
  const inputId = useId();

  const add = useMutation({
    mutationFn: (player: string) => api.addToWhitelist(scope, player),
    onSuccess: () => {
      setName("");
      setError(undefined);
    },
    onError: (err) => setError(accessErrorMessage(err, t)),
    onSettled: () => invalidateAccess(queryClient),
  });
  const remove = useMutation({
    mutationFn: (uuid: string) => api.removeFromWhitelist(scope, uuid),
    onSettled: () => invalidateAccess(queryClient),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const player = name.trim();
    if (!PLAYER_REF.test(player)) return setError(t("access.invalidName"));
    add.mutate(player);
  }

  const meta = (entry: WhitelistEntry) =>
    [
      entry.player.joined ? null : t("access.neverJoined"),
      t("access.addedBy", {
        admin: entry.addedBy?.username ?? t("access.someone"),
        when: formatDate(new Date(entry.createdAt), language),
      }),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-3.5 p-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="m-0 text-base font-semibold">
          {title ?? t("access.whitelist")}{" "}
          {list.data ? (
            <span className="font-medium text-muted-foreground">· {list.data.length}</span>
          ) : null}
        </h2>
        {note ? <Badge variant="muted">{note}</Badge> : null}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Label htmlFor={inputId} className="sr-only">
            {t("access.playerName")}
          </Label>
          <Input
            id={inputId}
            placeholder={t("access.playerName")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="outline" disabled={add.isPending || !name.trim()}>
            {t("access.add")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="m-0 text-[13px] text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </form>
      {list.data?.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("access.whitelistEmpty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {list.data?.map((entry) => (
            <li
              key={entry.player.uuid}
              className="flex items-center gap-3 border-t border-[#2a1d33] py-2"
            >
              <PlayerAvatar name={entry.player.name} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{entry.player.name}</span>
                <span className="text-xs text-muted-foreground">{meta(entry)}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                aria-label={t("access.removeFromWhitelist", { name: entry.player.name })}
                disabled={remove.isPending && remove.variables === entry.player.uuid}
                onClick={() => remove.mutate(entry.player.uuid)}
              >
                {t("common.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "Permanente" or "Hasta el 8 nov 2026". */
export function banExpiry(
  expiresAt: string | null,
  t: ReturnType<typeof useI18n>["t"],
  language: ReturnType<typeof useI18n>["language"],
) {
  return expiresAt
    ? t("ban.until", { date: formatDateTime(new Date(expiresAt), language) })
    : t("ban.permanent");
}

/** A blacklist (active bans) with a button to ban someone by name. */
export function BlacklistCard({ scope, title }: { scope: AccessScope; title?: string }) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const list = useQuery(blacklistQuery(scope));
  const headingId = useId();
  const unban = useMutation({
    mutationFn: (uuid: string) => api.unban(scope, uuid),
    onSettled: () => invalidateAccess(queryClient),
  });

  const meta = (entry: BlacklistEntry) =>
    [
      banExpiry(entry.expiresAt, t, language),
      t("access.by", {
        admin: entry.addedBy?.username ?? t("access.someone"),
        when: formatDate(new Date(entry.createdAt), language),
      }),
    ].join(" · ");

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-3.5 p-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="m-0 text-base font-semibold">
          {title ?? t("access.blacklist")}{" "}
          {list.data ? (
            <span className="font-medium text-muted-foreground">· {list.data.length}</span>
          ) : null}
        </h2>
        <BanDialog
          scope={scope}
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="border-[#7f1d1d] text-destructive-foreground hover:text-destructive-foreground"
            >
              {t("ban.open")}
            </Button>
          }
        />
      </div>
      {list.data?.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("access.blacklistEmpty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {list.data?.map((entry) => (
            <li
              key={entry.player.uuid}
              className="flex items-start gap-3 border-t border-[#2a1d33] py-2.5"
            >
              <PlayerAvatar name={entry.player.name} banned />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="truncate font-medium">{entry.player.name}</span>
                {entry.reason ? (
                  <span className="text-[13px] text-subtle-foreground">
                    {t("ban.quotedReason", { reason: entry.reason })}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">{meta(entry)}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                aria-label={t("ban.unbanPlayer", { name: entry.player.name })}
                disabled={unban.isPending && unban.variables === entry.player.uuid}
                onClick={() => unban.mutate(entry.player.uuid)}
              >
                {t("ban.unban")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const DURATIONS = ["1d", "7d", "30d", "date", "permanent"] as const;
type Duration = (typeof DURATIONS)[number];
const DAYS: Partial<Record<Duration, number>> = { "1d": 1, "7d": 7, "30d": 30 };

/** `datetime-local` value for a date, in local time. */
function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Bans a player. With `player` the dialog is for that player and, with `instances`, lets you pick
 * the organization or one instance; without it, it asks for the name and bans from `scope`.
 */
export function BanDialog({
  trigger,
  scope = null,
  player,
  instances,
  defaultScope,
}: {
  trigger: ReactNode;
  scope?: AccessScope;
  player?: { uuid: string; name: string };
  /** Offer the choice between the organization and these instances. */
  instances?: { id: string; name: string }[];
  defaultScope?: AccessScope;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState<"org" | "instance">(
    (defaultScope ?? scope) === null ? "org" : "instance",
  );
  const [instanceId, setInstanceId] = useState(defaultScope ?? instances?.[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<Duration>("7d");
  const [until, setUntil] = useState(() => localInput(new Date(Date.now() + 7 * 86400_000)));
  const [error, setError] = useState<string>();
  const ids = { name: useId(), reason: useId(), instance: useId(), until: useId() };

  const chosenScope: AccessScope = instances ? (target === "org" ? null : instanceId) : scope;
  const days = DAYS[duration];
  const expiresAt =
    duration === "permanent"
      ? null
      : days
        ? new Date(Date.now() + days * 86400_000)
        : until
          ? new Date(until)
          : null;

  const ban = useMutation({
    mutationFn: () =>
      api.ban(chosenScope, {
        player: player?.uuid ?? name.trim(),
        reason: reason.trim() || null,
        expiresAt: expiresAt?.toISOString() ?? null,
      }),
    onSuccess: () => setOpen(false),
    onError: (err) => setError(accessErrorMessage(err, t)),
    onSettled: () => invalidateAccess(queryClient),
  });

  function reset() {
    setName("");
    setReason("");
    setDuration("7d");
    setError(undefined);
    ban.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!player && !PLAYER_REF.test(name.trim())) return setError(t("access.invalidName"));
    if (duration === "date" && (!expiresAt || expiresAt.getTime() <= Date.now())) {
      return setError(t("access.error.invalid_expiry"));
    }
    if (instances && target === "instance" && !instanceId) return;
    setError(undefined);
    ban.mutate();
  }

  const submitLabel =
    duration === "permanent"
      ? t("ban.submit.permanent")
      : days === 1
        ? t("ban.submit.day")
        : days
          ? t("ban.submit.days", { days })
          : t("ban.submit.until", {
              date: expiresAt ? formatDate(expiresAt, language) : "…",
            });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={t("common.close")} className="max-w-[560px] gap-[18px] p-7">
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle className="text-xl font-bold">
            {player ? t("ban.titleFor", { name: player.name }) : t("ban.title")}
          </DialogTitle>
          {instances ? null : (
            <DialogDescription>
              {chosenScope === null ? t("ban.scope.orgHint") : t("ban.scope.instanceHint")}
            </DialogDescription>
          )}
        </div>
        <form onSubmit={submit} className="flex flex-col gap-[18px]">
          {player ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.name}>{t("access.playerName")}</Label>
              <Input
                id={ids.name}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
          )}

          {instances ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 font-semibold">{t("ban.scope")}</legend>
              <label className="flex cursor-pointer gap-2.5 rounded-md border border-input p-3 has-checked:border-primary has-checked:bg-secondary">
                <input
                  type="radio"
                  name="ban-scope"
                  className="mt-0.5 accent-primary"
                  checked={target === "org"}
                  onChange={() => setTarget("org")}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{t("ban.scope.org")}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {t("ban.scope.orgHint")}
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "flex cursor-pointer gap-2.5 rounded-md border border-input p-3 has-checked:border-primary has-checked:bg-secondary",
                  instances.length === 0 && "cursor-default opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="ban-scope"
                  className="mt-0.5 accent-primary"
                  checked={target === "instance"}
                  disabled={instances.length === 0}
                  onChange={() => setTarget("instance")}
                />
                <span className="flex flex-1 flex-col gap-2">
                  <span className="font-semibold">{t("ban.scope.instance")}</span>
                  <Select
                    id={ids.instance}
                    aria-label={t("ban.instance")}
                    value={instanceId}
                    disabled={instances.length === 0}
                    onChange={(event) => {
                      setInstanceId(event.target.value);
                      setTarget("instance");
                    }}
                    className="h-[38px]"
                  >
                    {instances.map((instance) => (
                      <option key={instance.id} value={instance.id} className="bg-card">
                        {instance.name}
                      </option>
                    ))}
                  </Select>
                  <span className="text-[13px] text-muted-foreground">
                    {t("ban.scope.instanceHint")}
                  </span>
                </span>
              </label>
            </fieldset>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.reason}>
              {t("ban.reason")}{" "}
              <span className="text-[13px] font-normal text-muted-foreground">
                {t("ban.reasonHint")}
              </span>
            </Label>
            <Textarea
              id={ids.reason}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 font-semibold">{t("ban.duration")}</legend>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((option) => (
                <label
                  key={option}
                  className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-input px-3 has-checked:border-primary has-checked:bg-secondary has-focus-visible:ring-2 has-focus-visible:ring-ring"
                >
                  <input
                    type="radio"
                    name="ban-duration"
                    className="accent-primary"
                    checked={duration === option}
                    onChange={() => setDuration(option)}
                  />
                  {t(`ban.duration.${option}`)}
                </label>
              ))}
            </div>
            {duration === "date" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.until} className="sr-only">
                  {t("ban.duration.date")}
                </Label>
                <Input
                  id={ids.until}
                  type="datetime-local"
                  value={until}
                  min={localInput(new Date())}
                  onChange={(event) => setUntil(event.target.value)}
                  className="max-w-64"
                />
              </div>
            ) : null}
            <span className="text-[13px] text-muted-foreground">
              {expiresAt
                ? t("ban.expiresHint", { date: formatDateTime(expiresAt, language) })
                : t("ban.permanentHint")}
            </span>
          </fieldset>

          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              className="bg-[#b91c1c] text-white hover:bg-[#991b1b]"
              disabled={ban.isPending}
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
