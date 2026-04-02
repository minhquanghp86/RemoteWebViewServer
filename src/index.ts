import http from 'http';
import { WebSocketServer } from "ws"
import env from "env-var";
import { makeConfigFromParams, setConfigFor, logDeviceConfig } from "./config.js";
import { broadcaster, ensureDeviceAsync, cleanupIdleAsync } from './deviceManager.js';
import { InputRouter } from "./inputRouter.js";
import { bootstrapAsync } from './browser.js';
import { MsgType } from './protocol.js';

const WS_PORT = env.get("WS_PORT").default("8081").asIntPositive();
const HEALTH_PORT = env.get("HEALTH_PORT").default("18080").asIntPositive();

const wss = new WebSocketServer({ port: WS_PORT, perMessageDeflate: false });
const inputRouter = new InputRouter();

await bootstrapAsync();

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", `ws://localhost:${WS_PORT}`);
  const id = url.searchParams.get("id") || "default";

  const cfg = makeConfigFromParams(url.searchParams);
  setConfigFor(id, cfg);
  logDeviceConfig(id, cfg);

  broadcaster.addClient(id, ws);
  const dev = await ensureDeviceAsync(id, cfg);

  ws.on("message", async (msg, isBinary) => {
    // ==========================================================
    // 1. TEXT MESSAGE → XỬ LÝ ĐĂNG NHẬP + 2FA TỪ HOME ASSISTANT
    // ==========================================================
    if (!isBinary) {
      const text = msg.toString().trim();
      try {
        const json = JSON.parse(text);

        if ((json.type === "login2fa" || json.type === "login") && typeof json.user === "string" && typeof json.pass === "string") {
          const code2fa = typeof json.code === "string" ? json.code : "";

          console.log(`[login] Device ${id} → ${json.user} ${code2fa ? "(with 2FA)" : "(no 2FA)"}`);

          // Dùng CDP Runtime.evaluate thay vì page.evaluate
          await dev.cdp.send('Runtime.evaluate', {
            expression: `
              (() => {
                const fillInput = (selector, value) => {
                  const el = document.querySelector(selector);
                  if (el) {
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  return el;
                };

                const clickButton = () => {
                  const btn = document.querySelector('mwc-button[slot="primaryaction"], button[type="submit"], mwc-button');
                  if (btn) btn.click();
                };

                const username = ${JSON.stringify(json.user)};
                const password = ${JSON.stringify(json.pass)};
                const twoFactorCode = ${JSON.stringify(code2fa)};

                // Trang 2FA
                const twoFaEl = document.querySelector('input[name="two_factor_code"], input[autocomplete="one-time-code"], input[placeholder*="code" i]');
                if (twoFaEl && twoFactorCode) {
                  twoFaEl.value = twoFactorCode;
                  twoFaEl.dispatchEvent(new Event('input', { bubbles: true }));
                  twoFaEl.dispatchEvent(new Event('change', { bubbles: true }));
                  clickButton();
                  return;
                }

                // Trang username/password
                const userEl = fillInput('input[name="username"], input[autocomplete="username"], ha-textfield input[name="username"]', username);
                const passEl = fillInput('input[name="password"], input[autocomplete="current-password"], ha-textfield input[name="password"]', password);
                if (userEl && passEl) clickButton();
              })()
            `,
            returnByValue: false,
            awaitPromise: false,
          });

          console.log("[login] Đã thực hiện đăng nhập + 2FA thành công!");
        }
      } catch (e) {
        console.warn("[login] JSON không hợp lệ từ ESP:", text);
      }
      return;
    }

    // ==========================================================
    // 2. BINARY MESSAGE → giữ nguyên 100% như cũ
    // ==========================================================
    const buf: Buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer);
    switch (buf.readUInt8(0)) {
      case MsgType.Touch:
        inputRouter.handleTouchPacketAsync(dev, buf).catch(e =>
          console.warn(`Failed to handle touch packet: ${(e as Error).message}`)
        );
        break;
      case MsgType.Keepalive:
        dev.lastActive = Date.now();
        break;
      case MsgType.FrameStats:
        inputRouter.handleFrameStatsPacketAsync(dev, buf).catch(() =>
          console.warn(`Failed to handle Self test packet`)
        );
        break;
      case MsgType.OpenURL:
        inputRouter.handleOpenURLPacketAsync(dev, buf).catch(e =>
          console.warn(`Failed to handle OpenURL packet: ${(e as Error).message}`)
        );
        break;
    }
  });

  ws.on("close", () => {
    dev.lastActive = Date.now();
    broadcaster.removeClient(id, ws);
  });
});

http.createServer(async (req, res) => {
  try {
    res.writeHead(200);
    res.end('ok');
  } catch (e) {
    res.writeHead(500);
    res.end('err');
  }
}).listen(HEALTH_PORT);

setInterval(() => cleanupIdleAsync(), 60_000);

console.log(`[server] WebSocket listening on :${WS_PORT}`);
console.log(`[server] Health check: http://localhost:${HEALTH_PORT}`);
