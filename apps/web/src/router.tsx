import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { OrganizationFavicon } from "./components/organization-favicon";
import { ApiError } from "./lib/api";
import { meQuery, setupStatusQuery } from "./lib/queries";
import { HomePage } from "./routes/home";
import { InstanceAccessPage } from "./routes/instance/access";
import { InstanceAppearancePage } from "./routes/instance/appearance";
import { InstanceContentPage } from "./routes/instance/content";
import { InstanceGeneralPage } from "./routes/instance/general";
import { InstanceLayout } from "./routes/instance/layout";
import { InstanceNewsPage } from "./routes/instance/news";
import { InstancesPage } from "./routes/instances";
import { LoginPage } from "./routes/login";
import { PanelLayout } from "./routes/panel-layout";
import {
  OrgBlacklistPage,
  OrgWhitelistPage,
  PlayersLayout,
  PlayersListPage,
} from "./routes/players";
import { PublicPage } from "./routes/public-page";
import { SettingsActivityPage } from "./routes/settings-activity";
import { SettingsAdminsPage } from "./routes/settings-admins";
import { SettingsLayout } from "./routes/settings-layout";
import { SettingsOrganizationPage } from "./routes/settings-organization";
import { SetupPage } from "./routes/setup";

export interface RouterContext {
  queryClient: QueryClient;
}

async function isSignedIn(queryClient: QueryClient) {
  try {
    await queryClient.ensureQueryData(meQuery);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}

async function setupRequired(queryClient: QueryClient) {
  return (await queryClient.fetchQuery(setupStatusQuery)).required;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <OrganizationFavicon />
      <Outlet />
    </>
  ),
});

/** The organization's public download page. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: PublicPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/setup",
  beforeLoad: async ({ context }) => {
    if (!(await setupRequired(context.queryClient))) throw redirect({ to: "/admin/login" });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: async ({ context }) => {
    if (await setupRequired(context.queryClient)) throw redirect({ to: "/admin/setup" });
    if (await isSignedIn(context.queryClient)) throw redirect({ to: "/admin" });
  },
  component: function Login() {
    const { redirect: redirectTo } = loginRoute.useSearch();
    return <LoginPage redirectTo={redirectTo} />;
  },
});

/** Everything behind a session: sends visitors to setup or login. */
const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "panel",
  beforeLoad: async ({ context, location }) => {
    if (await isSignedIn(context.queryClient)) return;
    if (await setupRequired(context.queryClient)) throw redirect({ to: "/admin/setup" });
    throw redirect({ to: "/admin/login", search: { redirect: location.href } });
  },
  component: PanelLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/admin",
  component: HomePage,
});

const instancesRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/admin/instances",
  component: InstancesPage,
});

const instanceRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/admin/instances/$id",
  component: function Instance() {
    const { id } = instanceRoute.useParams();
    return <InstanceLayout id={id} />;
  },
});

const instanceGeneralRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/",
  component: function General() {
    return <InstanceGeneralPage id={instanceRoute.useParams().id} />;
  },
});

const instanceAppearanceRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/appearance",
  component: function Appearance() {
    return <InstanceAppearancePage id={instanceRoute.useParams().id} />;
  },
});

const instanceContentRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/content",
  component: function Content() {
    return <InstanceContentPage id={instanceRoute.useParams().id} />;
  },
});

const instanceAccessRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/access",
  component: function Access() {
    return <InstanceAccessPage id={instanceRoute.useParams().id} />;
  },
});

const playersRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/admin/players",
  component: PlayersLayout,
});

const playersListRoute = createRoute({
  getParentRoute: () => playersRoute,
  path: "/",
  component: PlayersListPage,
});

const orgWhitelistRoute = createRoute({
  getParentRoute: () => playersRoute,
  path: "/whitelist",
  component: OrgWhitelistPage,
});

const orgBlacklistRoute = createRoute({
  getParentRoute: () => playersRoute,
  path: "/blacklist",
  component: OrgBlacklistPage,
});

const instanceNewsRoute = createRoute({
  getParentRoute: () => instanceRoute,
  path: "/news",
  component: function News() {
    return <InstanceNewsPage id={instanceRoute.useParams().id} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => panelRoute,
  path: "/admin/settings",
  component: SettingsLayout,
});

const settingsOrganizationRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  component: SettingsOrganizationPage,
});

const settingsAdminsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/admins",
  component: SettingsAdminsPage,
});

const settingsActivityRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/activity",
  component: SettingsActivityPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  panelRoute.addChildren([
    homeRoute,
    instancesRoute,
    instanceRoute.addChildren([
      instanceGeneralRoute,
      instanceAppearanceRoute,
      instanceContentRoute,
      instanceAccessRoute,
      instanceNewsRoute,
    ]),
    playersRoute.addChildren([playersListRoute, orgWhitelistRoute, orgBlacklistRoute]),
    settingsRoute.addChildren([
      settingsOrganizationRoute,
      settingsAdminsRoute,
      settingsActivityRoute,
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
