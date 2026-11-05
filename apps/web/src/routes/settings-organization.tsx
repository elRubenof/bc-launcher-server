import type {
  OrganizationSettings,
  UpdateOrganizationSettings,
} from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ChoiceCard } from "@/components/choice-card";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import {
  api,
  invalidateAccess,
  meQuery,
  organizationQuery,
  playersPage,
  settingsQuery,
} from "@/lib/queries";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

interface FormState {
  name: string;
  description: string;
  discordUrl: string;
  webUrl: string;
  visibility: "public" | "private";
  minLauncherVersion: string;
}

const toForm = (settings: OrganizationSettings): FormState => ({
  name: settings.name,
  description: settings.description ?? "",
  discordUrl: settings.discordUrl ?? "",
  webUrl: settings.webUrl ?? "",
  visibility: settings.visibility,
  minLauncherVersion: settings.minLauncherVersion ?? "",
});

const orNull = (value: string) => value.trim() || null;

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function SettingsOrganizationPage() {
  const settings = useQuery(settingsQuery);
  if (!settings.data) return null;
  return <OrganizationForm settings={settings.data} />;
}

function OrganizationForm({ settings }: { settings: OrganizationSettings }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  // Editors can see the settings but not change them.
  const readOnly = me.data?.role === "editor";
  const [form, setForm] = useState(() => toForm(settings));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [whitelistJoined, setWhitelistJoined] = useState(true);
  const descriptionId = useId();
  const goingPrivate = settings.visibility === "public" && form.visibility === "private";
  const joined = useQuery({
    queryKey: ["players", "joined-count"],
    queryFn: () => playersPage({ status: "joined" }, 0, 1),
    enabled: settings.visibility === "public" && !readOnly,
  });
  const joinedCount = joined.data?.total ?? 0;

  useEffect(() => setForm(toForm(settings)), [settings]);

  const onSaved = (next: OrganizationSettings) => {
    queryClient.setQueryData(settingsQuery.queryKey, next);
    void queryClient.invalidateQueries({ queryKey: organizationQuery.queryKey });
  };

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (next) => {
      onSaved(next);
      void invalidateAccess(queryClient);
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    save.reset();
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = t("org.nameRequired");
    for (const key of ["discordUrl", "webUrl"] as const) {
      if (form[key].trim() && !isHttpUrl(form[key].trim())) next[key] = t("org.invalidUrl");
    }
    if (form.minLauncherVersion.trim() && !VERSION_PATTERN.test(form.minLauncherVersion.trim())) {
      next.minLauncherVersion = t("org.invalidVersion");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const update: UpdateOrganizationSettings = {
      name: form.name.trim(),
      description: orNull(form.description),
      discordUrl: orNull(form.discordUrl),
      webUrl: orNull(form.webUrl),
      visibility: form.visibility,
      minLauncherVersion: orNull(form.minLauncherVersion),
      ...(goingPrivate && joinedCount > 0 ? { whitelistJoinedPlayers: whitelistJoined } : {}),
    };
    save.mutate(update);
  }

  const deepLink = `bclauncher://add?server=${settings.publicUrl}`;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="m-0 grid min-w-0 gap-5 border-0 p-0 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("org.identity")}</h2>
          <FormField
            label={t("org.name")}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            error={errors.name}
            maxLength={100}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>{t("org.description")}</Label>
            <Textarea
              id={descriptionId}
              rows={3}
              maxLength={500}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <LogoPicker url={settings.logoUrl} name={settings.name} onChange={onSaved} />
          <p className="m-0 mt-auto text-xs text-muted-foreground">{t("org.identityHint")}</p>
        </Card>

        <Card className="flex flex-col gap-3.5 p-[22px]">
          <fieldset className="m-0 flex flex-col gap-3.5 border-0 p-0">
            <legend className="mb-3.5 p-0 text-base font-semibold">{t("org.visibility")}</legend>
            {(["public", "private"] as const).map((visibility) => (
              <ChoiceCard
                key={visibility}
                name="visibility"
                value={visibility}
                checked={form.visibility === visibility}
                onChange={() => set("visibility", visibility)}
                title={t(`org.visibility.${visibility}`)}
                description={t(`org.visibility.${visibility}Hint`)}
              />
            ))}
          </fieldset>
          {goingPrivate && joinedCount > 0 ? (
            <label className="flex cursor-pointer gap-2.5 rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px] leading-normal">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={whitelistJoined}
                onChange={(event) => setWhitelistJoined(event.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">
                  {joinedCount === 1
                    ? t("org.whitelistJoined.one")
                    : t("org.whitelistJoined", { count: joinedCount })}
                </span>
                <span className="text-muted-foreground">{t("org.whitelistJoinedHint")}</span>
              </span>
            </label>
          ) : settings.visibility === "public" && joinedCount > 0 ? (
            <p
              role="note"
              className="m-0 rounded-md border border-border bg-input-background p-3 text-[13px] leading-normal text-subtle-foreground"
            >
              {joinedCount === 1
                ? t("org.goingPrivateNote.one")
                : t("org.goingPrivateNote", { count: joinedCount })}
            </p>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("org.links")}</h2>
          <FormField
            label={t("org.discord")}
            type="url"
            placeholder="https://discord.gg/…"
            value={form.discordUrl}
            onChange={(event) => set("discordUrl", event.target.value)}
            error={errors.discordUrl}
          />
          <FormField
            label={t("org.web")}
            type="url"
            placeholder="https://…"
            value={form.webUrl}
            onChange={(event) => set("webUrl", event.target.value)}
            error={errors.webUrl}
          />
          <p className="m-0 mt-auto text-xs text-muted-foreground">{t("org.linksHint")}</p>
        </Card>

        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("org.download")}</h2>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">{t("org.publicUrl")}</span>
            <div className="flex gap-2">
              <span className="flex h-10 min-w-0 flex-1 items-center truncate rounded-md border border-border bg-sidebar px-3 font-mono text-[13px] text-subtle-foreground">
                {settings.publicUrl}
              </span>
              <Button asChild variant="outline">
                <a href="/" target="_blank" rel="noreferrer">
                  {t("org.viewPage")}
                </a>
              </Button>
            </div>
            <span className="text-xs break-all text-muted-foreground">
              {t("org.deepLink")} <span className="font-mono">{deepLink}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">{t("org.launcherDownloads")}</span>
            <span className="text-subtle-foreground">{t("org.launcherDownloadsValue")}</span>
          </div>
          <FormField
            label={t("org.minLauncherVersion")}
            hint={t("org.minLauncherVersionHint")}
            placeholder="2.0.0"
            className="font-mono text-[13px]"
            value={form.minLauncherVersion}
            onChange={(event) => set("minLauncherVersion", event.target.value)}
            error={errors.minLauncherVersion}
          />
        </Card>
      </fieldset>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {save.isSuccess ? <span className="text-success">{t("common.saved")}</span> : null}
          {save.isError ? (
            <span className="text-destructive-foreground">{t("common.unexpectedError")}</span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setForm(toForm(settings));
              setErrors({});
              save.reset();
            }}
          >
            {t("common.discard")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("common.saveChanges")}
          </Button>
        </div>
      )}
    </form>
  );
}

function LogoPicker({
  url,
  name,
  onChange,
}: {
  url: string | null;
  name: string;
  onChange: (settings: OrganizationSettings) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadLogo(file),
    onSuccess: onChange,
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === "image_too_large"
          ? t("org.imageTooLarge")
          : err instanceof ApiError && err.code === "invalid_image"
            ? t("org.imageInvalid")
            : t("common.unexpectedError"),
      ),
  });
  const remove = useMutation({ mutationFn: () => api.removeLogo(), onSuccess: onChange });
  const label = t("org.logo");

  return (
    <div className="flex items-center gap-3">
      <BrandMark name={name} logoUrl={url} className="size-14 rounded-xl" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{label}</span>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
            aria-label={`${t("common.change")}: ${label}`}
          >
            {t("common.change")}
          </Button>
          {url ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              aria-label={`${t("common.remove")}: ${label}`}
            >
              {t("common.remove")}
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError(undefined);
            if (file.size > 2 * 1024 * 1024) return setError(t("org.imageTooLarge"));
            upload.mutate(file);
          }}
        />
        {error ? (
          <Alert variant="destructive" className="p-2">
            {error}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
