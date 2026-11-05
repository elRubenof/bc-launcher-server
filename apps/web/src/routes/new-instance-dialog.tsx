import { DEFAULT_INSTANCE_COLORS } from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type VersionChoice, VersionPicker } from "@/components/version-picker";
import { useI18n } from "@/i18n";
import { ApiError } from "@/lib/api";
import { api, instancesQuery, minecraftVersionsQuery } from "@/lib/queries";
import { INSTANCE_ID_PATTERN, slugify } from "@/lib/validation";

const EMPTY = { name: "", id: "", description: "" };

/** "Nueva instancia": name, id and description, then the game version. */
export function NewInstanceDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden="true" />
          {t("instances.new")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")} className="max-w-lg">
        {open ? <Wizard onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Wizard({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState(EMPTY);
  const [idEdited, setIdEdited] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; id?: string }>({});
  const minecraft = useQuery(minecraftVersionsQuery);
  const [version, setVersion] = useState<VersionChoice>({
    mcVersion: "",
    loader: "fabric",
    loaderVersion: null,
  });

  // Start on the newest release once the list arrives.
  const newest = minecraft.data?.versions[0]?.id;
  useEffect(() => {
    if (newest)
      setVersion((current) => (current.mcVersion ? current : { ...current, mcVersion: newest }));
  }, [newest]);
  const onVersionChange = useCallback((next: VersionChoice) => setVersion(next), []);

  const create = useMutation({
    mutationFn: () =>
      api.createInstance({
        id: form.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        ...version,
      }),
    onSuccess: async (instance) => {
      await queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey });
      onDone();
      await navigate({ to: "/admin/instances/$id", params: { id: instance.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "instance_exists") {
        setErrors({ id: t("instances.idTaken") });
        setStep(1);
      }
    },
  });

  function next(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!form.name.trim()) found.name = t("instances.nameRequired");
    if (!INSTANCE_ID_PATTERN.test(form.id)) found.id = t("instances.idInvalid");
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(2);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  const progress = (
    <div className="flex gap-1.5" aria-hidden="true">
      <span className="h-1 flex-1 rounded-sm bg-primary" />
      <span className={`h-1 flex-1 rounded-sm ${step === 2 ? "bg-primary" : "bg-border"}`} />
    </div>
  );
  const stepLabel = (
    <span className="text-xs font-semibold text-muted-foreground">
      {t("instances.step", { step, total: 2 })}
    </span>
  );

  if (step === 1) {
    return (
      <form onSubmit={next} noValidate className="flex flex-col gap-4">
        {progress}
        {stepLabel}
        <DialogTitle className="text-xl font-bold">{t("instances.new")}</DialogTitle>
        <FormField
          label={t("instances.name")}
          value={form.name}
          maxLength={100}
          autoFocus
          error={errors.name}
          onChange={(event) => {
            const name = event.target.value;
            setForm((current) => ({ ...current, name, id: idEdited ? current.id : slugify(name) }));
          }}
        />
        <FormField
          label={t("instances.id")}
          value={form.id}
          maxLength={40}
          className="font-mono text-[13px]"
          error={errors.id}
          hint={t("instances.idHint")}
          onChange={(event) => {
            setIdEdited(true);
            setForm((current) => ({ ...current, id: event.target.value.toLowerCase() }));
          }}
        />
        {errors.id ? null : (
          <p className="-mt-2 m-0 text-xs font-semibold text-warning">
            {t("instances.idPermanent")}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={descriptionId}>{t("instances.description")}</Label>
          <Textarea
            id={descriptionId}
            rows={3}
            maxLength={500}
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{t("common.next")}</Button>
        </div>
      </form>
    );
  }

  const ready =
    version.mcVersion !== "" && (version.loader === "vanilla" || version.loaderVersion !== null);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {progress}
      {stepLabel}
      <DialogTitle className="text-xl font-bold">{t("instances.gameVersion")}</DialogTitle>
      <VersionPicker value={version} onChange={onVersionChange} layout="wizard" />
      <div
        role="note"
        className="flex items-center gap-3 rounded-md border border-border bg-input-background p-3"
      >
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          {[
            DEFAULT_INSTANCE_COLORS.primary,
            DEFAULT_INSTANCE_COLORS.primaryDark,
            DEFAULT_INSTANCE_COLORS.background,
          ].map((color) => (
            <span
              key={color}
              className="size-4 rounded border border-[#5a4566]"
              style={{ background: color }}
            />
          ))}
        </span>
        <span className="text-xs leading-snug text-subtle-foreground">
          {t("instances.defaultAppearance")}
        </span>
      </div>
      <p className="m-0 text-xs leading-snug text-muted-foreground">
        {t("instances.createdEmpty")}
      </p>
      {create.isError &&
      !(create.error instanceof ApiError && create.error.code === "instance_exists") ? (
        <Alert variant="destructive">
          {create.error instanceof ApiError && create.error.code === "invalid_version"
            ? t("version.invalid")
            : create.error instanceof ApiError && create.error.code === "metadata_unavailable"
              ? t("version.metadataUnavailable")
              : t("common.unexpectedError")}
        </Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setStep(1)}>
          {t("common.back")}
        </Button>
        <Button type="submit" disabled={!ready || create.isPending}>
          {t("instances.create")}
        </Button>
      </div>
    </form>
  );
}
