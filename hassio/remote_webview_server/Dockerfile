ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    nodejs npm git jq socat ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Clone source từ repo server của bạn (dùng tag mới nhất hoặc v1.1.4)
RUN git clone https://github.com/minhquanghp86/RemoteWebViewServer.git /app \
 && cd /app \
 && npm ci --only=production

WORKDIR /app

# Tạo run.sh đơn giản (đã fix lỗi)
RUN echo '#!/command/with-contenv bash' > /run.sh && \
    echo 'exec node /app/index.js' >> /run.sh && \
    chmod +x /run.sh

EXPOSE 8081 18080 9221

CMD ["/run.sh"]
