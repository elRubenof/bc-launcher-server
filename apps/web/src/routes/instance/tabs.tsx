import type { Instance, WebTab } from "@bc-launcher-server/contracts";
import {
  isWebTabUrl,
  MAX_WEB_TAB_LABEL,
  MAX_WEB_TABS,
  WEB_TAB_ICONS,
  type WebTabIcon as WebTabIconName,
  withSamplePlayer,
} from "@bc-launcher-server/contracts/web-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  HouseIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { InstanceIcon } from "@/components/instance-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WebTabIcon } from "@/components/web-tab-icon";
import { useI18n } from "@/i18n";
import { api, instanceQuery, instancesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PLACEHOLDERS = ["{uuid}", "{name}"] as const;
const usesPlayer = (url: string) => PLACEHOLDERS.some((placeholder) => url.includes(placeholder));

export function InstanceTabsPage({ id }: { id: string }) {
  const instance = useQuery(instanceQuery(id));
  return instance.data ? <TabsEditor instance={instance.data} /> : null;
}

/** An index in the list, or `"new"` for a tab that isn't saved yet. */
type Selection = number | "new";

function TabsEditor({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const tabs = instance.tabs;
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Until something is picked: the first tab, or a new one when there is none.
  const current =
    selected === "new" || (typeof selected === "number" && selected < tabs.length)
      ? selected
      : tabs.length > 0
        ? 0
        : "new";

  const save = useMutation({
    mutationFn: (next: WebTab[]) => api.updateTabs(instance.id, next),
    onSuccess: (saved) => {
      queryClient.setQueryData(instanceQuery(saved.id).queryKey, saved);
      void queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey, exact: true });
    },
  });

  function move(from: number, to: number) {
    if (to < 0 || to >= tabs.length || from === to) return;
    const next = [...tabs];
    const [tab] = next.splice(from, 1);
    if (!tab) return;
    next.splice(to, 0, tab);
    if (current === from) setSelected(to);
    else if (typeof current === "number") {
      // The selected tab keeps its selection while others move around it.
      const tab = tabs[current];
      setSelected(tab ? next.indexOf(tab) : null);
    }
    save.mutate(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <TabBarPreview instance={instance} />

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="tabs-list"
          className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="tabs-list" className="m-0 text-base font-semibold">
              {t("tabs.listTitle")}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                {t("tabs.count", { count: tabs.length, max: MAX_WEB_TABS })}
              </span>
            </h2>
            <Button
              size="sm"
              disabled={tabs.length >= MAX_WEB_TABS}
              onClick={() => setSelected("new")}
            >
              <PlusIcon aria-hidden="true" />
              {t("tabs.new")}
            </Button>
          </div>
          {tabs.length === 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">{t("tabs.empty")}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {tabs.map((tab, index) => (
                <li
                  // Labels can repeat; a tab is its place in the list.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is the order.
                  key={index}
                  draggable={!save.isPending}
                  onDragStart={(event) => {
                    setDragging(index);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    if (dragging !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging !== null) move(dragging, index);
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn(dragging === index && "opacity-50")}
                >
                  <TabRow
                    tab={tab}
                    selected={current === index}
                    onSelect={() => setSelected(index)}
                    onUp={index > 0 ? () => move(index, index - 1) : undefined}
                    onDown={index < tabs.length - 1 ? () => move(index, index + 1) : undefined}
                    disabled={save.isPending}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 mt-1 text-xs leading-normal text-muted-foreground">
            {t("tabs.listHint")}
          </p>
          {save.isError && current !== "new" ? (
            <p role="alert" className="m-0 text-[13px] text-destructive-foreground">
              {t("common.unexpectedError")}
            </p>
          ) : null}
        </section>

        <TabForm
          // A fresh form for each tab, and again once a move or save lands in the saved list.
          key={current === "new" ? "new" : `${current}:${JSON.stringify(tabs[current])}`}
          tab={current === "new" ? undefined : tabs[current]}
          pending={save.isPending}
          failed={save.isError}
          onSave={(tab) => {
            const next =
              current === "new"
                ? [...tabs, tab]
                : tabs.map((existing, index) => (index === current ? tab : existing));
            save.mutate(next, {
              onSuccess: () => setSelected(current === "new" ? next.length - 1 : current),
            });
          }}
          onRemove={
            current === "new"
              ? undefined
              : () =>
                  save.mutate(
                    tabs.filter((_, index) => index !== current),
                    { onSuccess: () => setSelected(null) },
                  )
          }
          onCancel={() => {
            save.reset();
            setSelected(current === "new" ? null : current);
          }}
          full={current === "new" && tabs.length >= MAX_WEB_TABS}
        />
      </div>
    </div>
  );
}

function TabRow({
  tab,
  selected,
  onSelect,
  onUp,
  onDown,
  disabled,
}: {
  tab: WebTab;
  selected: boolean;
  onSelect: () => void;
  onUp: (() => void) | undefined;
  onDown: (() => void) | undefined;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[10px] border bg-card py-3 pr-3 pl-2",
        selected ? "border-primary bg-secondary" : "border-border hover:border-input",
      )}
    >
      <span title={t("tabs.dragHint")} className="flex cursor-grab text-muted-foreground">
        <GripVerticalIcon aria-hidden="true" className="size-4" />
      </span>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent p-0 text-left text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-link-hover">
          <WebTabIcon icon={tab.icon} className="size-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{tab.label}</span>
            {usesPlayer(tab.url) ? (
              <Badge className="bg-[#60a5fa]/14 px-[7px] py-px text-[11px] text-[#93c5fd]">
                {t("tabs.player")}
              </Badge>
            ) : null}
            {tab.openIn === "browser" ? (
              <Badge variant="muted" className="px-[7px] py-px text-[11px]">
                {t("tabs.browser")}
              </Badge>
            ) : null}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{tab.url}</span>
        </span>
      </button>
      <span className="flex shrink-0 flex-col gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-[22px] w-7"
          disabled={disabled || !onUp}
          onClick={onUp}
          aria-label={t("tabs.moveUp", { label: tab.label })}
        >
          <ChevronUpIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-[22px] w-7"
          disabled={disabled || !onDown}
          onClick={onDown}
          aria-label={t("tabs.moveDown", { label: tab.label })}
        >
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
}

interface FormState {
  label: string;
  url: string;
  icon: WebTabIconName;
  openIn: WebTab["openIn"];
}

const EMPTY: FormState = { label: "", url: "", icon: "globe", openIn: "launcher" };

function TabForm({
  tab,
  pending,
  failed,
  full,
  onSave,
  onRemove,
  onCancel,
}: {
  tab: WebTab | undefined;
  pending: boolean;
  failed: boolean;
  full: boolean;
  onSave: (tab: WebTab) => void;
  onRemove: (() => void) | undefined;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => (tab ? { ...tab } : EMPTY));
  const [errors, setErrors] = useState<{ label?: string; url?: string }>({});
  const urlInput = useRef<HTMLInputElement>(null);
  const ids = {
    heading: useId(),
    label: useId(),
    labelError: useId(),
    url: useId(),
    urlHint: useId(),
  };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /** Puts a placeholder where the cursor is in the URL field. */
  function insert(placeholder: string) {
    const input = urlInput.current;
    const start = input?.selectionStart ?? form.url.length;
    const end = input?.selectionEnd ?? form.url.length;
    set("url", form.url.slice(0, start) + placeholder + form.url.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.label.trim()) next.label = t("tabs.labelRequired");
    if (!isWebTabUrl(form.url.trim())) next.url = t("tabs.urlInvalid");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSave({ ...form, label: form.label.trim(), url: form.url.trim() });
  }

  const url = form.url.trim();
  const example = usesPlayer(url) && isWebTabUrl(url) ? withSamplePlayer(url) : null;

  return (
    <Card
      role="region"
      aria-labelledby={ids.heading}
      className="flex min-w-0 flex-[2_1_520px] flex-col p-[22px]"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
        <h2 id={ids.heading} className="m-0 text-base font-semibold">
          {tab ? t("tabs.edit") : t("tabs.create")}
        </h2>
        {full ? <p className="m-0 text-[13px] text-warning">{t("tabs.full")}</p> : null}

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between">
            <Label htmlFor={ids.label}>{t("tabs.label")}</Label>
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              {form.label.length} / {MAX_WEB_TAB_LABEL}
            </span>
          </div>
          <Input
            id={ids.label}
            value={form.label}
            maxLength={MAX_WEB_TAB_LABEL}
            placeholder={t("tabs.labelPlaceholder")}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={errors.label ? ids.labelError : undefined}
            onChange={(event) => set("label", event.target.value)}
          />
          {errors.label ? (
            <p id={ids.labelError} className="m-0 text-[13px] text-destructive-foreground">
              {errors.label}
            </p>
          ) : null}
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 font-medium">{t("tabs.icon")}</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
            {WEB_TAB_ICONS.map((icon) => (
              <label
                key={icon}
                className={cn(
                  "relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border px-1 py-2 text-center text-[11px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  form.icon === icon
                    ? "border-primary bg-secondary text-foreground"
                    : "border-border bg-input-background text-subtle-foreground hover:border-input",
                )}
              >
                <input
                  type="radio"
                  name="icon"
                  value={icon}
                  checked={form.icon === icon}
                  onChange={() => set("icon", icon)}
                  className="sr-only"
                />
                <WebTabIcon icon={icon} className="size-5" />
                {t(`tabs.icon.${icon}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.url}>{t("tabs.url")}</Label>
          <Input
            ref={urlInput}
            id={ids.url}
            type="url"
            value={form.url}
            maxLength={500}
            placeholder="https://…"
            className="font-mono text-[13px]"
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={ids.urlHint}
            onChange={(event) => set("url", event.target.value)}
          />
          {errors.url ? (
            <p id={ids.urlHint} className="m-0 text-[13px] text-destructive-foreground">
              {errors.url}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span id={errors.url ? undefined : ids.urlHint}>{t("tabs.placeholders")}</span>
            {PLACEHOLDERS.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                onClick={() => insert(placeholder)}
                aria-label={t("tabs.insert", { placeholder })}
                className="h-7 cursor-pointer rounded-full border border-input bg-input-background px-2.5 font-mono text-xs text-link-hover hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                + {placeholder}
              </button>
            ))}
          </div>
          {example ? (
            <div className="mt-1 flex flex-col gap-1 rounded-md border border-dashed border-input bg-input-background px-3 py-2.5">
              <span className="text-xs text-muted-foreground">
                {t("tabs.example", { player: "Notch" })}
              </span>
              <span className="font-mono text-xs break-all text-subtle-foreground">{example}</span>
            </div>
          ) : null}
        </div>

        <fieldset className="m-0 flex flex-col gap-3 rounded-md border border-input p-3.5">
          <legend className="px-1 font-medium">{t("tabs.openIn")}</legend>
          {(["launcher", "browser"] as const).map((value) => (
            <label key={value} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name="openIn"
                className="mt-[3px] accent-primary"
                checked={form.openIn === value}
                onChange={() => set("openIn", value)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{t(`tabs.openIn.${value}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`tabs.openIn.${value}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {failed ? (
          <p role="alert" className="m-0 text-[13px] text-destructive-foreground">
            {t("common.unexpectedError")}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          {onRemove ? (
            <Button
              type="button"
              variant="outline"
              className="border-[#7f1d1d] text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
              disabled={pending}
              onClick={onRemove}
            >
              {t("tabs.remove")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || full}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/** The launcher's top bar with the instance's colors and its saved tabs. */
function TabBarPreview({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const { colors } = instance;
  const labels = [
    t("appearance.preview.home"),
    ...instance.tabs.map((tab) => tab.label),
    t("appearance.preview.settings"),
  ];
  return (
    <section aria-labelledby="tabs-preview" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tabs-preview" className="m-0 text-base font-semibold">
          {t("tabs.previewTitle")}
        </h2>
        <span className="text-xs text-muted-foreground">{t("tabs.previewHint")}</span>
      </div>
      <div
        role="img"
        aria-label={t("tabs.previewLabel", { name: instance.name, tabs: labels.join(", ") })}
        className="flex min-h-14 flex-wrap items-center gap-x-[22px] overflow-hidden rounded-xl border border-border px-5"
        style={{ background: colors.background, color: colors.text }}
      >
        <InstanceIcon instance={instance} className="size-[30px] text-xs" />
        <span className="font-bold">{instance.name}</span>
        <span
          className="flex items-center gap-1.5 border-b-2 py-[18px] text-[13px] font-semibold"
          style={{ borderColor: colors.primary }}
        >
          <HouseIcon aria-hidden="true" className="size-[15px]" />
          {t("appearance.preview.home")}
        </span>
        {instance.tabs.map((tab, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is the order.
            key={index}
            className="flex items-center gap-1.5 py-[18px] text-[13px] opacity-80"
          >
            <WebTabIcon icon={tab.icon} className="size-[15px]" />
            {tab.label}
            {tab.openIn === "browser" ? (
              <ExternalLinkIcon aria-hidden="true" className="size-3" />
            ) : null}
          </span>
        ))}
        <span className="flex items-center gap-1.5 py-[18px] text-[13px] opacity-80">
          <SettingsIcon aria-hidden="true" className="size-[15px]" />
          {t("appearance.preview.settings")}
        </span>
      </div>
    </section>
  );
}
