import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ApiError } from "./lib/api";
import { meQuery, setupStatusQuery } from "./lib/queries";
import { HomePage } from "./routes/home";
import { LoginPage } from "./routes/login";
import { PanelLayout } from "./routes/panel-layout";
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
  component: Outlet,
});

// The public download page comes later; until then "/" opens the panel.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  panelRoute.addChildren([homeRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent" });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
