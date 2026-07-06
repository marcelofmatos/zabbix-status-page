FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config.js server.js zabbix.js model.js history.js ./
COPY views/ ./views/
COPY public/ ./public/

RUN mkdir -p /data && chown -R node:node /data

ARG APP_VERSION=dev
ENV NODE_ENV=production HISTORY_FILE=/data/history.json PORT=8080 APP_VERSION=$APP_VERSION

LABEL org.opencontainers.image.title="Zabbix Status Page" \
      org.opencontainers.image.description="Public status page fed by the Zabbix API, in the style of a hosted status page." \
      org.opencontainers.image.version="$APP_VERSION"

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.js"]
