import type {
  ActivityEntry,
  Admin,
  AdminListItem,
  ApplyContent,
  BanPlayer,
  BlacklistEntry,
  CreateInstance,
  DiscoveryDocument,
  Instance,
  InstanceColors,
  InstanceContent,
  LoaderVersion,
  MinecraftVersion,
  OrganizationSettings,
  PlayerDetail,
  PlayerSummary,
  UpdateInstance,
  UpdateOrganizationSettings,
  WhitelistEntry,
} from "@bc-launcher-server/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { apiRequest } from "./api";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => apiRequest<Admin>("GET", "/api/admin/auth/me"),
  staleTime: 60_000,
});

export const setupStatusQuery = queryOptions({
  queryKey: ["setup-status"],
  queryFn: () => apiRequest<{ required: boolean }>("GET", "/api/admin/setup"),
});

export const organizationQuery = queryOptions({
  queryKey: ["organization"],
  queryFn: () => apiRequest<DiscoveryDocument>("GET", "/.well-known/bc-launcher"),
  staleTime: 60_000,
});

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: () => apiRequest<OrganizationSettings>("GET", "/api/admin/settings"),
});

export const adminsQuery = queryOptions({
  queryKey: ["admins"],
  queryFn: () => apiRequest<AdminListItem[]>("GET", "/api/admin/admins"),
});

export interface ActivityFilters {
  adminId?: string | undefined;
  type?: string | undefined;
}

export function activityPage(filters: ActivityFilters, before?: number, limit = 30) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (filters.adminId) query.set("adminId", filters.adminId);
  if (filters.type) query.set("type", filters.type);
  if (before) query.set("before", String(before));
  return apiRequest<{ items: ActivityEntry[]; nextBefore: number | null }>(
    "GET",
    `/api/admin/activity?${query}`,
  );
}

export const instancesQuery = queryOptions({
  queryKey: ["instances"],
  queryFn: () => apiRequest<Instance[]>("GET", "/api/admin/instances"),
});

export const instanceQuery = (id: string) =>
  queryOptions({
    queryKey: ["instances", id],
    queryFn: () => apiRequest<Instance>("GET", `/api/admin/instances/${encodeURIComponent(id)}`),
  });

export const contentQuery = (id: string) =>
  queryOptions({
    queryKey: ["instances", id, "content"],
    queryFn: () =>
      apiRequest<InstanceContent>("GET", `/api/admin/instances/${encodeURIComponent(id)}/content`),
  });

export const minecraftVersionsQuery = queryOptions({
  queryKey: ["minecraft-versions"],
  queryFn: () =>
    apiRequest<{ versions: MinecraftVersion[] }>("GET", "/api/admin/minecraft/versions"),
  staleTime: 10 * 60_000,
});

export const loaderVersionsQuery = (type: string, mc: string) =>
  queryOptions({
    queryKey: ["loader-versions", type, mc],
    queryFn: () =>
      apiRequest<{ versions: LoaderVersion[] }>(
        "GET",
        `/api/admin/loaders/${type}/versions?mc=${encodeURIComponent(mc)}`,
      ),
    staleTime: 10 * 60_000,
    enabled: type !== "vanilla" && mc !== "",
  });

export interface PlayerFilters {
  q?: string | undefined;
  status?: "all" | "member" | "banned" | "not_member" | "joined" | "never_joined" | undefined;
  instance?: string | undefined;
}

export interface PlayerPage {
  items: PlayerSummary[];
  total: number;
  launchableInstances: number;
}

export const PLAYERS_PAGE_SIZE = 50;

export function playersPage(filters: PlayerFilters, offset = 0, limit = PLAYERS_PAGE_SIZE) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (filters.q) query.set("q", filters.q);
  if (filters.status && filters.status !== "all") query.set("status", filters.status);
  if (filters.instance) query.set("instance", filters.instance);
  return apiRequest<PlayerPage>("GET", `/api/admin/players?${query}`);
}

export const playerQuery = (uuid: string) =>
  queryOptions({
    queryKey: ["player", uuid],
    queryFn: () => apiRequest<PlayerDetail>("GET", `/api/admin/players/${uuid}`),
  });

/** `null` = the organization; otherwise an instance id. */
export type AccessScope = string | null;

const listPath = (scope: AccessScope, list: "whitelist" | "blacklist") =>
  scope === null
    ? `/api/admin/${list}`
    : `/api/admin/instances/${encodeURIComponent(scope)}/${list}`;

export const whitelistQuery = (scope: AccessScope) =>
  queryOptions({
    queryKey: ["access", scope ?? "", "whitelist"],
    queryFn: () => apiRequest<WhitelistEntry[]>("GET", listPath(scope, "whitelist")),
  });

export const blacklistQuery = (scope: AccessScope) =>
  queryOptions({
    queryKey: ["access", scope ?? "", "blacklist"],
    queryFn: () => apiRequest<BlacklistEntry[]>("GET", listPath(scope, "blacklist")),
  });

/** After any change to a list: players, player sheets and lists all show access. */
export function invalidateAccess(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["access"] }),
    queryClient.invalidateQueries({ queryKey: ["players"] }),
    queryClient.invalidateQueries({ queryKey: ["player"] }),
  ]);
}

const instancePath = (id: string) => `/api/admin/instances/${encodeURIComponent(id)}`;

export const api = {
  setup: (body: { organizationName: string; username: string; password: string }) =>
    apiRequest<Admin>("POST", "/api/admin/setup", body),
  login: (body: { username: string; password: string }) =>
    apiRequest<Admin>("POST", "/api/admin/auth/login", body),
  logout: () => apiRequest<void>("POST", "/api/admin/auth/logout"),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    apiRequest<void>("PUT", "/api/admin/auth/password", body),
  updateSettings: (body: UpdateOrganizationSettings) =>
    apiRequest<OrganizationSettings>("PUT", "/api/admin/settings", body),
  uploadImage: (kind: "logo" | "icon", file: File) =>
    apiRequest<OrganizationSettings>("PUT", `/api/admin/settings/${kind}`, file),
  removeImage: (kind: "logo" | "icon") =>
    apiRequest<OrganizationSettings>("DELETE", `/api/admin/settings/${kind}`),
  createAdmin: (body: { username: string; password: string; role: "admin" | "editor" }) =>
    apiRequest<AdminListItem>("POST", "/api/admin/admins", body),
  resetAdminPassword: (id: string, password: string) =>
    apiRequest<void>("PUT", `/api/admin/admins/${encodeURIComponent(id)}/password`, { password }),
  changeAdminRole: (id: string, role: "admin" | "editor") =>
    apiRequest<AdminListItem>("PUT", `/api/admin/admins/${encodeURIComponent(id)}/role`, { role }),
  removeAdmin: (id: string) =>
    apiRequest<void>("DELETE", `/api/admin/admins/${encodeURIComponent(id)}`),
  createInstance: (body: CreateInstance) =>
    apiRequest<Instance>("POST", "/api/admin/instances", body),
  updateInstance: (id: string, body: UpdateInstance) =>
    apiRequest<Instance>("PUT", instancePath(id), body),
  updateColors: (id: string, colors: InstanceColors) =>
    apiRequest<Instance>("PUT", `${instancePath(id)}/appearance`, { colors }),
  uploadInstanceImage: (id: string, kind: "icon" | "background", file: File) =>
    apiRequest<Instance>("PUT", `${instancePath(id)}/${kind}`, file),
  removeInstanceImage: (id: string, kind: "icon" | "background") =>
    apiRequest<Instance>("DELETE", `${instancePath(id)}/${kind}`),
  deleteInstance: (id: string) => apiRequest<void>("DELETE", instancePath(id)),
  updateInstanceAccess: (id: string, access: "everyone" | "whitelist") =>
    apiRequest<{ access: "everyone" | "whitelist" }>("PUT", `${instancePath(id)}/access`, {
      access,
    }),
  addToWhitelist: (scope: AccessScope, player: string) =>
    apiRequest<WhitelistEntry>("POST", listPath(scope, "whitelist"), { player }),
  removeFromWhitelist: (scope: AccessScope, uuid: string) =>
    apiRequest<void>("DELETE", `${listPath(scope, "whitelist")}/${uuid}`),
  ban: (scope: AccessScope, body: BanPlayer) =>
    apiRequest<BlacklistEntry>("POST", listPath(scope, "blacklist"), body),
  unban: (scope: AccessScope, uuid: string) =>
    apiRequest<void>("DELETE", `${listPath(scope, "blacklist")}/${uuid}`),
  checkBlobs: (sha256: string[]) =>
    apiRequest<{ missing: string[] }>("POST", "/api/admin/blobs/check", { sha256 }),
  applyContent: (id: string, body: ApplyContent) =>
    apiRequest<InstanceContent>("PUT", `${instancePath(id)}/content`, body),
};
