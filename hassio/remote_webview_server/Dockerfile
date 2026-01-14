ARG SERVER_IMAGE=docker.io/strangev/remote-webview-server:latest
FROM ${SERVER_IMAGE}

USER root

# Install system packages
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    jq socat ca-certificates curl \
    python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip3 install --no-cache-dir \
    websockets==12.0 \
    aiohttp==3.9.1 \
    Pillow==10.1.0

# Copy application files
WORKDIR /app
COPY run.sh /run.sh
COPY video_server.py /app/video_server.py

# Set permissions
RUN chmod +x /run.sh

# Expose ports
EXPOSE 8081 8082 18080 9221

CMD ["/run.sh"]
