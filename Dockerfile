# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps

WORKDIR /app

# whatsapp-web.js uses Puppeteer, but the runtime image installs Debian's
# Chromium package. Skipping Puppeteer's browser download keeps builds smaller.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ pkg-config \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        dumb-init \
        ffmpeg \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        tzdata \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node *.js ./
COPY --chown=node:node aiProviders ./aiProviders

RUN mkdir -p /app/data /app/.wwebjs_auth /app/media /app/models \
    && chown -R node:node /app

USER node

VOLUME ["/app/data", "/app/.wwebjs_auth", "/app/media", "/app/models"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["dumb-init", "node", "index.js"]
