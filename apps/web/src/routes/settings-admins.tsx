import type { AdminListItem } from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ChoiceCard } from "@/components/choice-card";
import { FormField } from "@/components/form-field";
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
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { adminsQuery, api, meQuery } from "@/lib/queries";
import { MIN_PASSWORD_LENGTH, normalizeUsername, USERNAME_PATTERN } from "@/lib/validation";
import { ChangePasswordDialog } from "./change-password-dialog";

const ACTIVE_NOW_MS = 5 * 60 * 1000;

export function SettingsAdminsPage() {
  const { t } = useI18n();
  const admins = useQuery(adminsQuery);
  const me = useQuery(meQuery);
  const isOwner = me.data?.role === "owner";

  return (
    <div className="flex flex-wrap items-start gap-5">
      <Card className="flex min-w-0 flex-[3_1_520px] flex-col p-[22px]">
        <h2 className="m-0 mb-2.5 text-base font-semibold">{t("admins.list")}</h2>
        <ul className="m-0 list-none p-0">
          {admins.data?.map((admin) => (
            <AdminRow
              key={admin.id}
              admin={admin}
              isMe={admin.id === me.data?.id}
              canManage={isOwner}
            />
          ))}
        </ul>
      </Card>
      {isOwner ? <NewAdminForm /> : null}
    </div>
  );
}

function AdminRow({
  admin,
  isMe,
  canManage,
}: {
  admin: AdminListItem;
  isMe: boolean;
  canManage: boolean;
}) {
  const { t, language } = useI18n();
  const lastSeen = admin.lastSeenAt ? new Date(admin.lastSeenAt) : null;
  const status = !lastSeen
    ? t("admins.neverSignedIn")
    : Date.now() - lastSeen.getTime() < ACTIVE_NOW_MS
      ? t("admins.activeNow")
      : t("admins.lastSeen", { when: formatRelative(lastSeen, language) });

  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-[#2a1d33] py-3">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-border font-semibold"
      >
        {admin.username[0]?.toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">
          {admin.username}{" "}
          {isMe ? (
            <span className="font-normal text-muted-foreground">{t("admins.you")}</span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </span>
      <Badge variant={admin.role === "owner" ? "primary" : "muted"}>
        {t(`role.${admin.role}`)}
      </Badge>
      {isMe ? (
        <ChangePasswordDialog
          trigger={
            <Button variant="outline" size="sm">
              {t("admins.changeMyPassword")}
            </Button>
          }
        />
      ) : canManage ? (
        <>
          <ResetPasswordDialog admin={admin} />
          <RemoveAdminDialog admin={admin} />
        </>
      ) : null}
    </li>
  );
}

function ResetPasswordDialog({ admin }: { admin: AdminListItem }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const reset = useMutation({
    mutationFn: () => api.resetAdminPassword(admin.id, password),
    onSuccess: () => setPassword(""),
    onError: () => setError(t("common.unexpectedError")),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t("auth.passwordTooShort"));
    setError(undefined);
    reset.mutate();
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          reset.reset();
          setError(undefined);
          setPassword("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("admins.resetPassword")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle>{t("admins.resetTitle", { username: admin.username })}</DialogTitle>
          <DialogDescription>{t("admins.resetDescription")}</DialogDescription>
        </div>
        {reset.isSuccess ? (
          <>
            <p className="m-0 text-success">{t("admins.resetDone")}</p>
            <DialogClose asChild>
              <Button>{t("common.close")}</Button>
            </DialogClose>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              label={t("password.new")}
              hint={t("auth.passwordHint")}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={reset.isPending}>
                {t("admins.resetPassword")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveAdminDialog({ admin }: { admin: AdminListItem }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.removeAdmin(admin.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminsQuery.queryKey });
      setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) remove.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-[#7f1d1d] text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
        >
          {t("common.remove")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle>{t("admins.removeTitle", { username: admin.username })}</DialogTitle>
          <DialogDescription>{t("admins.removeDescription")}</DialogDescription>
        </div>
        {remove.isError ? <Alert variant="destructive">{t("common.unexpectedError")}</Alert> : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {t("common.remove")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewAdminForm() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"editor" | "owner">("editor");
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});

  const create = useMutation({
    mutationFn: api.createAdmin,
    onSuccess: async () => {
      setUsername("");
      setPassword("");
      setRole("editor");
      await queryClient.invalidateQueries({ queryKey: adminsQuery.queryKey });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "username_taken") {
        setErrors({ username: t("admins.usernameTaken") });
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!USERNAME_PATTERN.test(normalizeUsername(username)))
      next.username = t("auth.invalidUsername");
    if (password.length < MIN_PASSWORD_LENGTH) next.password = t("auth.passwordTooShort");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate({ username, password, role });
  }

  const unexpected =
    create.isError && !(create.error instanceof ApiError && create.error.code === "username_taken");

  return (
    <Card className="min-w-0 flex-[2_1_320px] p-[22px]">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <h2 className="m-0 text-base font-semibold">{t("admins.new")}</h2>
        <FormField
          label={t("auth.username")}
          placeholder={t("admins.usernamePlaceholder")}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            create.reset();
          }}
          error={errors.username}
        />
        <FormField
          label={t("auth.password")}
          hint={t("admins.passwordHint")}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 font-medium">{t("admins.role")}</legend>
          {(["editor", "owner"] as const).map((value) => (
            <ChoiceCard
              key={value}
              name="role"
              value={value}
              checked={role === value}
              onChange={() => setRole(value)}
              title={t(`role.${value}`)}
              description={t(`admins.role.${value}Hint`)}
              className="p-2.5"
            />
          ))}
        </fieldset>
        {create.isSuccess ? (
          <p className="m-0 text-success" role="status">
            {t("admins.created", { username: create.data.username })}
          </p>
        ) : null}
        {unexpected ? <Alert variant="destructive">{t("common.unexpectedError")}</Alert> : null}
        <Button type="submit" disabled={create.isPending}>
          {t("admins.create")}
        </Button>
      </form>
    </Card>
  );
}
