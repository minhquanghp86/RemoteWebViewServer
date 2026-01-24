ARG SERVER_IMAGE=docker.io/strangev/remote-webview-server:latest
FROM ${SERVER_IMAGE}

USER root

# ============================================
# Cài đặt Google Chrome để có H.264 codec
# ============================================
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | \
    gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > \
    /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        google-chrome-stable \
        jq \
        socat \
        ca-certificates \
        curl && \
    rm -rf /var/lib/apt/lists/*

# Verify Chrome installation
RUN google-chrome-stable --version || echo "Chrome installation check failed"

# Set environment để Playwright sử dụng Chrome
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 8081 18080 9221

CMD ["/run.sh"]
