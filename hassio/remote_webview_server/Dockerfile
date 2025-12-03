ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    nodejs npm git jq socat ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Clone source từ repo server của bạn (v1.1.4 đã có login + 2FA nếu bạn push)
RUN git clone https://github.com/minhquanghp86/RemoteWebViewServer.git /app \
 && cd /app \
 && git checkout v1.1.4 \  # Lấy đúng tag release
 && npm ci --only=production

WORKDIR /app

# Copy run.sh nếu có, hoặc tạo đơn giản
COPY run.sh /run.sh || echo '#!/bin/bash\nnode index.js' > /run.sh
RUN chmod +x /run.sh

EXPOSE 8081 18080 9221

CMD ["/run.sh"]
