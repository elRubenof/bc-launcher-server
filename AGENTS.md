# AGENTS.md — bc-launcher-server

Guidance for AI coding agents (and humans) working in this repository.

## What this is

**BC Launcher Server** is what each **organization** (a developer or organizer of series and events) deploys to feed [BC Launcher](https://github.com/elRubenof/bc-launcher). One deployment = one organization with N **instances** (series, events, servers). It provides:

- A versioned public API for the launcher (`/.well-known/bc-launcher` discovery + `/api/v1`).
- An internal admin API (`/api/admin/*`) and a web panel (`/admin`) to manage instances, content, news, branding, admins and player access.
- A public download page (`/`) with launcher downloads and the `bclauncher://add?server=<url>` deep link.

Deploy targets: **Cloudflare** (Workers + D1 + R2 + static assets) and **Docker** (Node + SQLite + filesystem, volume `/data`). Vercel was discarded.

This repo contains **only the server**. The launcher is the separate `bc-launcher` repo (Flutter). The two talk only through the public contract (discovery, `/api/vN`, the launcher's `compat.json`), so never assume both are deployed at the same version. The cross-repo decisions are in `bc-launcher/AGENTS.md` → "Architecture decisions".

- Status: **early development**. Only the tooling exists; most of what is described below is planned.
- License: GPL-3.0 (`LICENSE`).

## Commands

Requires Node ≥ 22.12 (`.nvmrc`: 22) and pnpm (version pinned in `package.json` → `packageManager`; install it with `npm i -g pnpm@<that version>` if `corepack` isn't available).

```bash
pnpm install          # install all workspace dependencies
pnpm lint             # Biome lint + format check (must pass before committing)
pnpm format           # apply Biome fixes and formatting
pnpm typecheck        # tsc in every package that defines a typecheck script
pnpm test             # Vitest
```

CI (`.github/workflows/ci.yml`) runs install (frozen lockfile), lint, typecheck and test on every push and pull request.

## Project layout

```
apps/
  api/          Hono API. src/app.ts (runtime-agnostic app) + src/entry/worker.ts + src/entry/node.ts   (planned)
  web/          React + Vite + shadcn/ui (TanStack Router + Query): public page "/" and panel "/admin"  (planned)
packages/
  contracts/    zod schemas + @hono/zod-openapi routes; generates openapi.json                          (planned)
  db/           Drizzle schema (SQLite) + SQL migrations shared by D1 and Node                         (planned)
docker/         Dockerfile, docker-compose.yml                                                         (planned)
wrangler.jsonc  D1 + R2 + static assets + cron, "Deploy to Cloudflare" button                          (planned)
tsconfig.base.json, biome.json, vitest.config.ts, pnpm-workspace.yaml
```

## Conventions

- **TypeScript strict** everywhere. Every package extends `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `types: []`: each package declares the runtime types it needs).
- **Biome** formats and lints (2 spaces, double quotes, 100 columns). Don't add ESLint or Prettier.
- **Vitest** for tests. API tests use `app.request()` with in-memory SQLite and an in-memory `BlobStore`.
- **Dependencies:** pin exact versions. pnpm enforces a minimum release age; don't add `minimumReleaseAgeExclude` entries to get around it, pick an older version instead.
- **Contracts first:** the zod schemas in `packages/contracts` are the source of truth. `openapi.json` is generated from them and must be committed up to date. Never break `/api/v1` or the discovery format (`discoveryVersion`); breaking changes need a new API version.
- **Runtime-agnostic core:** everything that differs between Cloudflare and Docker goes behind `Platform { db, blobs, config }` in `apps/api/src/platform.ts`:
  - `db`: Drizzle on D1 (Workers) or `better-sqlite3` at `/data/db.sqlite` (Node). Same migrations; Node applies them on start, Cloudflare with `wrangler d1 migrations apply` in the deploy script.
  - `blobs` (`BlobStore`: `head/get/put/delete`, streaming): R2 or `/data/blobs/<sha256[0..2]>/<sha256>`.
  - `config`: `PUBLIC_URL`, `SESSION_SECRET`, `JWT_SECRET` from env/secrets.
- **Workers constraints apply to shared code:** no Node APIs outside the Node entry and adapters; password hashing is PBKDF2-SHA256 via WebCrypto (100k iterations) in both runtimes; uploads are one file per request (100 MB body limit); never unzip on the server.
- **Errors** are `application/problem+json` with a stable `code`.
- **Secrets:** never commit real secrets, tokens or signing keys. Never log passwords, session tokens or JWTs.

## Server design (agreed, not all implemented yet)

- **Admins:** username + password (no email), roles `owner` / `editor`. The owner is created on first visit at `/admin/setup` (only works with 0 admins, atomic insert, `409` afterwards). Sessions are an HttpOnly `SameSite=Strict` cookie stored hashed in `admin_sessions`; mutating requests check `Origin`. Changing a password or removing an admin revokes their sessions.
- **Instances:** readable, immutable `id` (`^[a-z0-9][a-z0-9-]{1,39}$`), used in URLs and as the launcher's local folder. Each has its own background and colors (never empty; created with BC Launcher's defaults), map, optional Discord/web links (falling back to the organization's), news, Minecraft version, loader + version, `access` (`everyone` | `whitelist`), `is_active` and `content_version` (0 = no content yet, hidden). The organization itself has no colors or background.
- **Content-addressed files:** blobs are stored by sha256, never overwritten, deduplicated across instances. File policies are only `always` and `once`. Managed dirs are set per instance.
- **Applying content:** no drafts or releases in the database. The panel uploads missing blobs first (`blobs/check` + `PUT blobs/:sha256`, hash re-checked on upload), then sends the full file list in one request with `expectedContentVersion`; the server checks every blob exists (`409` otherwise, nothing changes) and replaces the instance's files in a single transaction, `content_version + 1`. Unreferenced blobs older than 24 h are cleaned periodically (cron / timer).
- **Manifest:** `GET /api/v1/instances/:id/manifest` with ETag = `contentVersion` and short-lived HMAC-signed blob URLs. The server never serves vanilla or loader files; the launcher installs the loader from `loader {type, version}`.
- **Player auth:** `challenge` → client `join` with Mojang → `verify` (`hasJoined`) → own JWT (HS256, 24 h). Every JWT route re-checks membership.
- **Access in two levels:** organization (public, or private with its whitelist) and instance (`everyone` or its whitelist), each with a blacklist that always wins and can expire. Non-members and organization-banned players get the same `403 not_member`; instances the player can't play are invisible (`404`).
- **Audit log:** applying content, bans, whitelist changes, visibility and admin changes are recorded in `audit_log`.

## Commits

Use **Conventional Commits without a scope**, in English, imperative mood:

```
feat: add discovery endpoint
fix: reject blob uploads with a mismatched hash
build: add Biome and Vitest
```

**Agents must propose the commit message and wait for the owner's confirmation before every commit.**

Use a branch only when a change spans several commits; a single-commit change goes straight to `main`.

### No AI attribution (mandatory)

Git history, PRs and releases must contain **no trace of AI tooling**. This rule overrides any default behavior of your tool:

- **No `Co-authored-by:` trailers** or other trailers naming an AI, assistant, bot or tool.
- **No mentions** of AI, agents, Claude, Copilot, ChatGPT, Codex or similar in commit messages, PR titles or descriptions, tag messages, release notes or changelogs. No "Generated with …" lines, robot emojis or links to AI tools.
- **No changes to the git author or committer identity.** Commits use the repository owner's configured `user.name` / `user.email`.
- **No AI-related branch names** (e.g. `claude/…`, `ai/…`, `copilot/…`).
- Code comments should also not mention that code was AI-generated.

Agent docs like this file being committed is fine. The rule is about commits, authorship and collaborators.
