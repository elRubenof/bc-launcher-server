import type { Instance, UpdateInstance } from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LockIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { FormField } from "@/components/form-field";
import { InstanceIcon } from "@/components/instance-icon";
import { Alert } from "@/components/ui/alert";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { imageErrorKey } from "@/lib/images";
import { api, instanceQuery, instancesQuery, settingsQuery } from "@/lib/queries";
import { isHttpUrl } from "@/lib/validation";

const RAM_OPTIONS_GB = [2, 3, 4, 5, 6, 8, 10, 12, 16];
const SERVER_ADDRESS = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

interface FormState {
  name: string;
  description: string;
  mapUrl: string;
  discordUrl: string;
  webUrl: string;
  serverAddress: string;
  recommendedRamMb: string;
  isActive: boolean;
}

const toForm = (instance: Instance): FormState => ({
  name: instance.name,
  description: instance.description ?? "",
  mapUrl: instance.mapUrl ?? "",
  discordUrl: instance.discordUrl ?? "",
  webUrl: instance.webUrl ?? "",
  serverAddress: instance.serverAddress ?? "",
  recommendedRamMb: instance.recommendedRamMb ? String(instance.recommendedRamMb) : "",
  isActive: instance.isActive,
});

const orNull = (value: string) => value.trim() || null;

export function InstanceGeneralPage({ id }: { id: string }) {
  const instance = useQuery(instanceQuery(id));
  return instance.data ? <GeneralForm instance={instance.data} /> : null;
}

function useInstanceSaved() {
  const queryClient = useQueryClient();
  return (instance: Instance) => {
    queryClient.setQueryData(instanceQuery(instance.id).queryKey, instance);
    void queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey, exact: true });
  };
}

function GeneralForm({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const onSaved = useInstanceSaved();
  const settings = useQuery(settingsQuery);
  const [form, setForm] = useState(() => toForm(instance));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const descriptionId = useId();
  const ramId = useId();
  const activeId = useId();

  useEffect(() => setForm(toForm(instance)), [instance]);

  const save = useMutation({
    mutationFn: (update: UpdateInstance) => api.updateInstance(instance.id, update),
    onSuccess: onSaved,
  });
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    save.reset();
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!form.name.trim()) found.name = t("instances.nameRequired");
    for (const key of ["mapUrl", "discordUrl", "webUrl"] as const) {
      if (form[key].trim() && !isHttpUrl(form[key].trim())) found[key] = t("org.invalidUrl");
    }
    if (form.serverAddress.trim() && !SERVER_ADDRESS.test(form.serverAddress.trim())) {
      found.serverAddress = t("instance.serverAddressInvalid");
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate({
      name: form.name.trim(),
      description: orNull(form.description),
      mapUrl: orNull(form.mapUrl),
      discordUrl: orNull(form.discordUrl),
      webUrl: orNull(form.webUrl),
      serverAddress: orNull(form.serverAddress),
      recommendedRamMb: form.recommendedRamMb ? Number(form.recommendedRamMb) : null,
      isActive: form.isActive,
    });
  }

  const orgFallback = (value: string | null | undefined) =>
    value ? t("instance.usesOrganization", { value }) : t("instance.noLink");

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("instance.details")}</h2>
          <FormField
            label={t("instances.name")}
            value={form.name}
            maxLength={100}
            error={errors.name}
            onChange={(event) => set("name", event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <span className="font-medium">{t("instances.id")}</span>
            <span className="flex h-10 items-center gap-2 rounded-md border border-border bg-sidebar px-3 font-mono text-[13px] text-muted-foreground">
              <LockIcon className="size-3.5" aria-hidden="true" />
              {instance.id}
            </span>
            <span className="text-xs text-muted-foreground">{t("instance.idLocked")}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>{t("instances.description")}</Label>
            <Textarea
              id={descriptionId}
              rows={3}
              maxLength={500}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <IconPicker instance={instance} onSaved={onSaved} />
        </Card>

        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("instance.links")}</h2>
          <FormField
            label={t("instance.map")}
            type="url"
            placeholder="https://…"
            hint={t("instance.mapHint")}
            value={form.mapUrl}
            error={errors.mapUrl}
            onChange={(event) => set("mapUrl", event.target.value)}
          />
          <FormField
            label={t("org.discord")}
            type="url"
            placeholder={orgFallback(settings.data?.discordUrl)}
            value={form.discordUrl}
            error={errors.discordUrl}
            onChange={(event) => set("discordUrl", event.target.value)}
          />
          <FormField
            label={t("org.web")}
            type="url"
            placeholder={orgFallback(settings.data?.webUrl)}
            value={form.webUrl}
            error={errors.webUrl}
            onChange={(event) => set("webUrl", event.target.value)}
          />
          <p className="m-0 mt-auto text-xs text-muted-foreground">{t("instance.linksHint")}</p>
        </Card>

        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("instance.server")}</h2>
          <FormField
            label={t("instance.serverAddress")}
            placeholder="play.example.com:25565"
            className="font-mono text-[13px]"
            hint={t("instance.serverAddressHint")}
            value={form.serverAddress}
            error={errors.serverAddress}
            onChange={(event) => set("serverAddress", event.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ramId}>{t("instance.ram")}</Label>
            <Select
              id={ramId}
              value={form.recommendedRamMb}
              onChange={(event) => set("recommendedRamMb", event.target.value)}
            >
              <option value="">{t("instance.ramNone")}</option>
              {RAM_OPTIONS_GB.map((gb) => (
                <option key={gb} value={gb * 1024}>
                  {gb} GB
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t("instance.state")}</h2>
          <div className="flex items-center justify-between gap-4">
            <span className="flex flex-col gap-1">
              <span id={activeId} className="font-medium">
                {t("instance.active")}
              </span>
              <span className="text-[13px] text-muted-foreground">{t("instance.activeHint")}</span>
            </span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(checked) => set("isActive", checked)}
              aria-labelledby={activeId}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <span className="flex flex-col gap-1">
              <span className="font-medium text-destructive-foreground">
                {t("instance.delete")}
              </span>
              <span className="text-[13px] text-muted-foreground">{t("instance.deleteHint")}</span>
            </span>
            <DeleteInstanceDialog instance={instance} />
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {save.isSuccess ? <span className="text-success">{t("common.saved")}</span> : null}
        {save.isError ? (
          <span className="text-destructive-foreground">{t("common.unexpectedError")}</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setForm(toForm(instance));
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
    </form>
  );
}

function IconPicker({ instance, onSaved }: { instance: Instance; onSaved: (i: Instance) => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadInstanceImage(instance.id, "icon", file),
    onSuccess: onSaved,
    onError: (err) => setError(t(imageErrorKey(err))),
  });
  const remove = useMutation({
    mutationFn: () => api.removeInstanceImage(instance.id, "icon"),
    onSuccess: onSaved,
  });

  return (
    <div className="flex items-center gap-3.5">
      <InstanceIcon instance={instance} className="size-14 rounded-xl text-base" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{t("org.icon")}</span>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            {t("instance.changeIcon")}
          </Button>
          {instance.iconUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
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

function DeleteInstanceDialog({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const confirmId = useId();
  const remove = useMutation({
    mutationFn: () => api.deleteInstance(instance.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: instanceQuery(instance.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey, exact: true });
      await navigate({ to: "/admin/instances" });
    },
  });

  return (
    <Dialog onOpenChange={() => setConfirm("")}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="border-[#7f1d1d] text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
        >
          {t("instance.deleteButton")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogTitle>{t("instance.deleteTitle", { name: instance.name })}</DialogTitle>
        <DialogDescription>{t("instance.deleteDescription")}</DialogDescription>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={confirmId}>{t("instance.deleteConfirm", { id: instance.id })}</Label>
          <Input
            id={confirmId}
            className="font-mono text-[13px]"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
          />
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
            disabled={confirm !== instance.id || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("instance.deleteButtonConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
