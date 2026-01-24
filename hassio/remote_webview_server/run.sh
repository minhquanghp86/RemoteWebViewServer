#!/usr/bin/env bash
set -euo pipefail

OPTIONS_FILE="/data/options.json"

get_opt() {
  local key="$1" default="$2"
  if [ -f "$OPTIONS_FILE" ]; then
    jq -r --arg k "$key" --arg d "$default" '.[$k] // $d' "$OPTIONS_FILE"
  else
    echo "$default"
  fi
}

# ... existing variables ...

export BROWSER_LOCALE="$(get_opt browser_locale "en-US")"

# Đảm bảo Playwright sử dụng Chrome
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Verify Chrome
if [ -f /usr/bin/google-chrome-stable ]; then
  echo "[remote-webview] Google Chrome: $(/usr/bin/google-chrome-stable --version)"
else
  echo "[WARNING] Google Chrome not found, H.264 may not work!"
fi

# ... rest of script ...

exec node dist/index.js
