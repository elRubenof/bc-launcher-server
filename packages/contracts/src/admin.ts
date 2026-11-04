import { createRoute, z } from "@hono/zod-openapi";
import { problemResponse } from "./problem";

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/, "3-32 characters: letters, numbers, '_', '.' or '-'");

export const Password = z.string().min(8).max(256);

/**
 * `owner`: the single account created at setup; everything. `admin`: everything except acting on
 * the owner. `editor`: instances, content, news and players.
 */
export const AdminRole = z.enum(["owner", "admin", "editor"]);

/** Roles that can be given to an account; there is only ever one owner. */
export const AssignableRole = z.enum(["admin", "editor"]);

export const Admin = z
  .object({
    id: z.string(),
    username: z.string(),
    role: AdminRole,
  })
  .openapi("Admin");

export type Admin = z.infer<typeof Admin>;

export const SetupStatus = z.object({ required: z.boolean() }).openapi("SetupStatus");

export const SetupRequest = z
  .object({
    organizationName: z.string().trim().min(1).max(100),
    username: Username,
    password: Password,
  })
  .openapi("SetupRequest");

export const getSetupStatusRoute = createRoute({
  method: "get",
  path: "/api/admin/setup",
  summary: "Whether the first owner still has to be created",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Setup status.",
      content: { "application/json": { schema: SetupStatus } },
    },
  },
});

export const setupRoute = createRoute({
  method: "post",
  path: "/api/admin/setup",
  summary: "Create the first owner and name the organization",
  description: "Only works while there are no admins. Signs the new owner in.",
  tags: ["Admin"],
  request: {
    body: { required: true, content: { "application/json": { schema: SetupRequest } } },
  },
  responses: {
    201: {
      description: "Owner created and signed in.",
      content: { "application/json": { schema: Admin } },
    },
    400: problemResponse("Invalid request."),
    409: problemResponse("Setup was already completed (`setup_completed`)."),
  },
});

export const LoginRequest = z
  .object({
    username: z.string().trim().toLowerCase().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .openapi("LoginRequest");

export const loginRoute = createRoute({
  method: "post",
  path: "/api/admin/auth/login",
  summary: "Sign in with username and password",
  tags: ["Admin"],
  request: {
    body: { required: true, content: { "application/json": { schema: LoginRequest } } },
  },
  responses: {
    200: {
      description: "Signed in; the session cookie is set.",
      content: { "application/json": { schema: Admin } },
    },
    400: problemResponse("Invalid request."),
    401: problemResponse("Wrong username or password (`invalid_credentials`)."),
  },
});

export const logoutRoute = createRoute({
  method: "post",
  path: "/api/admin/auth/logout",
  summary: "Sign out and end the current session",
  tags: ["Admin"],
  responses: {
    204: { description: "Signed out." },
    401: problemResponse("Not signed in (`unauthenticated`)."),
  },
});

export const meRoute = createRoute({
  method: "get",
  path: "/api/admin/auth/me",
  summary: "The signed-in admin",
  tags: ["Admin"],
  responses: {
    200: {
      description: "The signed-in admin.",
      content: { "application/json": { schema: Admin } },
    },
    401: problemResponse("Not signed in (`unauthenticated`)."),
  },
});

export const ChangePasswordRequest = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: Password,
  })
  .openapi("ChangePasswordRequest");

export const changePasswordRoute = createRoute({
  method: "put",
  path: "/api/admin/auth/password",
  summary: "Change your own password",
  description: "Ends every other session of this admin; the current one stays signed in.",
  tags: ["Admin"],
  request: {
    body: { required: true, content: { "application/json": { schema: ChangePasswordRequest } } },
  },
  responses: {
    204: { description: "Password changed." },
    400: problemResponse("Invalid request."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse("The current password is wrong (`wrong_password`)."),
  },
});

export const AdminListItem = Admin.extend({
  /** ISO date of the last sign-in or session use; `null` if the admin never signed in. */
  lastSeenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
}).openapi("AdminListItem");

export type AdminListItem = z.infer<typeof AdminListItem>;

export const CreateAdminRequest = z
  .object({ username: Username, password: Password, role: AssignableRole })
  .openapi("CreateAdminRequest");

const AdminIdParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" } }),
});

export const listAdminsRoute = createRoute({
  method: "get",
  path: "/api/admin/admins",
  summary: "Every admin account",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Accounts: the owner, then admins, then editors.",
      content: { "application/json": { schema: z.array(AdminListItem) } },
    },
    401: problemResponse("Not signed in (`unauthenticated`)."),
  },
});

export const createAdminRoute = createRoute({
  method: "post",
  path: "/api/admin/admins",
  summary: "Create an admin or editor account (owner and admins)",
  description: "The creator passes the password on to the new account, who can change it later.",
  tags: ["Admin"],
  request: {
    body: { required: true, content: { "application/json": { schema: CreateAdminRequest } } },
  },
  responses: {
    201: { description: "Created.", content: { "application/json": { schema: AdminListItem } } },
    400: problemResponse("Invalid request."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse(
      "Only the owner and admins can do this (`forbidden`), and nobody can act on the owner (`owner_protected`).",
    ),
    409: problemResponse("The username is taken (`username_taken`)."),
  },
});

export const resetAdminPasswordRoute = createRoute({
  method: "put",
  path: "/api/admin/admins/{id}/password",
  summary: "Reset another account's password (owner and admins, never the owner's)",
  description: "Ends every session of that admin.",
  tags: ["Admin"],
  request: {
    params: AdminIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ password: Password }) } },
    },
  },
  responses: {
    204: { description: "Password reset." },
    400: problemResponse("Use your own password change instead (`cannot_target_self`)."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse(
      "Only the owner and admins can do this (`forbidden`), and nobody can act on the owner (`owner_protected`).",
    ),
    404: problemResponse("No such admin (`not_found`)."),
  },
});

export const deleteAdminRoute = createRoute({
  method: "delete",
  path: "/api/admin/admins/{id}",
  summary: "Remove another account (owner and admins, never the owner)",
  description: "Ends every session of that admin.",
  tags: ["Admin"],
  request: { params: AdminIdParams },
  responses: {
    204: { description: "Removed." },
    400: problemResponse("You can't remove yourself (`cannot_target_self`)."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse(
      "Only the owner and admins can do this (`forbidden`), and nobody can act on the owner (`owner_protected`).",
    ),
    404: problemResponse("No such admin (`not_found`)."),
  },
});

export const changeAdminRoleRoute = createRoute({
  method: "put",
  path: "/api/admin/admins/{id}/role",
  summary: "Make another account an admin or an editor (owner and admins, never the owner)",
  tags: ["Admin"],
  request: {
    params: AdminIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ role: AssignableRole }) } },
    },
  },
  responses: {
    200: {
      description: "The account with its new role.",
      content: { "application/json": { schema: AdminListItem } },
    },
    400: problemResponse("You can't change your own role (`cannot_target_self`)."),
    401: problemResponse("Not signed in (`unauthenticated`)."),
    403: problemResponse(
      "Only the owner and admins can do this (`forbidden`), and nobody can act on the owner (`owner_protected`).",
    ),
    404: problemResponse("No such admin (`not_found`)."),
  },
});
