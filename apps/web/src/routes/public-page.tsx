import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSelect } from "@/components/language-select";
import { useI18n } from "@/i18n";
import { organizationQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Official launcher builds. The launcher is generic; the update feed never comes from here. */
const LAUNCHER_RELEASES_URL = "https://github.com/elRubenof/bc-launcher/releases/latest";

const SYSTEMS = [
  { id: "windows", name: "Windows" },
  { id: "macos", name: "macOS" },
  { id: "linux", name: "Linux" },
] as const;

type SystemId = (typeof SYSTEMS)[number]["id"];

function detectSystem(): SystemId | null {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("windows")) return "windows";
  if (agent.includes("mac os") || agent.includes("macintosh")) return "macos";
  if (agent.includes("linux") && !agent.includes("android")) return "linux";
  return null;
}

/** The organization's public page: who they are, the launcher downloads and the deep link. */
export function PublicPage() {
  const { t } = useI18n();
  const organization = useQuery(organizationQuery);
  const org = organization.data;
  const serverUrl = window.location.origin;
  const host = window.location.host;
  const system = detectSystem();

  useEffect(() => {
    if (org) document.title = org.name;
  }, [org]);

  return (
    <div className="flex min-h-screen flex-col bg-[#23162a] text-base text-white [&_a:hover]:text-[#f2cff7] [&_a]:text-[#e2a6ec]">
      <header className="flex items-center justify-between gap-4 border-b border-[#3a2745] px-4 py-5 sm:px-16">
        <span className="text-[15px] font-bold text-[#e7d8ee]">BC Launcher</span>
        {org?.links.discord || org?.links.web ? (
          <nav aria-label={t("public.links")} className="flex gap-[18px] text-sm">
            {org.links.discord ? <a href={org.links.discord}>Discord</a> : null}
            {org.links.web ? <a href={org.links.web}>Web</a> : null}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-14 px-4 py-16 sm:px-12">
        <section
          aria-labelledby="org-name"
          className="flex flex-col items-center gap-[18px] text-center"
        >
          <BrandMark
            name={org?.name}
            logoUrl={org?.logoUrl}
            className="size-24 rounded-[22px] text-[34px] font-extrabold"
          />
          <h1
            id="org-name"
            className="m-0 text-[clamp(32px,5vw,48px)] font-extrabold tracking-tight"
          >
            {org?.name ?? "…"}
          </h1>
          <p className="m-0 max-w-[560px] text-lg leading-normal text-[#d9c8e2]">
            {org?.description ? `${org.description} ` : ""}
            {t("public.pitch")}
          </p>
          <a
            href={`bclauncher://add?server=${encodeURIComponent(serverUrl)}`}
            className="mt-2 inline-flex min-h-[52px] items-center rounded-[10px] bg-primary px-7 text-[17px] font-bold text-white! no-underline hover:bg-primary-hover"
          >
            {t("public.open")}
          </a>
          <span className="text-sm text-[#bba8c7]">{t("public.openHint")}</span>
        </section>

        <section aria-labelledby="download" className="flex flex-col gap-5">
          <h2 id="download" className="m-0 text-center text-[22px] font-bold">
            {t("public.download")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {SYSTEMS.map((item) => {
              const mine = item.id === system;
              return (
                <a
                  key={item.id}
                  href={LAUNCHER_RELEASES_URL}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-[14px] border bg-[#2e1d37] p-[22px] text-white! no-underline",
                    mine ? "border-2 border-primary" : "border-[#3a2745]",
                  )}
                >
                  <span
                    className={cn(
                      "min-h-4 text-xs font-bold tracking-[0.06em] uppercase",
                      mine ? "text-[#e2a6ec]" : "invisible",
                    )}
                  >
                    {t("public.yourSystem")}
                  </span>
                  <span className="text-xl font-bold">{item.name}</span>
                  <span className="text-sm text-[#d9c8e2]">{t("public.latestVersion")}</span>
                </a>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="steps" className="flex flex-col gap-5">
          <h2 id="steps" className="m-0 text-center text-[22px] font-bold">
            {t("public.steps")}
          </h2>
          <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-3">
            {(
              [
                ["public.step1", t("public.step1Text")],
                ["public.step2", t("public.step2Text")],
                ["public.step3", t("public.step3Text", { host })],
              ] as const
            ).map(([title, text], index) => (
              <li key={title} className="flex flex-col gap-2 rounded-[14px] bg-[#2a1b32] p-5">
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-full bg-primary font-bold"
                >
                  {index + 1}
                </span>
                <span className="font-bold">{t(title)}</span>
                <span className="text-sm leading-normal text-[#d9c8e2]">{text}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#3a2745] px-4 py-6 text-[13px] text-[#bba8c7] sm:px-16">
        <span>{t("public.footer", { name: org?.name ?? "…" })}</span>
        <div className="flex flex-wrap items-center gap-4">
          <LanguageSelect className="text-[#bba8c7]" />
          <a href="/admin">{t("public.adminPanel")}</a>
        </div>
      </footer>
    </div>
  );
}
