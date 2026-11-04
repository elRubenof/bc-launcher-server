import type { Admin, DiscoveryDocument } from "@bc-launcher-server/contracts";
import { queryOptions } from "@tanstack/react-query";
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

export const api = {
  setup: (body: { organizationName: string; username: string; password: string }) =>
    apiRequest<Admin>("POST", "/api/admin/setup", body),
  login: (body: { username: string; password: string }) =>
    apiRequest<Admin>("POST", "/api/admin/auth/login", body),
  logout: () => apiRequest<void>("POST", "/api/admin/auth/logout"),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    apiRequest<void>("PUT", "/api/admin/auth/password", body),
};
