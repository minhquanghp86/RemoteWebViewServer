import env from "env-var";
import { mkdir } from 'fs/promises';
import { chromium } from 'playwright-core';
import { initCdpRootAsync, waitForCdpReadyAsync } from './cdpRoot.js';

const DEBUG_PORT = +(process.env.DEBUG_PORT || 9221);
const PREFERS_REDUCED_MOTION = /^(1|true|yes|on)$/i.test(process.env.PREFERS_REDUCED_MOTION ?? '');
const USER_DATA_DIR = process.env.USER_DATA_DIR || (process.platform === 'win32'
  ? 'C:\\Temp\\remotewebview-profile'
  : '/var/temp/remotewebview-profile');
const BROWSER_LOCALE = env.get("BROWSER_LOCALE").default("en-US").asString();

// Detect Chrome executable path
const CHROME_PATHS = [
  '/usr/bin/google-chrome-stable',     // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',  // Windows
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'  // macOS
];

async function findChromeExecutable(): Promise<string | null> {
  const { access } = await import('fs/promises');
  
  // Check environment variable first
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    try {
      await access(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
      return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    } catch {
      console.warn('[browser] PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH not accessible');
    }
  }

  // Check common paths
  for (const path of CHROME_PATHS) {
    try {
      await access(path);
      return path;
    } catch {
      // continue
    }
  }

  return null;
}

async function fetchJsonVersionAsync(): Promise<{ webSocketDebuggerUrl: string; Browser?: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function startHeadlessIfNeededAsync(): Promise<void> {
  const info = await fetchJsonVersionAsync();
  if (info?.webSocketDebuggerUrl) {
    console.log(`[browser] Already running: ${info.Browser || 'Unknown'}`);
    return;
  }

  await mkdir(USER_DATA_DIR, { recursive: true });

  // Find Chrome executable
  const chromeExec = await findChromeExecutable();
  
  // Build launch arguments
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-debugging-address=0.0.0.0',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--force-device-scale-factor=1',
    '--headless=new',
    
    // ============================================
    // H.264 VIDEO SUPPORT - CRITICAL FLAGS
    // ============================================
    '--enable-features=VaapiVideoDecoder',
    '--disable-features=UseChromeOSDirectVideoDecoder',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-accelerated-video-decode',
    '--enable-gpu-rasterization',
    
    // Prefers reduced motion
    ...(PREFERS_REDUCED_MOTION ? ['--force-prefers-reduced-motion'] : []),
  ];

  if (PREFERS_REDUCED_MOTION) {
    console.log('[browser] Launching with prefers-reduced-motion');
  }

  // Launch with Chrome if available, otherwise use Chromium
  const launchOptions: any = {
    headless: true,
    locale: BROWSER_LOCALE,
    args,
    chromiumSandbox: false,
    timeout: 30000,
  };

  // Use Chrome executable if found (for H.264 support)
  if (chromeExec) {
    console.log(`[browser] Using Chrome with H.264 support: ${chromeExec}`);
    launchOptions.executablePath = chromeExec;
  } else {
    console.warn('[browser] ⚠️  Chrome not found! Using Chromium (H.264 may not work)');
    console.warn('[browser] Install Chrome: apt-get install google-chrome-stable');
  }

  try {
    await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
  } catch (error) {
    console.error('[browser] Failed to launch browser:', error);
    
    // Fallback: try without executablePath
    if (chromeExec) {
      console.log('[browser] Retrying without executablePath...');
      delete launchOptions.executablePath;
      await chromium.launchPersistentContext(USER_DATA_DIR, launchOptions);
    } else {
      throw error;
    }
  }

  // Wait for CDP to be ready
  const t0 = Date.now();
  for (;;) {
    const j = await fetchJsonVersionAsync();
    if (j?.webSocketDebuggerUrl) {
      console.log(`[browser] Browser ready: ${j.Browser || 'Unknown'}`);
      // Verify if it's Chrome (has H.264)
      if (j.Browser && j.Browser.includes('Chrome') && !j.Browser.includes('Chromium')) {
        console.log('[browser] ✓ Chrome detected - H.264 video support available');
      } else {
        console.warn('[browser] ⚠️  Chromium detected - H.264 video may not work');
      }
      return;
    }
    if (Date.now() - t0 > 10000) {
      throw new Error('Timed out waiting for CDP /json/version');
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

export async function bootstrapAsync(): Promise<void> {
  await startHeadlessIfNeededAsync();

  const info = await fetchJsonVersionAsync();
  if (!info?.webSocketDebuggerUrl) {
    throw new Error('CDP not available');
  }

  await initCdpRootAsync(info.webSocketDebuggerUrl);
  await waitForCdpReadyAsync();
  console.log('[cdp] ready:', info.webSocketDebuggerUrl);
}

/**
 * Verify codec support for a page
 * Call this after page is created to check H.264 availability
 */
export async function verifyCodecSupport(page: any): Promise<{
  h264: string;
  h264High: string;
  vp9: string;
  av1: string;
}> {
  return await page.evaluate(() => {
    const video = document.createElement('video');
    return {
      h264: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      h264High: video.canPlayType('video/mp4; codecs="avc1.64001E"'),
      vp9: video.canPlayType('video/webm; codecs="vp9"'),
      av1: video.canPlayType('video/mp4; codecs="av01.0.05M.08"')
    };
  });
}
