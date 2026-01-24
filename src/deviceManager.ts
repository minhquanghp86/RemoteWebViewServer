import { CDPSession } from "playwright-core";
import sharp from "sharp";
import { DeviceConfig, deviceConfigsEqual } from "./config.js";
import { getRoot } from "./cdpRoot.js";
import { FrameProcessor } from "./frameProcessor.js";
import { DeviceBroadcaster } from "./broadcaster.js";
import { hash32 } from "./util.js";
import { SelfTestRunner } from "./selfTest.js";

export type DeviceSession = {
  id: string;
  deviceId: string;
  cdp: CDPSession;
  cfg: DeviceConfig;
  url: string;
  lastActive: number;
  frameId: number;
  prevFrameHash: number;
  processor: FrameProcessor;
  selfTestRunner: SelfTestRunner

  // trailing throttle state
  pendingB64?: string;
  throttleTimer?: NodeJS.Timeout;
  lastProcessedMs?: number;
};

const PREFERS_REDUCED_MOTION = /^(1|true|yes|on)$/i.test(process.env.PREFERS_REDUCED_MOTION ?? '');
const BROWSER_LOCALE = process.env.BROWSER_LOCALE || 'en-US';

const devices = new Map<string, DeviceSession>();
let _cleanupRunning = false;
let _codecVerified = false; // Track if we've verified codec support
export const broadcaster = new DeviceBroadcaster();

// ============================================
// HELPER: Setup viewport ổn định
// ============================================
async function setupStableViewport(
  session: CDPSession,
  width: number,
  height: number,
  maxRetries: number = 3
): Promise<boolean> {
  console.log(`[Viewport] Setting up ${width}x${height}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Step 1: Set Device Metrics Override
      await session.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
        positionX: 0,
        positionY: 0
      });

      // Step 2: Enable Focus Emulation
      await session.send('Emulation.setFocusEmulationEnabled', {
        enabled: true
      });

      // Step 3: Set Locale
      try {
        await session.send('Emulation.setLocaleOverride', {
          locale: BROWSER_LOCALE
        });
      } catch {
        // Ignore if not supported
      }

      // Step 4: Set Reduced Motion if needed
      if (PREFERS_REDUCED_MOTION) {
        await session.send('Emulation.setEmulatedMedia', {
          media: 'screen',
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
      }

      // Step 5: Wait for layout stabilization
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 6: Verify viewport size
      const actualSize = await session.send('Runtime.evaluate', {
        expression: `({
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio
        })`,
        returnByValue: true
      });

      const size = actualSize.result?.value;
      if (size) {
        console.log(
          `[Viewport] Attempt ${attempt}: Expected ${width}x${height}, ` +
          `Got ${size.width}x${size.height} (DPR: ${size.dpr})`
        );

        // Check if size matches
        if (size.width === width && size.height === height) {
          console.log(`[Viewport] ✓ Successfully set to ${width}x${height}`);
          return true;
        }
      }

      // If not last retry, wait before trying again
      if (attempt < maxRetries) {
        console.warn(`[Viewport] Size mismatch, retrying in 500ms...`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      console.error(`[Viewport] Error on attempt ${attempt}:`, error);
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.warn(`[Viewport] ⚠️  Failed to set exact size after ${maxRetries} attempts`);
  return false;
}

// ============================================
// HELPER: Verify H.264 codec support (chỉ chạy 1 lần)
// ============================================
async function verifyCodecSupport(session: CDPSession): Promise<void> {
  if (_codecVerified) return;

  try {
    const result = await session.send('Runtime.evaluate', {
      expression: `
        (() => {
          const video = document.createElement('video');
          return {
            h264: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
            h264High: video.canPlayType('video/mp4; codecs="avc1.64001E"'),
            vp9: video.canPlayType('video/webm; codecs="vp9"'),
            av1: video.canPlayType('video/mp4; codecs="av01.0.05M.08"')
          };
        })()
      `,
      returnByValue: true
    });

    const support = result.result?.value;
    if (support) {
      console.log('[Codec Support] H.264:', support.h264 || 'not supported');
      console.log('[Codec Support] H.264 High:', support.h264High || 'not supported');
      console.log('[Codec Support] VP9:', support.vp9 || 'not supported');
      console.log('[Codec Support] AV1:', support.av1 || 'not supported');

      if (!support.h264 && !support.h264High) {
        console.warn('');
        console.warn('⚠️  ========================================');
        console.warn('⚠️  WARNING: H.264 codec NOT supported!');
        console.warn('⚠️  Video playback sẽ KHÔNG hoạt động.');
        console.warn('⚠️  ');
        console.warn('⚠️  Giải pháp:');
        console.warn('⚠️  1. Cài Google Chrome:');
        console.warn('⚠️     apt-get install google-chrome-stable');
        console.warn('⚠️  2. Set environment variable:');
        console.warn('⚠️     PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable');
        console.warn('⚠️  ========================================');
        console.warn('');
      } else {
        console.log('✅ H.264 codec supported - Video playback sẽ hoạt động!');
      }
    }

    _codecVerified = true;
  } catch (error) {
    console.error('[Codec] Failed to verify codec support:', error);
  }
}

// ============================================
// MAIN: ensureDeviceAsync - ĐÃ CẢI TIẾN
// ============================================
export async function ensureDeviceAsync(id: string, cfg: DeviceConfig): Promise<DeviceSession> {
  const root = getRoot();
  if (!root) throw new Error("CDP not ready");

  let device = devices.get(id);
  if (device) {
    if (deviceConfigsEqual(device.cfg, cfg)) {
      device.lastActive = Date.now();
      device.processor.requestFullFrame();
      return device;
    } else {
      console.log(`[device] Reconfiguring device ${id}`);
      await deleteDeviceAsync(device);
    }
  }

  // ============================================
  // BƯỚC 1: Tạo target với kích thước đúng
  // ============================================
  const { targetId } = await root.send<{ targetId: string }>('Target.createTarget', {
    url: 'about:blank',
    width: cfg.width,
    height: cfg.height,
  });

  const { sessionId } = await root.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId,
    flatten: true
  });
  const session = (root as any).session(sessionId);

  await session.send('Page.enable');

  // ============================================
  // BƯỚC 2: Setup viewport ổn định (QUAN TRỌNG!)
  // ============================================
  const viewportSuccess = await setupStableViewport(session, cfg.width, cfg.height);
  
  if (!viewportSuccess) {
    console.warn(
      `[device] ⚠️  Viewport cho ${id} có thể không chính xác. ` +
      `Expected: ${cfg.width}x${cfg.height}`
    );
  }

  // ============================================
  // BƯỚC 3: Verify codec support (chỉ lần đầu)
  // ============================================
  await verifyCodecSupport(session);

  // ============================================
  // BƯỚC 4: Enable autoplay cho video
  // ============================================
  try {
    await session.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux x86_64'
    });
  } catch {
    // Ignore if not supported
  }

  // ============================================
  // BƯỚC 5: Start screencast
  // ============================================
  await session.send('Page.startScreencast', {
    format: 'png',
    maxWidth: cfg.width,
    maxHeight: cfg.height,
    everyNthFrame: cfg.everyNthFrame
  });

  // ============================================
  // BƯỚC 6: Khởi tạo processor
  // ============================================
  const processor = new FrameProcessor({
    tileSize: cfg.tileSize,
    fullframeTileCount: cfg.fullFrameTileCount,
    fullframeAreaThreshold: cfg.fullFrameAreaThreshold,
    jpegQuality: cfg.jpegQuality,
    fullFrameEvery: cfg.fullFrameEvery,
    maxBytesPerMessage: cfg.maxBytesPerMessage,
  });

  const newDevice: DeviceSession = {
    id: targetId,
    deviceId: id,
    cdp: session,
    cfg: cfg,
    url: '',
    lastActive: Date.now(),
    frameId: 0,
    prevFrameHash: 0,
    processor,
    selfTestRunner: new SelfTestRunner(broadcaster),
    pendingB64: undefined,
    throttleTimer: undefined,
    lastProcessedMs: undefined,
  };
  devices.set(id, newDevice);
  newDevice.processor.requestFullFrame();

  // ============================================
  // BƯỚC 7: Frame processing logic
  // ============================================
  const flushPending = async () => {
    const dev = newDevice;
    dev.throttleTimer = undefined;

    const b64 = dev.pendingB64;
    dev.pendingB64 = undefined;
    if (!b64) return;

    try {
      const pngFull = Buffer.from(b64, 'base64');

      const h32 = hash32(pngFull);
      if (dev.prevFrameHash === h32) {
        dev.lastProcessedMs = Date.now();
        return;
      }
      dev.prevFrameHash = h32;

      let img = sharp(pngFull);
      if (dev.cfg.rotation) img = img.rotate(dev.cfg.rotation);

      const { data, info } = await img
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const out = await processor.processFrameAsync({ data, width: info.width, height: info.height });
      if (out.rects.length > 0) {
        dev.frameId = (dev.frameId + 1) >>> 0;
        broadcaster.sendFrameChunked(id, out, dev.frameId, cfg.maxBytesPerMessage);
      }
    } catch (e) {
      console.warn(`[device] Failed to process frame for ${id}: ${(e as Error).message}`);
    } finally {
      dev.lastProcessedMs = Date.now();
    }
  };

  session.on('Page.screencastFrame', async (evt: any) => {
    // ACK immediately to keep producer running
    session.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => { });

    if (broadcaster.getClientCount(newDevice.deviceId) === 0)
      return;
    newDevice.lastActive = Date.now();
    newDevice.pendingB64 = evt.data;

    const now = Date.now();
    const since = newDevice.lastProcessedMs ? (now - newDevice.lastProcessedMs) : Infinity;
    if (!newDevice.throttleTimer) {
      const delay = Math.max(0, cfg.minFrameInterval - (Number.isFinite(since) ? since : 0));
      newDevice.throttleTimer = setTimeout(flushPending, delay);
    }
  });

  console.log(`[device] ✓ Device ${id} created successfully (${cfg.width}x${cfg.height})`);
  return newDevice;
}

export async function cleanupIdleAsync(ttlMs = 5 * 60_000) {
  if (_cleanupRunning) return;
  _cleanupRunning = true;

  try {
    const now = Date.now();
    const staleIds = Array.from(devices.values())
      .filter(d => now - d.lastActive > ttlMs)
      .map(d => d.deviceId);

    for (const id of staleIds) {
      const dev = devices.get(id);
      if (!dev) continue;

      console.log(`[device] Cleaning up idle device ${id}`);
      await deleteDeviceAsync(dev).catch(() => { /* swallow */ });
    }
  } finally {
    _cleanupRunning = false;
  }
}

async function deleteDeviceAsync(device: DeviceSession) {
  const root = getRoot();

  if (!devices.delete(device.deviceId))
    return;

  if (device.throttleTimer)
    clearTimeout(device.throttleTimer);

  try { await device.cdp.send("Page.stopScreencast").catch(() => { }); } catch { }
  try { await root?.send("Target.closeTarget", { targetId: device.id }); } catch { }
}
    if (broadcaster.getClientCount(newDevice.deviceId) === 0)
      return;
    newDevice.lastActive = Date.now();
    newDevice.pendingB64 = evt.data;

    const now = Date.now();
    const since = newDevice.lastProcessedMs ? (now - newDevice.lastProcessedMs) : Infinity;
    if (!newDevice.throttleTimer) {
      const delay = Math.max(0, cfg.minFrameInterval - (Number.isFinite(since) ? since : 0));
      newDevice.throttleTimer = setTimeout(flushPending, delay);
    }
  });

  return newDevice;
}

export async function cleanupIdleAsync(ttlMs = 5 * 60_000) {
  if (_cleanupRunning) return;
  _cleanupRunning = true;

  try {
    const now = Date.now();
    const staleIds = Array.from(devices.values())
      .filter(d => now - d.lastActive > ttlMs)
      .map(d => d.deviceId);

    for (const id of staleIds) {
      const dev = devices.get(id);
      if (!dev) continue;

      console.log(`[device] Cleaning up idle device ${id}`);
      await deleteDeviceAsync(dev).catch(() => { /* swallow */ });
    }
  } finally {
    _cleanupRunning = false;
  }
}

async function deleteDeviceAsync(device: DeviceSession) {
  const root = getRoot();

  if (!devices.delete(device.deviceId))
    return;

  if (device.throttleTimer)
    clearTimeout(device.throttleTimer);

  try { await device.cdp.send("Page.stopScreencast").catch(() => { }); } catch { }
  try { await root?.send("Target.closeTarget", { targetId: device.id }); } catch { }
}
