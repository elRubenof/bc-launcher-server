import { useId } from "react";
import { LANGUAGES, type Language, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function LanguageSelect({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();
  const id = useId();
  return (
    <div className={cn("flex items-center gap-2 text-[13px] text-subtle-foreground", className)}>
      <label htmlFor={id}>{t("common.language")}</label>
      <select
        id={id}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        className="h-9 cursor-pointer rounded-md border border-border bg-transparent px-2 text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {LANGUAGES.map((code) => (
          <option key={code} value={code} className="bg-card">
            {t(`language.${code}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
