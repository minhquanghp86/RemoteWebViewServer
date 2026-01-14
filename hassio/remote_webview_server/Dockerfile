ARG SERVER_IMAGE=docker.io/strangev/remote-webview-server:latest
FROM ${SERVER_IMAGE}

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    jq socat ca-certificates curl \
    python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/*

# Cài Python packages cho video streaming
RUN pip3 install --no-cache-dir \
    websockets==12.0 \
    aiohttp==3.9.1 \
    Pillow==10.1.0

WORKDIR /app
COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 8081 18080 9221

CMD ["/run.sh"]
