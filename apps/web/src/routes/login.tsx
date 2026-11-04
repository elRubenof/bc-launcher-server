import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { api, meQuery, organizationQuery } from "@/lib/queries";

export function LoginPage({ redirectTo }: { redirectTo?: string | undefined }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organization = useQuery(organizationQuery);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: async (admin) => {
      queryClient.setQueryData(meQuery.queryKey, admin);
      // Only same-app paths, never an absolute URL from the query string.
      const target = redirectTo?.startsWith("/admin") ? redirectTo : "/admin";
      await navigate({ to: target });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ username, password });
  }

  const invalid = login.error instanceof ApiError && login.error.code === "invalid_credentials";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Card className="p-6 sm:p-8">
          <form onSubmit={submit} className="flex flex-col gap-[18px]">
            <div className="flex items-center gap-3">
              <BrandMark name={organization.data?.name} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">
                  {organization.data?.name ?? t("common.brand")}
                </span>
                <span className="text-xs text-muted-foreground">{t("login.subtitle")}</span>
              </div>
            </div>
            <h1 className="m-0 text-[22px] font-bold">{t("login.title")}</h1>
            <FormField
              label={t("auth.username")}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
            />
            <FormField
              label={t("auth.password")}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              error={invalid ? t("login.invalidCredentials") : undefined}
              required
            />
            {login.error && !invalid ? (
              <Alert variant="destructive">{t("common.unexpectedError")}</Alert>
            ) : null}
            <Button type="submit" size="lg" disabled={login.isPending}>
              {t("login.submit")}
            </Button>
            <p className="m-0 text-[13px] leading-normal text-muted-foreground">
              {t("login.forgotPassword")}
            </p>
          </form>
        </Card>
        <LanguageSelect className="self-end" />
      </div>
    </main>
  );
}
