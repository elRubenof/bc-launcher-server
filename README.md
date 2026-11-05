# BC Launcher Server

Server for [BC Launcher](https://github.com/elRubenof/bc-launcher). Each organization (a developer or organizer of series and events) deploys its own server to manage its instances, files, news, branding and player access, and BC Launcher syncs from it.

It includes a versioned API for the launcher, an admin panel (`/admin`) and a public download page (`/`), and it can be deployed to Cloudflare (Workers + D1 + R2) or with Docker.

## Status

Early versions (`0.x`). The launcher API (`/api/v1`) and the discovery document are kept backwards compatible; the admin panel and its internal API may still change.

## Deploy

One deployment is one organization. Pick one of the two targets.

### Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/elRubenof/bc-launcher-server)

You need a Cloudflare account with R2 enabled (Cloudflare may ask for a payment method to enable R2, even within its free tier).

1. Click the button and sign in. Cloudflare copies this repository to your GitHub or GitLab account and creates the Worker, a D1 database (`DB`) and an R2 bucket (`BLOBS`). You can keep the suggested names.
2. Keep the build settings it fills in: build command `pnpm run build`, deploy command `pnpm run deploy` (it applies the database migrations, then deploys the Worker). No secrets are needed.
3. Deploy. When the build finishes (a couple of minutes), [open the panel right away](#after-deploying-open-the-panel-right-away) at `https://<worker>.<your-subdomain>.workers.dev/admin`; the build log prints that address at the end. The `workers.dev` address is always enabled by the deployment (`workers_dev` in `wrangler.jsonc`), even if the Worker's Domains tab shows it switched off.

The server uses the address each request comes in on as its public URL, so it works on `workers.dev` and on a custom domain (Worker → Settings → Domains & Routes) without changes. To always use one address, add a `PUBLIC_URL` variable (e.g. `https://launcher.example.com`) in the Worker's settings.

An hourly cron trigger removes files that are no longer used and expired bans.

<details>
<summary>Deploying without the button (Wrangler)</summary>

```bash
git clone https://github.com/elRubenof/bc-launcher-server && cd bc-launcher-server
pnpm install
pnpm exec wrangler login
pnpm exec wrangler d1 create bc-launcher-server         # add the printed database_id to wrangler.jsonc
pnpm exec wrangler r2 bucket create bc-launcher-server-blobs
pnpm run build && pnpm run deploy
```

</details>

### Docker

The image `ghcr.io/elrubenof/bc-launcher-server` (`linux/amd64` and `linux/arm64`) runs the Node server on port `3000` and keeps everything (SQLite database and files) in the `/data` volume. Put it behind a reverse proxy with TLS (Caddy, Traefik, nginx…).

```yaml
# docker-compose.yml
services:
  server:
    image: ghcr.io/elrubenof/bc-launcher-server:0.1 # or a full version, or latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      PUBLIC_URL: https://launcher.example.com # the public address, as players see it
    volumes:
      - data:/data

volumes:
  data:
```

Start it with `docker compose up -d`, then [open the panel right away](#after-deploying-open-the-panel-right-away) at `https://launcher.example.com/admin`. Migrations run when the container starts. Back up the `data` volume.

| Variable     | Required | Description                                                                                     |
| ------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `PUBLIC_URL` | Yes      | The server's public origin (and base path, if any). Used for download links and secure cookies. |
| `JWT_SECRET` | No       | See [Secrets](#secrets). If set, 32+ random characters.                                         |
| `PORT`       | No       | Listening port inside the container (default `3000`).                                           |

### Secrets

There is nothing to configure. The server signs player tokens, sign-in challenges and download links with a key it generates the first time it starts (256 random bits) and keeps in its database (`server_secrets`): D1 on Cloudflare, `/data` with Docker. So treat database backups and the `data` volume as sensitive.

To manage the key yourself instead, set `JWT_SECRET` (32+ random characters, e.g. `openssl rand -hex 32`) as a Worker secret or an environment variable: it takes precedence over the stored one. Changing the key, or deleting the `jwt` row of `server_secrets`, signs every player out.

### After deploying: open the panel right away

The first person to open `/admin` creates the **owner** account (`/admin/setup`), and setup closes after that. Until then anyone who finds the address could claim the server, so open the panel as soon as the deployment finishes. Then set the organization's name and logo in the settings and create the first instance.

Players add the server from the public page (`/`), which links to the launcher downloads and opens BC Launcher with `bclauncher://add?server=<your address>`.

### Updating

Releases are `vX.Y.Z` tags; see [Releases](https://github.com/elRubenof/bc-launcher-server/releases). When there is a newer one, the panel shows it to the owner and admins (the server checks GitHub every few hours). Updating is manual; database migrations apply on their own.

- **Cloudflare:** merge the new release into your copy of the repository (e.g. `git pull https://github.com/elRubenof/bc-launcher-server vX.Y.Z` and push). Cloudflare builds and deploys every push.
- **Docker:** change the image tag (or `docker compose pull` for `latest` / `0.1`) and `docker compose up -d`.

## Releases and the launcher API

Each release publishes the Docker image to GHCR (`X.Y.Z`, `X.Y` and `latest`) and attaches `openapi.json`, the contract of the launcher API and discovery, to the GitHub release. The version is reported as `serverVersion` in `/.well-known/bc-launcher`. CI fails on breaking changes to `/api/v1` and discovery compared with the latest release.

## Development

Requires Node 22.12+ and pnpm (the version in `package.json` → `packageManager`).

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Run the server locally:

- **Cloudflare Worker** (local D1 and R2): `pnpm dev:worker` → http://localhost:8787
- **Panel with hot reload**: with the Worker running, `pnpm dev:web` → http://localhost:5173
- **Node**: copy `apps/api/.env.example` to `apps/api/.env`, run `pnpm build:web` once, then `pnpm --filter @bc-launcher-server/api dev:node` → http://localhost:3000
- **Docker**: `docker compose -f docker/docker-compose.yml up --build` → http://localhost:3000

Open `/admin` to create the owner account on first visit. Check the API with `curl http://localhost:3000/health` and `curl http://localhost:3000/.well-known/bc-launcher`.

## License

[GPL-3.0](LICENSE)
