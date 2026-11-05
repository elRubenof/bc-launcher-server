import {
  type Instance,
  type InstanceColors,
  MAX_BACKGROUND_BYTES,
} from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { InstanceIcon } from "@/components/instance-icon";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { contrastRatio, HEX_COLOR } from "@/lib/contrast";
import { imageErrorKey } from "@/lib/images";
import { api, instanceQuery, instancesQuery } from "@/lib/queries";

const KEYS = ["primary", "primaryDark", "background", "text"] as const;
const MIN_CONTRAST = 4.5;

export function InstanceAppearancePage({ id }: { id: string }) {
  const instance = useQuery(instanceQuery(id));
  return instance.data ? <AppearanceForm instance={instance.data} /> : null;
}

function AppearanceForm({ instance }: { instance: Instance }) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [colors, setColors] = useState<InstanceColors>(instance.colors);
  useEffect(() => setColors(instance.colors), [instance.colors]);

  const onSaved = (next: Instance) => {
    queryClient.setQueryData(instanceQuery(next.id).queryKey, next);
    void queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey, exact: true });
  };
  const save = useMutation({
    mutationFn: () => api.updateColors(instance.id, normalized),
    onSuccess: onSaved,
  });

  const valid = KEYS.every((key) => HEX_COLOR.test(colors[key]));
  const normalized = Object.fromEntries(
    KEYS.map((key) => [key, colors[key].toUpperCase()]),
  ) as InstanceColors;
  // The preview keeps the saved colors while a field holds an invalid value.
  const preview = valid ? normalized : instance.colors;
  const ratio = (a: string, b: string) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(contrastRatio(a, b));
  const checks = [
    { key: "appearance.contrastBackground", a: preview.text, b: preview.background },
    { key: "appearance.contrastPrimary", a: preview.text, b: preview.primary },
  ] as const;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <BackgroundPicker instance={instance} onSaved={onSaved} />

          <Card className="flex flex-col gap-3.5 p-[22px]">
            <h2 className="m-0 text-base font-semibold">
              {t("appearance.colors")}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                {t("appearance.required")}
              </span>
            </h2>
            {KEYS.map((key) => (
              <div key={key} className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label={t(`appearance.color.${key}`)}
                  value={HEX_COLOR.test(colors[key]) ? colors[key].toLowerCase() : "#000000"}
                  onChange={(event) => {
                    setColors({ ...colors, [key]: event.target.value.toUpperCase() });
                    save.reset();
                  }}
                  className="size-10 shrink-0 cursor-pointer rounded-md border border-[#5a4566] bg-transparent p-0.5"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">{t(`appearance.color.${key}`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`appearance.color.${key}Hint`)}
                  </span>
                </span>
                <input
                  type="text"
                  aria-label={`${t(`appearance.color.${key}`)} (hex)`}
                  aria-invalid={HEX_COLOR.test(colors[key]) ? undefined : true}
                  value={colors[key]}
                  maxLength={7}
                  onChange={(event) => {
                    setColors({ ...colors, [key]: event.target.value });
                    save.reset();
                  }}
                  className="h-9 w-[104px] rounded-md border border-input bg-input-background px-2.5 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
                />
              </div>
            ))}
            <div className="flex flex-col gap-2 border-t border-border pt-3.5 text-[13px]">
              {checks.map((check) => {
                const ok = contrastRatio(check.a, check.b) >= MIN_CONTRAST;
                return (
                  <span
                    key={check.key}
                    className={`flex gap-2 ${ok ? "text-success" : "text-warning"}`}
                  >
                    <span aria-hidden="true">{ok ? "✓" : "!"}</span>
                    {t(ok ? check.key : (`${check.key}Low` as const), {
                      ratio: ratio(check.a, check.b),
                    })}
                  </span>
                );
              })}
            </div>
          </Card>
        </div>

        <section
          aria-labelledby="appearance-preview"
          className="flex min-w-0 flex-[2_1_560px] flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <h2 id="appearance-preview" className="m-0 text-base font-semibold">
              {t("appearance.preview")}
            </h2>
            <span className="text-xs text-muted-foreground">{t("appearance.previewHint")}</span>
          </div>
          <LauncherPreview instance={instance} colors={preview} />
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {save.isSuccess ? <span className="text-success">{t("common.saved")}</span> : null}
        {save.isError ? (
          <span className="text-destructive-foreground">{t("common.unexpectedError")}</span>
        ) : null}
        {!valid ? (
          <span className="text-destructive-foreground">{t("appearance.invalidColor")}</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setColors(instance.colors);
            save.reset();
          }}
        >
          {t("common.discard")}
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          {t("appearance.save")}
        </Button>
      </div>
    </form>
  );
}

function BackgroundPicker({
  instance,
  onSaved,
}: {
  instance: Instance;
  onSaved: (i: Instance) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadInstanceImage(instance.id, "background", file),
    onSuccess: onSaved,
    onError: (err) =>
      setError(
        imageErrorKey(err) === "org.imageTooLarge"
          ? t("appearance.backgroundTooLarge")
          : t(imageErrorKey(err)),
      ),
  });
  const reset = useMutation({
    mutationFn: () => api.removeInstanceImage(instance.id, "background"),
    onSuccess: onSaved,
  });

  return (
    <Card className="flex flex-col gap-3 p-[22px]">
      <h2 className="m-0 text-base font-semibold">
        {t("appearance.background")}{" "}
        <span className="text-xs font-medium text-muted-foreground">
          {t("appearance.required")}
        </span>
      </h2>
      <img
        src={instance.backgroundUrl}
        alt={t("appearance.backgroundAlt")}
        className="aspect-video w-full rounded-[10px] border border-border object-cover"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? t("appearance.uploading") : t("appearance.changeImage")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
        >
          {t("appearance.resetBackground")}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">{t("appearance.backgroundHint")}</span>
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
          if (file.size > MAX_BACKGROUND_BYTES) return setError(t("appearance.backgroundTooLarge"));
          upload.mutate(file);
        }}
      />
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </Card>
  );
}

/** A sketch of the launcher's home screen with the instance's background and colors. */
function LauncherPreview({ instance, colors }: { instance: Instance; colors: InstanceColors }) {
  const { t } = useI18n();
  const translucent = `${colors.background}e6`;
  return (
    <div
      role="img"
      aria-label={t("appearance.previewLabel", { name: instance.name })}
      className="flex min-h-[470px] flex-col overflow-hidden rounded-xl border border-border bg-cover bg-center"
      style={{ backgroundImage: `url(${instance.backgroundUrl})`, color: colors.text }}
    >
      <div className="flex h-14 items-center gap-5 px-5" style={{ background: translucent }}>
        <InstanceIcon instance={{ ...instance, colors }} className="size-[30px] text-xs" />
        <span className="font-bold">{instance.name}</span>
        <span
          className="border-b-2 py-[18px] text-[13px] font-semibold"
          style={{ borderColor: colors.primary }}
        >
          {t("appearance.preview.home")}
        </span>
        {instance.tabs.map((tab, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is the order.
          <span key={index} className="text-[13px] opacity-80">
            {tab.label}
          </span>
        ))}
        <span className="text-[13px] opacity-80">{t("appearance.preview.settings")}</span>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3.5 p-6">
        <span className="text-[13px] font-semibold opacity-90">{t("appearance.preview.news")}</span>
        <div className="flex flex-wrap gap-3.5">
          <div
            className="flex flex-[1_1_220px] flex-col gap-2 rounded-[10px] p-3.5"
            style={{ background: translucent }}
          >
            <span className="font-bold">{t("appearance.preview.newsTitle")}</span>
            <span className="text-xs leading-snug opacity-80">
              {t("appearance.preview.newsBody")}
            </span>
            <span
              className="self-start rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{ background: colors.primaryDark }}
            >
              {t("appearance.preview.open")}
            </span>
          </div>
        </div>
      </div>
      <div
        className="flex h-[76px] items-center justify-between gap-4 px-5"
        style={{ background: colors.background }}
      >
        <span className="text-[13px] opacity-80">{t("appearance.preview.player")}</span>
        <span
          className="rounded-lg px-9 py-3 font-bold tracking-wider"
          style={{ background: colors.primary }}
        >
          {t("appearance.preview.play")}
        </span>
      </div>
    </div>
  );
}
