import { Link, Outlet } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/i18n";

const TABS = [
  { to: "/admin/settings", labelKey: "settings.tab.organization", exact: true },
  { to: "/admin/settings/admins", labelKey: "settings.tab.admins", exact: false },
  { to: "/admin/settings/activity", labelKey: "settings.tab.activity", exact: false },
] as const;

export function SettingsLayout() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("settings.title")} description={t("settings.ownerOnly")} />
      <nav
        aria-label={t("settings.tabs")}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact }}
            className="-mb-px border-b-2 border-transparent px-3.5 py-2.5 font-medium whitespace-nowrap text-muted-foreground no-underline hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-semibold data-[status=active]:text-foreground"
          >
            {t(tab.labelKey)}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
