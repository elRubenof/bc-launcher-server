import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSelect } from "@/components/language-select";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { api, meQuery, organizationQuery } from "@/lib/queries";
import { ChangePasswordDialog } from "./change-password-dialog";

const NAV_ITEMS = [
  { to: "/admin", labelKey: "nav.home", exact: true },
  { to: "/admin/settings", labelKey: "nav.settings", exact: false },
] as const;

export function PanelLayout() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-10">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const organization = useQuery(organizationQuery);

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: "/admin/login" });
    },
  });

  return (
    <nav
      aria-label={t("nav.label")}
      className="flex flex-col gap-6 border-b border-border bg-sidebar px-3.5 py-5 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0"
    >
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <BrandMark name={organization.data?.name} className="size-9 rounded-md text-sm" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{organization.data?.name ?? "…"}</span>
          {organization.data ? (
            <span className="text-xs text-muted-foreground">
              {t(organization.data.visibility === "private" ? "org.private" : "org.public")}
            </span>
          ) : null}
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className="flex min-h-10 items-center gap-2.5 rounded-md px-3 font-medium text-subtle-foreground no-underline hover:bg-accent hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:font-semibold data-[status=active]:text-foreground"
            >
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 border-t border-border pt-4 md:mt-auto">
        {me.data ? (
          <div className="flex items-center gap-2.5 px-1.5">
            <div
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-border text-[13px] font-semibold"
            >
              {me.data.username[0]?.toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-semibold">{me.data.username}</span>
              <span className="text-xs text-muted-foreground">{t(`role.${me.data.role}`)}</span>
            </div>
          </div>
        ) : null}
        <ChangePasswordDialog />
        <Button
          variant="ghost"
          className="justify-start"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <LogOutIcon aria-hidden="true" />
          {t("account.logout")}
        </Button>
        <LanguageSelect className="px-1.5" />
      </div>
    </nav>
  );
}
