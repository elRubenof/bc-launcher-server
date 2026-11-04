import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { FormField } from "@/components/form-field";
import { LanguageSelect } from "@/components/language-select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import { api, meQuery, organizationQuery, setupStatusQuery } from "@/lib/queries";
import { MIN_PASSWORD_LENGTH, normalizeUsername, USERNAME_PATTERN } from "@/lib/validation";

type Errors = Partial<Record<"organizationName" | "username" | "password" | "repeat", string>>;

export function SetupPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [organizationName, setOrganizationName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const setup = useMutation({
    mutationFn: api.setup,
    onSuccess: async (admin) => {
      queryClient.setQueryData(meQuery.queryKey, admin);
      queryClient.setQueryData(setupStatusQuery.queryKey, { required: false });
      await queryClient.invalidateQueries({ queryKey: organizationQuery.queryKey });
      await navigate({ to: "/admin" });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!organizationName.trim()) next.organizationName = t("setup.organizationNameRequired");
    if (!USERNAME_PATTERN.test(normalizeUsername(username)))
      next.username = t("auth.invalidUsername");
    if (password.length < MIN_PASSWORD_LENGTH) next.password = t("auth.passwordTooShort");
    else if (password !== repeat) next.repeat = t("auth.passwordsDontMatch");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setup.mutate({ organizationName: organizationName.trim(), username, password });
  }

  const alreadyDone = setup.error instanceof ApiError && setup.error.code === "setup_completed";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Card className="p-6 sm:p-8">
          <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
            <BrandMark />
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 text-[22px] font-bold">{t("setup.title")}</h1>
              <p className="m-0 leading-normal text-muted-foreground">{t("setup.description")}</p>
            </div>
            <FormField
              label={t("setup.organizationName")}
              hint={t("setup.organizationNameHint")}
              error={errors.organizationName}
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              maxLength={100}
              autoFocus
              required
            />
            <FormField
              label={t("auth.username")}
              hint={t("auth.usernameHint")}
              error={errors.username}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <FormField
              label={t("auth.password")}
              hint={t("auth.passwordHint")}
              error={errors.password}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <FormField
              label={t("setup.repeatPassword")}
              error={errors.repeat}
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
              required
            />
            <Alert variant="warning" role="note">
              {t("setup.otherAccountsLater")}
            </Alert>
            {setup.error ? (
              <Alert variant="destructive">
                {alreadyDone ? t("setup.alreadyDone") : t("common.unexpectedError")}
              </Alert>
            ) : null}
            {alreadyDone ? (
              <Button type="button" size="lg" onClick={() => navigate({ to: "/admin/login" })}>
                {t("login.submit")}
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={setup.isPending}>
                {t("setup.submit")}
              </Button>
            )}
          </form>
        </Card>
        <LanguageSelect className="self-end" />
      </div>
    </main>
  );
}
