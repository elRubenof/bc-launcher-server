import { useMutation } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/queries";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

export function ChangePasswordDialog({ trigger }: { trigger?: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string>();

  const change = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setRepeat("");
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === "wrong_password"
          ? t("password.wrongCurrent")
          : t("common.unexpectedError"),
      ),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      change.reset();
      setError(undefined);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(t("auth.passwordTooShort"));
    if (newPassword !== repeat) return setError(t("auth.passwordsDontMatch"));
    setError(undefined);
    change.mutate({ currentPassword, newPassword });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" className="justify-start">
            <KeyRoundIcon aria-hidden="true" />
            {t("account.changePassword")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle>{t("password.title")}</DialogTitle>
          <DialogDescription>{t("password.description")}</DialogDescription>
        </div>
        {change.isSuccess ? (
          <>
            <p className="m-0 text-success">{t("password.changed")}</p>
            <DialogClose asChild>
              <Button>{t("common.close")}</Button>
            </DialogClose>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              label={t("password.current")}
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <FormField
              label={t("password.new")}
              hint={t("auth.passwordHint")}
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <FormField
              label={t("password.repeat")}
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
              required
            />
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={change.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
