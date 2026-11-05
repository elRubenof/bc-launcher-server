# AGENTS.md — bc-launcher-server

Guidance for AI coding agents (and humans) working in this repository.

## What this is

**BC Launcher Server** is what each **organization** (a developer or organizer of series and events) deploys to feed [BC Launcher](https://github.com/elRubenof/bc-launcher). One deployment = one organization with N **instances** (series, events, servers). It provides:

- A versioned public API for the launcher (`/.well-known/bc-launcher` discovery + `/api/v1`).
- An internal admin API (`/api/admin/*`) and a web panel (`/admin`) to manage instances, content, news, branding, admins and player access.
- A public download page (`/`) with launcher downloads and the `bclauncher://add?server=<url>` deep link.

Deploy targets: **Cloudflare** (Workers + D1 + R2 + static assets) and **Docker** (Node + SQLite + filesystem, volume `/data`). Vercel was discarded.

This repo contains **only the server**. The launcher is the separate `bc-launcher` repo (Flutter). The two talk only through the public contract (discovery, `/api/vN`, the launcher's `compat.json`), so never assume both are deployed at the same version. The cross-repo decisions are in `bc-launcher/AGENTS.md` → "Architecture decisions".

- Status: **early development**. Done: both runtimes, discovery, admin setup/login/sessions, admin accounts, organization settings with logo and icon, the activity log, the public download page, instances (CRUD, appearance, loader versions), content-addressed blobs, atomic content changes, the launcher manifest with signed blob URLs, the orphan blob cleanup, and the panel (setup, login, home, instances with general/appearance/content tabs, settings). Player auth and access, and news, are next; see "Server design" below.
- License: GPL-3.0 (`LICENSE`).

## Commands

Requires Node ≥ 22.12 (`.nvmrc`: 22) and pnpm (version pinned in `package.json` → `packageManager`; install it with `npm i -g pnpm@<that version>` if `corepack` isn't available).

```bash
pnpm install          # install all workspace dependencies
pnpm lint             # Biome lint + format check (must pass before committing)
pnpm format           # apply Biome fixes and formatting
pnpm typecheck        # tsc in every package that defines a typecheck script
pnpm test             # Vitest
pnpm openapi          # regenerate packages/contracts/openapi.json (commit it with any contract change)
pnpm db:generate      # generate a migration from packages/db/src/schema.ts (drizzle-kit)
pnpm dev:worker       # build the panel, apply local D1 migrations, wrangler dev on :8787 (secrets in .dev.vars, see .dev.vars.example)
pnpm dev:web          # panel with hot reload on :5173, proxying the API to :8787 (API_URL to change it)
pnpm build:web        # build the panel to apps/web/dist (served by both runtimes)
pnpm --filter @bc-launcher-server/api dev:node    # Node server on :3000 (env in apps/api/.env, see .env.example)
pnpm --filter @bc-launcher-server/api build:node  # bundle the Node server to apps/api/dist/node.js
docker compose -f docker/docker-compose.yml up --build   # Docker image (secrets in docker/.env)
```

CI (`.github/workflows/ci.yml`) runs install (frozen lockfile), lint, typecheck, test, the panel build and the `openapi.json` freshness check on every push and pull request, and builds and smoke-tests the Docker image.

## Project layout

```
apps/
  api/
    src/app.ts            createApp(resolvePlatform): the runtime-agnostic Hono app (OpenAPIHono)
    src/routes/           route handlers, one file per area (discovery, setup, auth, settings,
                          assets, admins, activity, instances, blobs, content, loaders, launcher)
    src/*.ts              shared logic: instances (default background), content (diff, apply
                          batch), blobs, loaders (upstream metadata), signed-urls, cleanup
    src/auth/             WebCrypto helpers, PBKDF2 passwords, admin sessions, managersOnly()
    src/middleware/       sameOrigin (CSRF) and requireAdmin for /api/admin/*
    src/platform/         Platform interface, config, in-memory BlobStore; node/ (libSQL, migrations,
                          filesystem blobs, static web) and worker/ (R2) adapters
    src/entry/            node.ts (@hono/node-server) and worker.ts (Cloudflare fetch handler)
    scripts/openapi.ts    writes packages/contracts/openapi.json
    test/                 Vitest; blob-store.ts is the shared BlobStore contract test
  web/
    src/router.tsx        TanStack Router (code-based): "/" (public download page), /admin/setup,
                          /admin/login and the signed-in panel (/admin, /admin/instances/...,
                          /admin/settings/...)
    src/routes/           pages and their pieces
    src/components/ui/    shadcn/ui-style primitives (Radix + Tailwind), themed in src/index.css
    src/i18n/             es (source of keys) and en strings, useI18n()
    src/lib/              API client (apiRequest, ApiError), TanStack Query options, validation
    src/lib/content/      content editor: draft model (diff, rebase), import (folder, zip, drop;
                          hashing), background uploads
packages/
  contracts/    zod schemas + @hono/zod-openapi route definitions; openapi.json (generated, committed);
                `paths.ts` (exported as `@bc-launcher-server/contracts/paths`) has no imports so the
                panel validates instance paths exactly like the API without bundling zod
  db/           Drizzle schema (SQLite), the shared Database type and migrations/ (drizzle-kit, used by D1 and Node)
docker/         Dockerfile (Node 22, multi-stage), docker-compose.yml example
wrangler.jsonc  Worker config: D1 (DB), R2 (BLOBS), static assets (apps/web/dist), hourly cron (orphan
                blob cleanup); the deploy button is planned
tsconfig.base.json, biome.json, vitest.config.ts, pnpm-workspace.yaml
```

## Conventions

- **TypeScript strict** everywhere. Every package extends `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `types: []`: each package declares the runtime types it needs).
- **Biome** formats and lints (2 spaces, double quotes, 100 columns). Don't add ESLint or Prettier.
- **Vitest** for tests. API tests use `app.request()` with in-memory SQLite and an in-memory `BlobStore`.
- **Dependencies:** pin exact versions. pnpm enforces a minimum release age; don't add `minimumReleaseAgeExclude` entries to get around it, pick an older version instead. Packages allowed to run install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml`.
- **Workspace packages** (`packages/*`) are consumed as TypeScript source (`exports` points at `src/`), so there is no build step between them. Libraries whose types must be shared with the app (`drizzle-orm`, `hono`, `zod`, `@hono/zod-openapi`) are **peer dependencies** of the package (plus dev dependencies for its own typecheck). `packages/db` also lists drizzle's optional peers that the app installs (`@libsql/client`, `@cloudflare/workers-types`) as dev dependencies, so pnpm resolves a single `drizzle-orm` instance; otherwise types like `SQL` stop matching.
- **One tsconfig per runtime in `apps/api`:** `tsconfig.common.json` (shared code, web APIs only), `tsconfig.node.json` (Node adapters, entry, tests and scripts, with `@types/node`) and `tsconfig.worker.json` (Worker adapters and entry, with `@cloudflare/workers-types`). Importing a Node API from shared code fails the typecheck.
- **Contracts first:** the zod schemas in `packages/contracts` are the source of truth. `openapi.json` is generated from them and must be committed up to date. Never break `/api/v1` or the discovery format (`discoveryVersion`); breaking changes need a new API version.
- **Runtime-agnostic core:** everything that differs between Cloudflare and Docker goes behind `Platform { db, blobs, config }` (`apps/api/src/platform/types.ts`), resolved per request from the runtime's bindings and read in handlers as `c.var.platform`:
  - `db`: Drizzle on D1 (Workers) or libSQL on a local SQLite file, `/data/db.sqlite` (Node). Both are async and support `batch()`, the only way to write atomically on D1, so atomic writes use `db.batch()` and never interactive transactions. Inside `batch()` use only query builders: Drizzle's D1 driver fails on raw SQL with parameters (`db.run(sql…)`) there. Test anything that uses `batch()` under `wrangler dev` too, since tests only run libSQL. Same migrations; Node applies them on start, Cloudflare with `wrangler d1 migrations apply`.
  - `blobs` (`BlobStore`: `head/get/put/delete`, streaming, keys must be lowercase sha256 hex): R2 or `/data/blobs/<sha256[0..2]>/<sha256>`. `put` must verify that the bytes hash to the key and throw `BlobMismatchError` without storing anything otherwise (R2 through its `sha256` put option, the filesystem while streaming to a `.part` file). Every adapter runs the shared contract test in `test/blob-store.ts`.
  - `config`: `PUBLIC_URL`, `SESSION_SECRET`, `JWT_SECRET` from env/secrets.
  - `fetch`: outgoing HTTP (Mojang and loader metadata), injected so tests stub it (`stubFetch()` in `test/helpers.ts`).
- **D1 limits:** at most 100 bound parameters per statement, so lists (hashes, files) go in as one JSON parameter read with `json_each` (`apps/api/src/blobs.ts`, `content.ts`). A conditional batch is built from statements guarded by the same `exists(...)` condition, with the version bump last and `returning()`, so the caller can tell whether anything was written (`applyContentStatements`).
- **Route order:** `PUT /api/admin/instances/{id}/{kind}` also matches other sub-paths, so routes like `/content` are registered before the instance routes in `app.ts`.
- **Workers constraints apply to shared code:** no Node APIs outside the Node entry and adapters; password hashing is PBKDF2-SHA256 via WebCrypto (100k iterations) in both runtimes; uploads are one file per request (100 MB body limit); never unzip on the server.
- **Migrations** are generated with `pnpm db:generate`, never hand-written, and never edited once released. Seed rows (like the `settings` row) are appended to the generated SQL.
- **Errors** are `application/problem+json` with a stable `code` (`problem()` in `apps/api/src/problem.ts`); request validation failures are `400 validation_error`.
- **Admin API** (`/api/admin/*`): every route needs a session except setup and login (`requireAdmin`), and every mutating request must come from the deployment's own origin (`sameOrigin`). The Vite dev proxy rewrites `Origin` so this also works on :5173. Handlers that editors can't use start with `managersOnly(c)`; handlers that act on another account go through `findTarget()` in `routes/admins.ts`, which refuses your own account and the owner's. Every change an admin makes is recorded in `audit_log` with a stable `action` code, and the panel turns each code into a sentence (`routes/settings-activity.tsx`); add both when adding an action.
- **Panel UI:** all user-facing text goes through `useI18n().t()`, with the key added to **both** `src/i18n/es.ts` and `en.ts`. Follow the panel mockups (dark theme, colors in `src/index.css`). Accessible markup: real buttons, links and labelled inputs.
- **Secrets:** never commit real secrets, tokens or signing keys. Never log passwords, session tokens or JWTs.

## Server design (agreed, not all implemented yet)

- **Accounts and roles:** username + password (no email, usernames stored lowercase). Three roles:
  - `owner`: exactly one (unique partial index), the account created at `/admin/setup`. Everything, and can act on any other account.
  - `admin`: the same as the owner except it can never remove, demote or reset the password of the owner.
  - `editor`: instances, content, news and players; sees the settings, accounts and activity but can't change them.
  - Accounts can be created as `admin` or `editor` only, and moved between those two. Nobody can act on their own account from the account management (they use their own password change), and nobody can act on the owner, so there is always exactly one owner.
  - Setup only works with 0 accounts. It is atomic because the setup batch also inserts the single `setup_lock` row, so a second setup fails and rolls back (`409`).
  - Sessions are a random token in an HttpOnly `SameSite=Strict` cookie (`__Host-` prefixed over HTTPS), stored as its sha256 in `admin_sessions`, with a 7-day sliding expiry. The role is read from the database on every request, so a role change applies at once. Changing or resetting a password ends the other sessions; removing an account ends all of its sessions.
- **Organization settings:** name, description, logo, icon, global Discord/web links, visibility and minimum launcher version, in the single `settings` row; discovery serves them. Logo and icon are PNG/JPEG/WebP/GIF up to 2 MB (type detected from the bytes, SVG refused), stored in the BlobStore and in `blobs` with their `content_type`, and served from `/api/v1/assets/<sha256>` as immutable (only blobs with a content type are served there).
- **Public page (`/`):** the organization's name, logo and links, the official launcher downloads (GitHub Releases of `bc-launcher`) and the `bclauncher://add?server=<origin>` deep link. Same for public and private organizations.
- **Instances:** readable, immutable `id` (`^[a-z0-9][a-z0-9-]{1,39}$`), used in URLs and as the launcher's local folder. Each has its own background and colors (never empty; created with BC Launcher's colors and its default background, a WebP embedded in `apps/api/src/default-background.ts` and put in the BlobStore on first use), icon, map, optional Discord/web links (falling back to the organization's in the launcher API), server address, recommended RAM, Minecraft version, loader + version, `access` (`everyone` | `whitelist`), `is_active` and `content_version` (0 = no content yet, hidden). New instances get `mods` as a managed folder. Editors can create, edit and delete instances. The organization itself has no colors or background.
- **Loader versions:** `GET /api/admin/minecraft/versions` (Mojang's manifest) and `GET /api/admin/loaders/:type/versions?mc=` (Fabric/Quilt meta, Forge/NeoForge maven metadata; NeoForge numbers follow Minecraft's, `1.21.1` → `21.1.x`), cached in memory for 10 minutes. Creating an instance and applying content with a changed version check the combination (`400 invalid_version`, `502 metadata_unavailable` when upstream is down).
- **Content-addressed files:** every file is a row in `blobs` (sha256, size, content type for images, `orphaned_at`), stored by sha256, never overwritten, deduplicated across instances. File policies are only `always` and `once`. Managed dirs are set per instance. Paths are relative posix paths valid on Windows too (`contracts/src/paths.ts`); `versions/`, `libraries/` and `assets/` belong to the launcher, and paths that clash on a case-insensitive disk are refused (`path_conflict`).
- **Applying content:** no drafts or releases in the database. The panel uploads missing blobs first (`blobs/check` + `PUT blobs/:sha256`, up to 100 MB each, hash verified by the BlobStore), then sends the full file list in one request with `expectedContentVersion`; the server checks every blob exists (`409 missing_blobs` otherwise, nothing changes) and replaces the instance's files, managed dirs and versions in a single guarded batch, `content_version + 1`, logging `instance.content_applied` with the diff. If another change lands first: `409 content_conflict`.
- **Panel content editor:** the draft lives in the browser and is kept in IndexedDB per admin and instance (paths and hashes, not the files), so it can be continued after closing the panel, replayed on top if the server changed meanwhile; files that weren't uploaded must be imported again. import a folder, a zip (streamed with fflate) or dropped files, hashed with WebCrypto; launcher folders, worlds, logs and system junk are left out; `options.txt` and `servers.dat` default to `once`. Uploads start at once (three at a time, XHR for progress); "Review and apply" is enabled when everything is uploaded. On `content_conflict` the pending changes are replayed on the new content and the paths both sides touched are listed. Leaving only warns while uploads are unfinished.
- **Orphan cleanup:** hourly (Workers cron, Node timer). It marks unreferenced blobs (`orphaned_at`), unmarks referenced ones, and deletes those unreferenced for 24 h (max 200 per run). References are instance files, instance icons and backgrounds and the organization's logo and icon. `blobs/check` and uploads reset the mark.
- **Launcher API:** `GET /api/v1/instances` (active instances with content, newest first, links resolved) and `GET /api/v1/instances/:id/manifest`. The manifest's blob URLs (`/api/v1/blobs/:sha256?exp=&sig=`, HMAC-SHA256 with a key derived from `JWT_SECRET`) expire at the end of the next 6-hour window, so they are valid 6 to 12 hours and identical within a window; the ETag is `"<contentVersion>.<window>"`. Until player auth exists these endpoints need no token. The server never serves vanilla or loader files; the launcher installs the loader from `loader {type, version}`.
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
