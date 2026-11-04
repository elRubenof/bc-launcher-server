# BC Launcher Server

Server for [BC Launcher](https://github.com/elRubenof/bc-launcher). Each organization (a developer or organizer of series and events) deploys its own server to manage its instances, files, news, branding and player access, and BC Launcher syncs from it.

It includes a versioned API for the launcher and an admin panel, and it can be deployed to Cloudflare (Workers + D1 + R2) or with Docker.

## Status

In development. Not ready for use yet.

## Development

Requires Node 22.12+ and pnpm (the version in `package.json` → `packageManager`).

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Run the server locally:

- **Cloudflare Worker** (local D1 and R2): copy `.dev.vars.example` to `.dev.vars`, then `pnpm dev:worker` → http://localhost:8787
- **Panel with hot reload**: with the Worker running, `pnpm dev:web` → http://localhost:5173
- **Node**: copy `apps/api/.env.example` to `apps/api/.env`, run `pnpm build:web` once, then `pnpm --filter @bc-launcher-server/api dev:node` → http://localhost:3000
- **Docker**: create `docker/.env` with `SESSION_SECRET` and `JWT_SECRET` (e.g. `openssl rand -hex 32`), then `docker compose -f docker/docker-compose.yml up --build` → http://localhost:3000

Open `/admin` to create the owner account on first visit. Check the API with `curl http://localhost:3000/health` and `curl http://localhost:3000/.well-known/bc-launcher`.

## License

[GPL-3.0](LICENSE)
