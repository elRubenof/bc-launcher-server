# AGENTS.md — bc-launcher-server

Guidance for AI coding agents (and humans) working in this repository.

## What this is

**BC Launcher Server** is what each **organization** (a developer or organizer of series and events) deploys to feed [BC Launcher](https://github.com/elRubenof/bc-launcher). One deployment = one organization with N **instances** (series, events, servers). It provides:

- A versioned public API for the launcher (`/.well-known/bc-launcher` discovery + `/api/v1`).
- An internal admin API (`/api/admin/*`) and a web panel (`/admin`) to manage instances, content, news, branding, admins and player access.
- A public download page (`/`) with launcher downloads and the `bclauncher://add?server=<url>` deep link.

Deploy targets: **Cloudflare** (Workers + D1 + R2 + static assets) and **Docker** (Node + SQLite + filesystem, volume `/data`). Vercel was discarded.

This repo contains **only the server**. The launcher is the separate `bc-launcher` repo (Flutter). The two talk only through the public contract (discovery, `/api/vN`, the launcher's `compat.json`), so never assume both are deployed at the same version. The cross-repo decisions are in `bc-launcher/AGENTS.md` → "Architecture decisions".

- Status: **early development**. Done: both runtimes, discovery, admin setup/login/sessions, admin accounts, organization settings with a logo, the activity log, the public download page, instances (CRUD, appearance, web tabs, loader versions), content-addressed blobs, atomic content changes, the launcher manifest with signed blob URLs, the orphan blob cleanup, player sign-in with Mojang sessions, organization and instance access (whitelists, bans), news per instance, the panel (setup, login, home, instances with general/appearance/web tabs/content/access/news tabs, players, settings) and publishing (Deploy to Cloudflare button, deployment README, GHCR image, `openapi.json` on releases, `oasdiff`); see "Server design" and "Releases" below.
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
pnpm dev:worker       # build the panel, apply local D1 migrations, wrangler dev on :8787 (no config needed; PUBLIC_URL / JWT_SECRET overrides go in a gitignored .dev.vars)
pnpm dev:web          # panel with hot reload on :5173, proxying the API to :8787 (API_URL to change it)
pnpm build:web        # build the panel to apps/web/dist (served by both runtimes)
pnpm run build        # = build:web; the build command of Deploy to Cloudflare / Workers Builds
pnpm run deploy       # apply D1 migrations remotely and wrangler deploy
pnpm --filter @bc-launcher-server/api dev:node    # Node server on :3000 (env in apps/api/.env, see .env.example)
pnpm --filter @bc-launcher-server/api build:node  # bundle the Node server to apps/api/dist/node.js
docker compose -f docker/docker-compose.yml up --build   # Docker image (settings in docker/.env)
```

CI (`.github/workflows/ci.yml`) runs install (frozen lockfile), lint, typecheck, test, the panel build and the `openapi.json` freshness check on every push and pull request, checks `/api/v1` and discovery for breaking changes with `oasdiff` (job `api-compat`), and builds and smoke-tests the Docker image. `.github/workflows/release.yml` runs on `vX.Y.Z` tags (see "Releases").

## Project layout

```
apps/
  api/
    src/app.ts            createApp(resolvePlatform): the runtime-agnostic Hono app (OpenAPIHono)
    src/routes/           route handlers, one file per area (discovery, setup, auth, settings,
                          assets, admins, activity, instances, blobs, content, loaders, launcher,
                          player-auth, access-lists, players, news)
    src/*.ts              shared logic: instances (default background), content (diff, apply
                          batch), blobs, loaders (upstream metadata), signed-urls, cleanup (blobs
                          and expired bans), access (membership and instance access as SQL),
                          mojang (hasJoined, profile lookups), players
    src/auth/             WebCrypto helpers, PBKDF2 passwords, admin sessions, managersOnly(),
                          player-tokens (challenges and player JWTs)
    src/middleware/       sameOrigin (CSRF), requireAdmin for /api/admin/*, requirePlayer for the
                          launcher routes that need a player token
    src/platform/         Platform interface, config, in-memory BlobStore; node/ (libSQL, migrations,
                          filesystem blobs, static web) and worker/ (R2) adapters
    src/entry/            node.ts (@hono/node-server) and worker.ts (Cloudflare fetch handler)
    scripts/openapi.ts    writes packages/contracts/openapi.json
    test/                 Vitest; blob-store.ts is the shared BlobStore contract test
  web/
    src/router.tsx        TanStack Router (code-based): "/" (public download page), /admin/setup,
                          /admin/login and the signed-in panel (/admin, /admin/instances/...,
                          /admin/players/..., /admin/settings/...)
    src/routes/           pages and their pieces
    src/components/ui/    shadcn/ui-style primitives (Radix + Tailwind), themed in src/index.css
    src/i18n/             es (source of keys) and en strings, useI18n()
    src/lib/              API client (apiRequest, ApiError), TanStack Query options, validation,
                          markdown (the small renderer of the news preview)
    src/lib/content/      content editor: draft model (diff, rebase), import (folder, zip, drop;
                          hashing), background uploads
packages/
  contracts/    zod schemas + @hono/zod-openapi route definitions; openapi.json (generated, committed);
                `paths.ts` and `web-tabs.ts` (exported as `@bc-launcher-server/contracts/paths` and
                `/web-tabs`) have no imports so the panel validates instance paths and web tabs exactly
                like the API without bundling zod
  db/           Drizzle schema (SQLite), the shared Database type and migrations/ (drizzle-kit, used by D1 and Node)
docker/         Dockerfile (Node 22, multi-stage), docker-compose.yml example
wrangler.jsonc  Worker config: D1 (DB), R2 (BLOBS), static assets (apps/web/dist), hourly cron (orphan
                blobs and expired bans); also what the Deploy to Cloudflare button provisions
.github/        workflows/ci.yml (checks, oasdiff, Docker smoke test), workflows/release.yml (GHCR, release)
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
  - `config`: `PUBLIC_URL`, `JWT_SECRET`, `playerAuth` and `mojangSessionUrl` (`loadConfig` reads the env, `resolveConfig` completes it). `playerAuth` comes from the runtime and `MOJANG_SESSION_URL`, never from a failure: Node is always `mojang-session`; the Worker is `unverified` unless `MOJANG_SESSION_URL` points at a session proxy (see "Player auth"). `JWT_SECRET` is the only secret (admin sessions are random tokens stored hashed, nothing signed) and needs no configuration: unless the env sets one (32+ characters, so placeholders like `change-me` are refused), the server generates 256 random bits on first use and keeps them in the `server_secrets` table (`getOrCreateSecret` in `platform/secrets.ts`; concurrent first calls agree through `ON CONFLICT DO NOTHING` + read back). So the Worker's platform is resolved asynchronously and cached as a promise; Node resolves it at startup after migrating. Anything new that needs signing derives its own key from `JWT_SECRET` with a new prefix. `PUBLIC_URL` is required on Node; on Workers it is optional and defaults to the request's origin (the platform is cached per env and origin), because the Deploy to Cloudflare flow can't know the `workers.dev` address beforehand. The cron handler gets only `db` and `blobs`.
  - `fetch`: outgoing HTTP (Mojang and loader metadata), injected so tests stub it (`stubFetch()` in `test/helpers.ts`; `mojangFetch()` also answers `hasJoined` and profile lookups from `PROFILES`, and `playerAuth()` signs a test player in).
- **D1 limits:** at most 5 terms in a compound `SELECT` (`UNION`), so "is it referenced anywhere" checks use one `NOT EXISTS` per table (`cleanup.ts`); at most 100 bound parameters per statement, so lists (hashes, files) go in as one JSON parameter read with `json_each` (`apps/api/src/blobs.ts`, `content.ts`). A conditional batch is built from statements guarded by the same `exists(...)` condition, with the version bump last and `returning()`, so the caller can tell whether anything was written (`applyContentStatements`).
- **Route order:** `/api/admin/instances/{id}/{kind}` also matches other sub-paths, so routes like `/content`, `/access`, `/whitelist`, `/blacklist` and `/news` are registered before the instance routes in `app.ts`, and `/tabs` before the image routes in `routes/instances.ts`.
- **Launcher auth:** `requirePlayer` is mounted in `app.ts` on the launcher paths that need a token (`/api/v1/instances`, `/api/v1/instances/*`); a new launcher route under another path must be added there and declare `security: playerAuth` plus `playerAuthResponses` in its contract. Blob downloads and assets stay token-free (signed URLs, public images).
- **Workers constraints apply to shared code:** no Node APIs outside the Node entry and adapters; password hashing is PBKDF2-SHA256 via WebCrypto (100k iterations) in both runtimes; uploads are one file per request (100 MB body limit); never unzip on the server.
- **Migrations** are generated with `pnpm db:generate`, never hand-written, and never edited once released. Seed rows (like the `settings` row) are appended to the generated SQL.
- **Errors** are `application/problem+json` with a stable `code` (`problem()` in `apps/api/src/problem.ts`); request validation failures are `400 validation_error`.
- **Admin API** (`/api/admin/*`): every route needs a session except setup and login (`requireAdmin`), and every mutating request must come from the deployment's own origin (`sameOrigin`). The Vite dev proxy rewrites `Origin` so this also works on :5173. Handlers that editors can't use start with `managersOnly(c)`; handlers that act on another account go through `findTarget()` in `routes/admins.ts`, which refuses your own account and the owner's. Every change an admin makes is recorded in `audit_log` with a stable `action` code, and the panel turns each code into a sentence (`routes/settings-activity.tsx`); add both when adding an action.
- **Panel UI:** all user-facing text goes through `useI18n().t()`, with the key added to **both** `src/i18n/es.ts` and `en.ts`. Follow the panel mockups (dark theme, colors in `src/index.css`). Accessible markup: real buttons, links and labelled inputs.
- **Secrets:** never commit real secrets, tokens or signing keys. Never log passwords, session tokens or JWTs.
- **Deploy to Cloudflare** reads the root `package.json`: the `build` and `deploy` scripts (prefilled as build and deploy commands), the `cloudflare.bindings` descriptions shown in the flow. It would also ask for the secrets listed in a `.dev.vars.example` or `.env.example` at the root; there are none, because the server needs no secret configuration. The root `deploy` script shadows pnpm's own `pnpm deploy` command, so the Dockerfile deletes it before using that command. The repo root must stay a deployable Worker (no `database_id` in `wrangler.jsonc`, resources provisioned by the flow). Keep `README.md` → "Deploy" in step with any change to secrets, variables or deployment.

## Server design

Implemented except where noted: Mojang player certificates for Workers (see "Player auth") are not done.

- **Capabilities:** discovery's `capabilities` lists the optional features this server has, so the launcher knows before making any request (no `serverVersion` checks, no probing for `404`). Empty for now: everything in the first release is the baseline of `/api/v1` and is never announced. Rules:
  - Announce a capability only for a feature added to an already released API version that the launcher must detect, e.g. a new endpoint (`server-status`), a new manifest field (`optional-mods`) or a request option (`manifest-delta`). Also for features an admin can turn off: announce it only while it is on.
  - It is a property of the whole server, never of one instance. Per-instance data (an instance's web tabs or news) goes in the instance's own fields.
  - Booleans only: a mode with several values gets its own discovery field, like `auth.type`.
  - kebab-case names; a name's meaning never changes and is never reused.
  - A new API version takes the previous version's capabilities into its baseline and stops announcing them.
  - Document each capability here and in its contract when adding it.

- **Accounts and roles:** username + password (no email, usernames stored lowercase). Three roles:
  - `owner`: exactly one (unique partial index), the account created at `/admin/setup`. Everything, and can act on any other account.
  - `admin`: the same as the owner except it can never remove, demote or reset the password of the owner.
  - `editor`: instances, content, news and players; sees the settings, accounts and activity but can't change them.
  - Accounts can be created as `admin` or `editor` only, and moved between those two. Nobody can act on their own account from the account management (they use their own password change), and nobody can act on the owner, so there is always exactly one owner.
  - Setup only works with 0 accounts. It is atomic because the setup batch also inserts the single `setup_lock` row, so a second setup fails and rolls back (`409`).
  - Sessions are a random token in an HttpOnly `SameSite=Strict` cookie (`__Host-` prefixed over HTTPS), stored as its sha256 in `admin_sessions`, with a 7-day sliding expiry. The role is read from the database on every request, so a role change applies at once. Changing or resetting a password ends the other sessions; removing an account ends all of its sessions.
- **Organization settings:** name, description, logo, global Discord/web links, visibility and minimum launcher version, in the single `settings` row; discovery serves them. The logo is the organization's only image (there is no separate icon; migration 0006 dropped it, keeping an icon as the logo where there was no logo): the launcher's organization picker and add dialog, the public page, the panel's sidebar and login (`BrandMark`, initials while there is none) and the favicon (`OrganizationFavicon`). It is a PNG/JPEG/WebP/GIF up to 2 MB (type detected from the bytes, SVG refused), stored in the BlobStore and in `blobs` with their `content_type`, and served from `/api/v1/assets/<sha256>` as immutable (only blobs with a content type are served there).
- **Public page (`/`):** the organization's name, logo and links, the official launcher downloads (GitHub Releases of `bc-launcher`) and the `bclauncher://add?server=<origin>` deep link. Same for public and private organizations.
- **Instances:** readable, immutable `id` (`^[a-z0-9][a-z0-9-]{1,39}$`), used in URLs and as the launcher's local folder. Each has its own background and colors (never empty; created with BC Launcher's colors and its default background, a WebP embedded in `apps/api/src/default-background.ts` and put in the BlobStore on first use), icon, web tabs, optional Discord/web links (falling back to the organization's in the launcher API), server address, recommended RAM, Minecraft version, loader + version, `access` (`everyone` | `whitelist`), `is_active` and `content_version` (0 = no content yet, hidden). New instances get `mods` as a managed folder. Editors can create, edit and delete instances. The organization itself has no colors or background.
- **Web tabs:** up to 5 per instance, shown by the launcher in order between its fixed Home and Settings tabs (they replace the old map; migration 0007 turned each map into a "Mapa" tab). Each has a `label` (1–24 characters), a `url` (http(s), up to 500 characters), an `icon` from a fixed set of 10 (`WEB_TAB_ICONS` in `contracts/src/web-tabs.ts`, the same names the launcher draws) and `openIn`: `launcher` (a webview inside the tab) or `browser` (the system browser opens and the launcher stays on its current screen). The URL may contain `{uuid}` and `{name}`, which the launcher replaces with the signed-in player's uuid and name; any other brace is refused. Stored as JSON in `instances.tabs` and replaced as a whole list with `PUT /api/admin/instances/:id/tabs` (open to editors, logged as `instance.tabs_changed` only when the list changes). The panel edits them in the instance's "Web tabs" section and saves every change at once.
- **Loader versions:** `GET /api/admin/minecraft/versions` (Mojang's manifest) and `GET /api/admin/loaders/:type/versions?mc=` (Fabric/Quilt meta, Forge/NeoForge maven metadata; NeoForge numbers follow Minecraft's, `1.21.1` → `21.1.x`), cached in memory for 10 minutes. Creating an instance and applying content with a changed version check the combination (`400 invalid_version`, `502 metadata_unavailable` when upstream is down).
- **Content-addressed files:** every file is a row in `blobs` (sha256, size, content type for images, `orphaned_at`), stored by sha256, never overwritten, deduplicated across instances. File policies are only `always` and `once`. Managed dirs are set per instance. Paths are relative posix paths valid on Windows too (`contracts/src/paths.ts`); `versions/`, `libraries/` and `assets/` belong to the launcher, and paths that clash on a case-insensitive disk are refused (`path_conflict`).
- **Applying content:** no drafts or releases in the database. The panel uploads missing blobs first (`blobs/check` + `PUT blobs/:sha256`, up to 100 MB each, hash verified by the BlobStore), then sends the full file list in one request with `expectedContentVersion`; the server checks every blob exists (`409 missing_blobs` otherwise, nothing changes) and replaces the instance's files, managed dirs and versions in a single guarded batch, `content_version + 1`, logging `instance.content_applied` with the diff. If another change lands first: `409 content_conflict`.
- **Panel content editor:** the draft lives in the browser and is kept in IndexedDB per admin and instance (paths and hashes, not the files), so it can be continued after closing the panel, replayed on top if the server changed meanwhile; files that weren't uploaded must be imported again. import a folder, a zip (streamed with fflate) or dropped files, hashed with WebCrypto; launcher folders, worlds, logs and system junk are left out; `options.txt` and `servers.dat` default to `once`. Uploads start at once (three at a time, XHR for progress); "Review and apply" is enabled when everything is uploaded. On `content_conflict` the pending changes are replayed on the new content and the paths both sides touched are listed. Leaving only warns while uploads are unfinished.
- **Orphan cleanup:** hourly (Workers cron, Node timer), together with deleting expired bans (`runCleanup` in `cleanup.ts`). It marks unreferenced blobs (`orphaned_at`), unmarks referenced ones, and deletes those unreferenced for 24 h (max 200 per run). References are instance files, instance icons and backgrounds, news images and the organization's logo. `blobs/check` and uploads reset the mark.
- **Launcher API:** `GET /api/v1/instances` (the instances the player can play, newest first, links resolved, with their web tabs), `GET /api/v1/instances/:id/manifest` and `GET /api/v1/instances/:id/news`, all with a player token. The manifest's blob URLs (`/api/v1/blobs/:sha256?exp=&sig=`, HMAC-SHA256 with a key derived from `JWT_SECRET`) expire at the end of the next 6-hour window, so they are valid 6 to 12 hours and identical within a window; the ETag is `"<contentVersion>.<window>"`. The server never serves vanilla or loader files; the launcher installs the loader from `loader {type, version}`.
- **Player auth:** Mojang blocks requests from Cloudflare Workers (`403` on `api.mojang.com` and `sessionserver.mojang.com`), so there are two modes, announced in discovery's `auth.type`. `mojang-session` (Docker, or a Worker with `MOJANG_SESSION_URL`): the flow below, with `hasJoined` asked at `mojangSessionUrl` (Mojang or a proxy of it). `unverified` (a Worker without it): `verify` still checks the challenge but then only looks the name up (playerdb.co, see "Players") and trusts it, so anyone can claim any name; the panel shows a warning in Settings and the README explains the consequences. The mode is configuration only: never fall back to `unverified` because Mojang failed. A real fix for Workers would be Mojang's player certificates (signed public keys, verifiable offline); not done. `POST /api/v1/auth/challenge` returns a `serverId` (40 hex digits: expiry, nonce and a truncated HMAC, so nothing is stored; valid 5 minutes) → the launcher calls Mojang's `join` with it (its Minecraft token never leaves the launcher) → `POST /api/v1/auth/verify {username, serverId}` checks the challenge and Mojang's `hasJoined` (`401 invalid_challenge` / `not_joined`, `502 mojang_unavailable`), records the player (first and last access, current name; non-members too, so admins can whitelist them) and, for members, returns our own JWT (HS256, 24 h, `sub` = uuid). Every key is derived from `JWT_SECRET` with its own prefix (`auth-challenge:`, `player-jwt:`, `blob-urls:`), so a value signed for one purpose is never valid for another. `requirePlayer` re-checks membership on every request, so bans and whitelist removals apply at once (`401 unauthenticated` for a missing, invalid or expired token).
- **Players:** uuid (lowercase with dashes), last known name, first and last access (`null` if added by name and never joined). Lists accept a Minecraft name or a uuid (uuid: local first), looked up on playerdb.co (a mirror of Mojang's profiles that answers Workers; up to a month stale) with Mojang as the fallback (`lookUp` in `mojang.ts`; names change hands, so never matched locally). The panel shows each player's head from `crafthead.net/avatar/<uuid>` (the avatar playerdb links to), with the initial as a fallback (`PlayerAvatar`). `GET /api/admin/players` (search by name or uuid start, `status` and `instance` filters, offset pages with `total`) and `GET /api/admin/players/:uuid` (organization status and each instance's access, whitelist and ban).
- **Access in two levels** (`apps/api/src/access.ts`, as SQL conditions used by the launcher and the panel): organization member = no active `org_blacklist` entry and (public or on `org_whitelist`); instance access = launchable (active, with content), no active `instance_blacklist` entry and (`everyone` or on `instance_whitelist`). Bans always win and can expire (`expires_at`; expired ones stop counting at once and the hourly cleanup deletes them); banning doesn't touch whitelists, so lifting a ban restores exactly the previous access. Non-members and organization-banned players get the same `403 not_member`; instances the player can't play are absent from the list and `404` on the manifest. Admin routes: `/api/admin/{whitelist,blacklist}` and `/api/admin/instances/:id/{whitelist,blacklist,access}`, open to editors. Banning someone already banned replaces the reason and expiry. Going from public to private can whitelist everyone who already joined in the same batch (`whitelistJoinedPlayers`). Deleting an instance deletes its lists.
- **News:** belongs to one instance (no organization-wide news): title, markdown body (up to 20 000 characters), optional image, optional link for the launcher's "Open" button, `pinned` and `published_at` (a future date = scheduled). Images are uploaded first with `POST /api/admin/images` (same rules as the logo; unused ones are deleted by the orphan cleanup) and referenced by sha256 when saving. Admin routes `/api/admin/instances/:id/news[/:newsId]`, open to editors, list scheduled news too. The launcher gets published news only, pinned first and then newest first, 20 per page with an opaque `cursor` (keyset on pinned, `published_at`, id); an instance the player can't play is `404`. Deleting an instance deletes its news. The panel previews the markdown with its own small renderer (headings, `**bold**`, `*italic*`, lists, `code`, http(s) links; `_` is left alone because Minecraft names use it).
- **Update notice:** `GET /api/admin/updates` (owner and admins) compares `SERVER_VERSION` with the latest release, read from the redirect of `github.com/elRubenof/bc-launcher-server/releases/latest` (`HEAD`, no redirect following) rather than GitHub's API, whose unauthenticated per-IP limit Workers share. Cached in memory 6 hours (30 minutes after a failure); any failure just means `latest: null`. The panel shows a notice in the sidebar with links to the release notes and the README's "Updating". Updating itself stays manual.
- **Audit log:** applying content, bans (`player.banned`/`player.unbanned`), whitelist changes (`whitelist.added`/`whitelist.removed`, with `instance` in the details for instance lists), instance access, web tabs (`instance.tabs_changed`), news (`news.created`/`updated`/`deleted`), visibility and admin changes are recorded in `audit_log`.

## Releases

- Versions are `vX.Y.Z` tags on `main`, SemVer, starting at `0.1.0`. The version lives in `apps/api/package.json` (reported as `serverVersion` in discovery); a release is a `chore: release vX.Y.Z` commit that only bumps it, then the tag on that commit. Tags and releases are created only with the owner's approval.
- `release.yml` checks that the tag matches the version, publishes the Docker image to `ghcr.io/elrubenof/bc-launcher-server` (`linux/amd64` + `linux/arm64`, tags `X.Y.Z`, `X.Y` and `latest`) and then creates the GitHub release with generated notes and `packages/contracts/openapi.json` attached, for the launcher to check its models against.
- `oasdiff` (CI job `api-compat`, pinned version and checksum) compares `/api/v1/*` and `/.well-known/*` with the `openapi.json` of the latest `vX.Y.Z` tag and fails on breaking changes. Before the first release it is skipped: nothing is published, so the contract can still change. Admin routes are not checked: the panel ships with the API.

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
