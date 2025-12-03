# Base image từ Home Assistant (ổn định cho add-on)
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

# Cài dependencies cho Node.js + tools
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    nodejs \
    npm \
    git \
    jq \
    socat \
    ca-certificates \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Clone source code từ repo server của bạn (đã có login + 2FA)
RUN git clone https://github.com/minhquanghp86/RemoteWebViewServer.git /app \
 && cd /app \
 && npm ci --only=production

WORKDIR /app

# Copy run.sh nếu có (hoặc dùng node trực tiếp)
COPY run.sh /run.sh || echo '#!/bin/bash\nnode index.js' > /run.sh
RUN chmod +x /run.sh

# Expose ports
EXPOSE 8081 18080 9221

CMD ["/run.sh"]
