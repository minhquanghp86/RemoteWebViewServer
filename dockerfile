# Build từ Playwright image có Chrome
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS base

# Cài đặt Google Chrome stable (có H.264 codec)
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        google-chrome-stable \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libwayland-client0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

# Cài Chrome lại ở production stage
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy from build stage
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package*.json ./

# Create user data directory
RUN mkdir -p /pw-data && chmod 777 /pw-data

# Environment variables với defaults
ENV TILE_SIZE=32
ENV FULL_FRAME_TILE_COUNT=4
ENV FULL_FRAME_AREA_THRESHOLD=0.5
ENV FULL_FRAME_EVERY=50
ENV EVERY_NTH_FRAME=1
ENV MIN_FRAME_INTERVAL_MS=80
ENV JPEG_QUALITY=85
ENV MAX_BYTES_PER_MESSAGE=61440
ENV WS_PORT=8081
ENV DEBUG_PORT=9221
ENV HEALTH_PORT=18080
ENV PREFERS_REDUCED_MOTION=false
ENV USER_DATA_DIR=/pw-data
ENV BROWSER_LOCALE=en-US

EXPOSE 8081 9221 18080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${HEALTH_PORT}/ || exit 1

CMD ["node", "dist/index.js"]
