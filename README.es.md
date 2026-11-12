# BC Launcher Server

[![Última versión](https://img.shields.io/github/v/release/elRubenof/bc-launcher-server)](https://github.com/elRubenof/bc-launcher-server/releases/latest)
[![CI](https://github.com/elRubenof/bc-launcher-server/actions/workflows/ci.yml/badge.svg)](https://github.com/elRubenof/bc-launcher-server/actions/workflows/ci.yml)
[![Licencia](https://img.shields.io/github/license/elRubenof/bc-launcher-server)](LICENSE)

[English](README.md) · Español

Servidor para [BC Launcher](https://github.com/elRubenof/bc-launcher). Cada organización (un desarrollador u organizador de series y eventos) despliega su propio servidor para gestionar sus instancias, ficheros, noticias, imagen y el acceso de los jugadores, y BC Launcher se sincroniza con él.

Incluye una API versionada para el launcher, un panel de administración (`/admin`) y una página pública de descarga (`/`), y se puede desplegar en Cloudflare (Workers + D1 + R2) o con Docker.

## Estado

Las versiones siguen SemVer, empezando por la `1.0.0`. La API del launcher (`/api/v1`) y el documento de discovery se mantienen compatibles hacia atrás; el panel de administración y su API interna pueden cambiar entre versiones.

## Despliegue

Un despliegue es una organización. Elige uno de los dos destinos.

### Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/elRubenof/bc-launcher-server)

Necesitas una cuenta de Cloudflare con R2 activado (Cloudflare puede pedir un método de pago para activar R2, aunque no salgas del plan gratuito).

> **En Cloudflare no se verifica la identidad de los jugadores** salvo que añadas un proxy de sesiones, porque Mojang bloquea las peticiones de Cloudflare Workers. Lee [Identidad de los jugadores](#identidad-de-los-jugadores) antes de fiarte de whitelists, bans o una organización privada.

1. Pulsa el botón e inicia sesión. Cloudflare copia este repositorio en tu cuenta de GitHub o GitLab y crea el Worker, una base de datos D1 (`DB`) y un bucket de R2 (`BLOBS`). Puedes dejar los nombres que sugiere.
2. Deja la configuración de build que rellena: comando de build `pnpm run build`, comando de deploy `pnpm run deploy` (aplica las migraciones de la base de datos y despliega el Worker). No hace falta ningún secreto.
3. Despliega. Cuando termine el build (un par de minutos), [abre el panel enseguida](#después-de-desplegar-abre-el-panel-enseguida) en `https://<worker>.<tu-subdominio>.workers.dev/admin`; el log del build muestra esa dirección al final. La dirección `workers.dev` siempre queda activada por el despliegue (`workers_dev` en `wrangler.jsonc`), aunque la pestaña Domains del Worker la muestre desactivada.

El servidor usa como dirección pública la dirección por la que llega cada petición, así que funciona en `workers.dev` y en un dominio propio (Worker → Settings → Domains & Routes) sin cambiar nada. Para usar siempre una misma dirección, añade una variable `PUBLIC_URL` (por ejemplo, `https://launcher.example.com`) en los ajustes del Worker.

Una tarea programada cada hora borra los ficheros que ya no se usan y los bans caducados.

<details>
<summary>Desplegar sin el botón (Wrangler)</summary>

```bash
git clone https://github.com/elRubenof/bc-launcher-server && cd bc-launcher-server
pnpm install
pnpm exec wrangler login
pnpm exec wrangler d1 create bc-launcher-server         # añade el database_id que imprime a wrangler.jsonc
pnpm exec wrangler r2 bucket create bc-launcher-server-blobs
pnpm run build && pnpm run deploy
```

</details>

### Docker

La imagen `ghcr.io/elrubenof/bc-launcher-server` (`linux/amd64` y `linux/arm64`) ejecuta el servidor de Node en el puerto `3000` y guarda todo (la base de datos SQLite y los ficheros) en el volumen `/data`. Ponla detrás de un proxy inverso con TLS (Caddy, Traefik, nginx…).

```yaml
# docker-compose.yml
services:
  server:
    image: ghcr.io/elrubenof/bc-launcher-server:1.0 # o una versión completa, o latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      PUBLIC_URL: https://launcher.example.com # la dirección pública, tal como la ven los jugadores
    volumes:
      - data:/data

volumes:
  data:
```

Arráncalo con `docker compose up -d` y [abre el panel enseguida](#después-de-desplegar-abre-el-panel-enseguida) en `https://launcher.example.com/admin`. Las migraciones se aplican al arrancar el contenedor. Haz copias de seguridad del volumen `data`.

| Variable             | Obligatoria | Descripción                                                                                                         |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`         | Sí          | El origen público del servidor (y su ruta base, si la tiene). Se usa en los enlaces de descarga y las cookies seguras. |
| `JWT_SECRET`         | No          | Ver [Secretos](#secretos). Si se pone, 32 caracteres aleatorios o más.                                              |
| `PORT`               | No          | Puerto de escucha dentro del contenedor (por defecto `3000`).                                                       |
| `MOJANG_SESSION_URL` | No          | Un proxy del servidor de sesiones de Mojang; ver [Identidad de los jugadores](#identidad-de-los-jugadores). No hace falta con Docker. |

### Identidad de los jugadores

Cuando un jugador inicia sesión, el launcher le dice a Mojang que se está uniendo con un código de un solo uso, y el servidor pregunta al servidor de sesiones de Mojang si ese jugador lo hizo de verdad (`hasJoined`, la misma comprobación que usan los servidores de Minecraft). Solo el dueño real de la cuenta puede pasarla, y el launcher nunca envía su token de Minecraft al servidor.

- **Docker:** verificado desde el principio; no hay que configurar nada.
- **Cloudflare:** Mojang bloquea las peticiones de Cloudflare Workers (`403`), así que por defecto el servidor **se fía del nombre que envía el launcher**. El discovery lo indica (`auth.type: "unverified"`) y el panel lo avisa en Ajustes. Lo que significa:
  - Cualquiera puede iniciar sesión en el launcher con el nombre de otro jugador. La whitelist, la blacklist y una organización privada no le impiden ver las instancias y sus noticias ni descargar su contenido. Trata una organización privada en Cloudflare como pública para cualquiera que conozca el nombre de un miembro.
  - Tu servidor de Minecraft sigue verificando a quien entra a jugar (modo online, su propia whitelist), así que jugar está protegido; el contenido del launcher no.
  - Los nombres de los jugadores se siguen buscando en [playerdb.co](https://playerdb.co), así que los nombres inventados se rechazan.

**Verificar en Cloudflare con un proxy de sesiones.** Pon un pequeño proxy inverso delante del servidor de sesiones de Mojang en algún sitio que Mojang no bloquee (cualquier VPS) y añade al Worker una variable `MOJANG_SESSION_URL` (Worker → Settings → Variables and Secrets, o `vars` en `wrangler.jsonc`) con su dirección. El servidor pregunta entonces a Mojang a través de él y la comprobación es la misma que con Docker. Con nginx:

```nginx
location /session/minecraft/ {
    proxy_pass https://sessionserver.mojang.com/session/minecraft/;
    proxy_set_header Host sessionserver.mojang.com;
    proxy_ssl_server_name on;
}
```

```text
MOJANG_SESSION_URL=https://proxy.example.com/session/minecraft
```

Quien gestione el proxy podría responder «sí» para cualquier jugador, así que usa solo uno que controles o en el que confíes. Si el proxy no responde, los jugadores no pueden iniciar sesión: una vez configurado un proxy, el servidor nunca vuelve a fiarse de los nombres.

El panel busca los nombres de los jugadores primero en playerdb.co (con Mojang de respaldo) y muestra sus cabezas desde crafthead.net.

### Secretos

No hay nada que configurar. El servidor firma los tokens de los jugadores, los retos de inicio de sesión y los enlaces de descarga con una clave que genera la primera vez que arranca (256 bits aleatorios) y guarda en su base de datos (`server_secrets`): D1 en Cloudflare, `/data` con Docker. Por eso las copias de la base de datos y el volumen `data` son información sensible.

Si prefieres gestionar tú la clave, pon `JWT_SECRET` (32 caracteres aleatorios o más, por ejemplo `openssl rand -hex 32`) como secreto del Worker o variable de entorno: tiene prioridad sobre la guardada. Cambiar la clave, o borrar la fila `jwt` de `server_secrets`, cierra la sesión de todos los jugadores.

### Después de desplegar: abre el panel enseguida

La primera persona que abre `/admin` crea la cuenta de **owner** (`/admin/setup`), y después la configuración inicial se cierra. Hasta entonces, cualquiera que encuentre la dirección podría quedarse con el servidor, así que abre el panel en cuanto termine el despliegue. Después pon el nombre y el logo de la organización en los ajustes y crea la primera instancia.

Los jugadores añaden el servidor desde la página pública (`/`), que enlaza a las descargas del launcher y abre BC Launcher con `bclauncher://add?server=<tu dirección>`.

### Actualizar

Las versiones son tags `vX.Y.Z`; ver [Releases](https://github.com/elRubenof/bc-launcher-server/releases). Cuando hay una más nueva, el panel se lo muestra al owner y a los admins (el servidor lo comprueba en GitHub cada pocas horas). La actualización es manual; las migraciones de la base de datos se aplican solas.

- **Cloudflare:** fusiona la nueva versión en tu copia del repositorio (por ejemplo, `git pull https://github.com/elRubenof/bc-launcher-server vX.Y.Z` y push). Cloudflare compila y despliega cada push.
- **Docker:** cambia el tag de la imagen (o `docker compose pull` para `latest` / `1.0`) y `docker compose up -d`.

## Releases y la API del launcher

Cada release publica la imagen de Docker en GHCR (`X.Y.Z`, `X.Y` y `latest`) y adjunta a la release de GitHub `openapi.json`, el contrato de la API del launcher y del discovery. La versión aparece como `serverVersion` en `/.well-known/bc-launcher`. La CI falla si hay cambios incompatibles en `/api/v1` o en el discovery respecto a la última release.

## Desarrollo

Necesitas Node 22.12+ y pnpm (la versión de `package.json` → `packageManager`).

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Ejecutar el servidor en local:

- **Worker de Cloudflare** (D1 y R2 locales): `pnpm dev:worker`. Como en Cloudflare, los jugadores no se verifican salvo que `.dev.vars` defina `MOJANG_SESSION_URL` (en local funciona el de Mojang, `https://sessionserver.mojang.com/session/minecraft`) → http://localhost:8787
- **Panel con recarga en caliente**: con el Worker en marcha, `pnpm dev:web` → http://localhost:5173
- **Node**: copia `apps/api/.env.example` a `apps/api/.env`, ejecuta `pnpm build:web` una vez y luego `pnpm --filter @bc-launcher-server/api dev:node` → http://localhost:3000
- **Docker**: `docker compose -f docker/docker-compose.yml up --build` → http://localhost:3000

Abre `/admin` para crear la cuenta de owner la primera vez. Comprueba la API con `curl http://localhost:3000/health` y `curl http://localhost:3000/.well-known/bc-launcher`.

## Licencia

[GPL-3.0](LICENSE)
