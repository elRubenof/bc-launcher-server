import type { Instance, NewsItem, SaveNews } from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { imageErrorKey } from "@/lib/images";
import { renderMarkdown } from "@/lib/markdown";
import { api, instanceQuery, newsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { isHttpUrl } from "@/lib/validation";

export function InstanceNewsPage({ id }: { id: string }) {
  const instance = useQuery(instanceQuery(id));
  return instance.data ? <NewsTab instance={instance.data} /> : null;
}

/** `"new"` = the editor is for a new item. */
type Selection = string | "new";

function NewsTab({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const news = useQuery(newsQuery(instance.id));
  const [selected, setSelected] = useState<Selection | null>(null);
  const items = news.data ?? [];
  // Until something is picked: the first item, or a new one when there is none.
  const current = selected ?? (news.isSuccess ? (items[0]?.id ?? "new") : null);
  const item = current && current !== "new" ? items.find((n) => n.id === current) : undefined;

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section
        aria-labelledby="news-list"
        className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="news-list" className="m-0 text-base font-semibold">
            {t("news.listTitle", { instance: instance.name })}
          </h2>
          <Button size="sm" onClick={() => setSelected("new")}>
            <PlusIcon aria-hidden="true" />
            {t("news.new")}
          </Button>
        </div>
        {news.isSuccess && items.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">{t("news.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {items.map((news) => (
              <li key={news.id}>
                <NewsCard
                  news={news}
                  selected={news.id === current}
                  onSelect={() => setSelected(news.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {current ? (
        <NewsEditor
          // A fresh form for each item.
          key={current}
          instanceId={instance.id}
          item={item}
          onSaved={(saved) => setSelected(saved.id)}
          onDeleted={() => setSelected(null)}
          onCancel={() => setSelected(item ? item.id : null)}
        />
      ) : null}
    </div>
  );
}

function NewsCard({
  news,
  selected,
  onSelect,
}: {
  news: NewsItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, language } = useI18n();
  const scheduled = Date.parse(news.publishedAt) > Date.now();
  const when = formatDateTime(new Date(news.publishedAt), language);
  const meta = [
    t(scheduled ? "news.scheduledFor" : "news.publishedOn", { when }),
    news.createdBy ? t("news.by", { admin: news.createdBy.username }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-1.5 rounded-[10px] border bg-card p-3.5 text-left text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected ? "border-primary bg-secondary" : "border-border hover:border-input",
      )}
    >
      {news.pinned || scheduled ? (
        <span className="flex flex-wrap gap-1.5">
          {news.pinned ? (
            <Badge variant="primary" className="px-[7px] py-px text-[11px]">
              {t("news.pinned")}
            </Badge>
          ) : null}
          {scheduled ? (
            <Badge className="bg-[#60a5fa]/14 px-[7px] py-px text-[11px] text-[#93c5fd]">
              {t("news.scheduled")}
            </Badge>
          ) : null}
        </span>
      ) : null}
      <span className="text-[15px] font-semibold">{news.title}</span>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </button>
  );
}

/** `datetime-local` value for a date, in local time. */
function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface FormState {
  title: string;
  body: string;
  image: { sha256: string; url: string } | null;
  link: string;
  pinned: boolean;
  /** `now`: publish on save (or keep the date of an item already published). */
  publish: "now" | "schedule";
  scheduleAt: string;
}

function toForm(item: NewsItem | undefined): FormState {
  const published = item ? new Date(item.publishedAt) : null;
  const scheduled = published !== null && published.getTime() > Date.now();
  return {
    title: item?.title ?? "",
    body: item?.body ?? "",
    image:
      item?.imageSha256 && item.imageUrl ? { sha256: item.imageSha256, url: item.imageUrl } : null,
    link: item?.link ?? "",
    pinned: item?.pinned ?? false,
    publish: scheduled ? "schedule" : "now",
    scheduleAt: localInput(scheduled ? published : new Date(Date.now() + 86400_000)),
  };
}

function NewsEditor({
  instanceId,
  item,
  onSaved,
  onDeleted,
  onCancel,
}: {
  instanceId: string;
  item: NewsItem | undefined;
  onSaved: (item: NewsItem) => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => toForm(item));
  const [errors, setErrors] = useState<{ title?: string; link?: string; scheduleAt?: string }>({});
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [imageError, setImageError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { heading: useId(), body: useId(), pin: useId(), schedule: useId() };
  const alreadyPublished = item !== undefined && Date.parse(item.publishedAt) <= Date.now();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: newsQuery(instanceId).queryKey });

  const upload = useMutation({
    mutationFn: api.uploadNewsImage,
    onSuccess: (image) => {
      setImageError(undefined);
      set("image", image);
    },
    onError: (error) => setImageError(t(imageErrorKey(error))),
  });

  const save = useMutation({
    mutationFn: (body: SaveNews) =>
      item ? api.updateNews(instanceId, item.id, body) : api.createNews(instanceId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(newsQuery(instanceId).queryKey, (list: NewsItem[] | undefined) =>
        list ? [saved, ...list.filter((n) => n.id !== saved.id)] : list,
      );
      onSaved(saved);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteNews(instanceId, item?.id as string),
    onSuccess: onDeleted,
    onSettled: refresh,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = t("news.titleRequired");
    if (form.link.trim() && !isHttpUrl(form.link.trim())) next.link = t("org.invalidUrl");
    const scheduleAt = new Date(form.scheduleAt);
    if (form.publish === "schedule" && Number.isNaN(scheduleAt.getTime())) {
      next.scheduleAt = t("news.scheduleRequired");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    save.mutate({
      title: form.title.trim(),
      body: form.body,
      imageSha256: form.image?.sha256 ?? null,
      link: form.link.trim() || null,
      pinned: form.pinned,
      publishedAt:
        form.publish === "schedule"
          ? scheduleAt.toISOString()
          : alreadyPublished
            ? (item?.publishedAt ?? null)
            : null,
    });
  }

  return (
    <Card
      role="region"
      aria-labelledby={ids.heading}
      className="flex min-w-0 flex-[2_1_520px] flex-col p-[22px]"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2 id={ids.heading} className="m-0 text-base font-semibold">
          {item ? t("news.edit") : t("news.create")}
        </h2>
        <FormField
          label={t("news.title")}
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
          error={errors.title}
          maxLength={150}
        />

        <div className="flex flex-col gap-1.5">
          <span className="font-medium">
            {t("news.image")}{" "}
            <span className="font-normal text-muted-foreground">{t("common.optional")}</span>
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {form.image ? (
              <img
                src={form.image.url}
                alt=""
                className="h-[90px] w-40 rounded-md border border-border object-cover"
              />
            ) : (
              <span className="flex h-[90px] w-40 items-center justify-center rounded-md border border-dashed border-input text-xs text-muted-foreground">
                {t("news.noImage")}
              </span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {upload.isPending
                ? t("common.loading")
                : form.image
                  ? t("common.change")
                  : t("news.addImage")}
            </Button>
            {form.image ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => set("image", null)}>
                {t("common.remove")}
              </Button>
            ) : null}
          </div>
          {imageError ? (
            <p role="alert" className="m-0 text-[13px] text-destructive-foreground">
              {imageError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={ids.body}>{t("news.body")}</Label>
            <div
              role="tablist"
              aria-label={t("news.editorMode")}
              className="flex gap-0.5 rounded-md border border-border bg-input-background p-0.5"
            >
              {(["write", "preview"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "h-7 cursor-pointer rounded-[6px] border-0 px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    mode === value
                      ? "bg-secondary font-semibold text-foreground"
                      : "bg-transparent text-muted-foreground",
                  )}
                >
                  {t(`news.mode.${value}`)}
                </button>
              ))}
            </div>
          </div>
          {mode === "write" ? (
            <Textarea
              id={ids.body}
              rows={8}
              maxLength={20_000}
              value={form.body}
              onChange={(event) => set("body", event.target.value)}
              className="font-mono text-[13px] leading-relaxed"
            />
          ) : (
            <div
              id={ids.body}
              className="flex min-h-[180px] flex-col gap-2.5 rounded-md border border-input bg-input-background p-3 leading-relaxed [&_a]:text-link [&_h3]:m-0 [&_h4]:m-0 [&_h5]:m-0 [&_ol]:m-0 [&_p]:m-0 [&_ul]:m-0"
            >
              {form.body.trim() ? (
                renderMarkdown(form.body)
              ) : (
                <span className="text-muted-foreground">{t("news.emptyPreview")}</span>
              )}
            </div>
          )}
          <span className="text-xs text-muted-foreground">{t("news.markdownHint")}</span>
        </div>

        <FormField
          label={t("news.link")}
          hint={t("news.linkHint")}
          type="url"
          placeholder="https://…"
          value={form.link}
          onChange={(event) => set("link", event.target.value)}
          error={errors.link}
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-input p-3">
            <span className="flex flex-col gap-0.5">
              <span id={ids.pin} className="font-medium">
                {t("news.pin")}
              </span>
              <span className="text-xs text-muted-foreground">{t("news.pinHint")}</span>
            </span>
            <Switch
              checked={form.pinned}
              onCheckedChange={(checked) => set("pinned", checked)}
              aria-labelledby={ids.pin}
            />
          </div>
          <fieldset className="m-0 flex flex-col gap-2 rounded-md border border-input p-3">
            <legend className="px-1 font-medium">{t("news.publication")}</legend>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="publish"
                className="accent-primary"
                checked={form.publish === "now"}
                onChange={() => set("publish", "now")}
              />
              {alreadyPublished && item
                ? t("news.publishedOn", {
                    when: formatDateTime(new Date(item.publishedAt), language),
                  })
                : t("news.publishNow")}
            </label>
            <label className="flex cursor-pointer flex-wrap items-center gap-2">
              <input
                type="radio"
                name="publish"
                className="accent-primary"
                checked={form.publish === "schedule"}
                onChange={() => set("publish", "schedule")}
              />
              {t("news.schedule")}
              <Input
                type="datetime-local"
                aria-label={t("news.scheduleAt")}
                aria-invalid={errors.scheduleAt ? true : undefined}
                value={form.scheduleAt}
                onFocus={() => set("publish", "schedule")}
                onChange={(event) => set("scheduleAt", event.target.value)}
                className="h-8 w-auto text-[13px]"
              />
            </label>
            {errors.scheduleAt ? (
              <p className="m-0 text-[13px] text-destructive-foreground">{errors.scheduleAt}</p>
            ) : null}
          </fieldset>
        </div>

        {save.isError ? <Alert variant="destructive">{t("common.unexpectedError")}</Alert> : null}

        <div className="flex flex-wrap justify-between gap-2">
          {item ? (
            <DeleteNewsDialog
              title={item.title}
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
            />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(toForm(item));
                setErrors({});
                onCancel();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || upload.isPending}>
              {item ? t("common.save") : t("news.publishButton")}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function DeleteNewsDialog({
  title,
  pending,
  onConfirm,
}: {
  title: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="border-[#7f1d1d] text-destructive-foreground hover:text-destructive-foreground"
        >
          {t("news.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle>{t("news.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("news.deleteDescription", { title })}</DialogDescription>
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {t("news.delete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
