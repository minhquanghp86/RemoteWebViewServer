# ============================================
# Stage 1: Build TypeScript source
# ============================================
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ============================================
# Stage 2: Runtime image
# ============================================
FROM node:20-slim AS runtime

# Cài dependencies hệ thống + Google Chrome (H.264 support)
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        gnupg \
        ca-certificates \
        curl \
        jq \
        socat \
        fonts-liberation \
        libnss3 \
        libatk-bridge2.0-0 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libpango-1.0-0 \
        libcairo2 \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | \
        gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > \
        /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Verify Chrome
RUN google-chrome-stable --version || echo "Chrome installation check failed"

WORKDIR /app

# Copy node_modules và built output từ stage 1
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Copy các file phụ trợ nếu có (self-test page, v.v.)
COPY self-test/ ./self-test/ 2>/dev/null || true

# Copy run.sh
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Set environment
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

EXPOSE 8081 18080 9221

CMD ["/run.sh"]
