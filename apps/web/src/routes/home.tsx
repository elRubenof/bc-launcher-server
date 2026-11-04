import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { organizationQuery } from "@/lib/queries";

export function HomePage() {
  const { t } = useI18n();
  const organization = useQuery(organizationQuery);

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-[26px] font-bold">{t("home.title")}</h1>
        <p className="m-0 text-muted-foreground">
          {t("home.subtitle", { name: organization.data?.name ?? "…" })}
        </p>
      </header>
      <section aria-labelledby="home-instances" className="flex flex-col gap-3.5">
        <h2 id="home-instances" className="m-0 text-base font-semibold">
          {t("home.instances")}
        </h2>
        <Card className="p-6 text-muted-foreground">{t("home.noInstances")}</Card>
      </section>
    </div>
  );
}
