# Build from the repo root: docker build -f docker/Dockerfile .

FROM node:22-slim AS build
WORKDIR /src
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY . .
RUN pnpm install --frozen-lockfile --filter "@bc-launcher-server/api..." --filter "@bc-launcher-server/web..."
RUN pnpm --filter @bc-launcher-server/api build:node
RUN pnpm --filter @bc-launcher-server/web build
RUN pnpm --filter @bc-launcher-server/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    MIGRATIONS_DIR=/app/migrations \
    WEB_DIR=/app/web \
    PORT=3000
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/api/dist/node.js ./
COPY --from=build /src/packages/db/migrations ./migrations
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "node.js"]
