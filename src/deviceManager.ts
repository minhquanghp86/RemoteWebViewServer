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
let _codecVerified = false;
export const broadcaster = new DeviceBroadcaster();

// ============================================
// On-screen keyboard script (minified)
// Source: unminified-keyboard-for-information-only.js
// ============================================
const KIOSK_KEYBOARD_SCRIPT = "(function(){console.log('[VKB] Script injected. Initializing...');const VKB_WIDTH='100%';const VKB_HEIGHT='196px';if(window.__kioskKeyboardInitialized){console.log('[VKB] Already initialized. Aborting duplicate injection.');return;}window.__kioskKeyboardInitialized=true;let keyboardContainer=null;let currentLayout='default';let activeInput=null;let isShifted=false;const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['▼','?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['▼','?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['▼','=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['▼','ABC',',','◀','Space','▶','.','⏎']]};function ensureDOM(){if(!document.body||!document.head){console.warn('[VKB] document.body or head not ready.');return false;}if(!document.getElementById('kiosk-vkb-style')){console.log('[VKB] Injecting CSS overrides.');const style=document.createElement('style');style.id='kiosk-vkb-style';style.textContent=`#kiosk-vkb-container{position:fixed !important;top:auto !important;bottom:-200vh !important;left:0 !important;right:0 !important;margin:0 auto !important;width:${VKB_WIDTH} !important;height:${VKB_HEIGHT} !important;container-type:size;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;touch-action:manipulation;border:none;}#kiosk-vkb-container:popover-open{display:flex;}#kiosk-vkb-container.vkb-visible{bottom:0 !important;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;flex:1;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:11.5cqh;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:9cqh;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:11cqh;}.vkb-key-special:active{background:#364538;}.vkb-key-large-icon{font-size:15cqh;}.vkb-key-backspace{font-size:18cqh;}.vkb-key-hide{background:#8b3a3a;color:#e2e8f0;font-size:12.5cqh;}.vkb-key-hide:active{background:#6b2a2a;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:12.5cqh;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);}if(!keyboardContainer){console.log('[VKB] Creating keyboard DOM elements.');keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';if(keyboardContainer.popover!==undefined)keyboardContainer.popover='manual';renderKeyboard();}if(!document.body.contains(keyboardContainer)){console.log('[VKB] Appending keyboard to body.');document.body.appendChild(keyboardContainer);}return true;}function renderKeyboard(){if(!keyboardContainer)return;keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(['⇧','↹'].includes(key)){keyBtn.classList.add('vkb-key-large-icon');}if(key==='⌫'){keyBtn.classList.add('vkb-key-backspace');}if(key==='▼'){keyBtn.classList.add('vkb-key-hide');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function processKey(key){if(!activeInput){console.warn('[VKB] Key pressed but activeInput is null.');return;}console.log('[VKB] Processing key:',key);if(typeof activeInput.focus==='function'){activeInput.focus();}const insertText=(text)=>{if(activeInput.isContentEditable){document.execCommand('insertText',false,text);}else{let val=activeInput.value||'';let start=activeInput.selectionStart||0;let end=activeInput.selectionEnd||0;activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;}};switch(key){case'▼':hideKeyboard();break;case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(activeInput.isContentEditable){document.execCommand('delete',false,null);}else{let val=activeInput.value||'';let start=activeInput.selectionStart||0;let end=activeInput.selectionEnd||0;if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}}break;case'Space':insertText(' ');break;case'◀':if(!activeInput.isContentEditable){let start=activeInput.selectionStart||0;if(start>0)activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(!activeInput.isContentEditable){let end=activeInput.selectionEnd||0;let valLen=(activeInput.value||'').length;if(end<valLen)activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.isContentEditable){document.execCommand('insertParagraph',false,null);activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));}else if(activeInput.tagName==='TEXTAREA'){insertText('\\n');activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}else{const evInit={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,composed:true,cancelable:true};activeInput.dispatchEvent(new KeyboardEvent('keydown',evInit));activeInput.dispatchEvent(new KeyboardEvent('keypress',evInit));activeInput.dispatchEvent(new KeyboardEvent('keyup',evInit));hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'&&key!=='▼'){activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}}function showKeyboard(inputElement){console.log('[VKB] showKeyboard triggered for:',inputElement);activeInput=inputElement;renderKeyboard();window.__vkbOpeningShield=Date.now();if(keyboardContainer.showPopover){if(keyboardContainer.matches(':popover-open')){keyboardContainer.hidePopover();}keyboardContainer.showPopover();}keyboardContainer.classList.add('vkb-visible');if(activeInput&&activeInput.scrollIntoView){activeInput.scrollIntoView({behavior:'auto',block:'center'});}}function hideKeyboard(){console.log('[VKB] hideKeyboard triggered. Activating ghost-click shield.');window.__vkbClosingShield=Date.now();if(keyboardContainer){keyboardContainer.classList.remove('vkb-visible');if(keyboardContainer.hidePopover&&keyboardContainer.matches(':popover-open')){keyboardContainer.hidePopover();}}if(activeInput&&activeInput.blur){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];function resolveInputFromPath(path){for(let i=0;i<path.length;i++){let el=path[i];if(!el||!el.tagName)continue;let t=el.tagName.toUpperCase();if(t==='INPUT'&&validTypes.includes(el.type)){return el;}if(t==='TEXTAREA'||el.isContentEditable||(el.classList&&el.classList.contains('cm-content'))){return el;}if(t==='HA-TEXTFIELD'||t==='HA-SEARCH-INPUT'||t==='HA-CODE-EDITOR'||t==='HA-SELECTOR-TEXT'){let inner=el.shadowRoot?el.shadowRoot.querySelector('input, textarea, [contenteditable=\"true\"], .cm-content'):null;if(inner){return inner;}}}return null;}function checkAndShowKeyboard(e){const path=e.composedPath?e.composedPath():[e.target];const targetInput=resolveInputFromPath(path);if(targetInput){console.log('[VKB] Valid DOM element found via',e.type,':',targetInput);if(ensureDOM()){const isVisible=keyboardContainer&&keyboardContainer.classList.contains('vkb-visible');if(activeInput!==targetInput||!isVisible){showKeyboard(targetInput);}else{console.log('[VKB] Element already active and visible. Ignoring.');}}}else{if(e.type==='focusin')console.log('[VKB] focusin ignored: Target is not a valid input.');}}document.addEventListener('focusin',checkAndShowKeyboard,true);document.addEventListener('click',checkAndShowKeyboard,true);const interactionEvents=['pointerdown','pointerup','mousedown','mouseup','click','touchstart','touchend'];interactionEvents.forEach(ev=>{document.addEventListener(ev,function(e){if(window.__vkbClosingShield&&(Date.now()-window.__vkbClosingShield<400)){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return;}if(keyboardContainer&&keyboardContainer.classList.contains('vkb-visible')){let x=e.clientX;let y=e.clientY;if(x===undefined&&e.changedTouches&&e.changedTouches.length>0){x=e.changedTouches[0].clientX;y=e.changedTouches[0].clientY;}if(x===undefined||y===undefined)return;const rect=keyboardContainer.getBoundingClientRect();if(y>=rect.top&&y<=rect.bottom&&x>=rect.left&&x<=rect.right){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(window.__vkbOpeningShield&&(Date.now()-window.__vkbOpeningShield<400))return;if(['pointerdown','touchstart','mousedown','click'].includes(ev)){if(window.__vkbLastTap&&(Date.now()-window.__vkbLastTap<250))return;window.__vkbLastTap=Date.now();const keys=keyboardContainer.querySelectorAll('.vkb-key');let foundKey=null;for(let i=0;i<keys.length;i++){const kRect=keys[i].getBoundingClientRect();if(y>=kRect.top&&y<=kRect.bottom&&x>=kRect.left&&x<=kRect.right){foundKey=keys[i];break;}}if(foundKey){const key=foundKey.dataset.key;foundKey.style.background='#555';setTimeout(()=>{foundKey.style.background='';},100);processKey(key);}}return;}if(ev==='pointerdown'){const path=e.composedPath?e.composedPath():[e.target];const clickedOnInput=resolveInputFromPath(path)!==null;if(!clickedOnInput){console.log('[VKB] Pointer down outside. Hiding.');hideKeyboard();}else{console.log('[VKB] Pointer down on input. Staying open.');}}}},true);});console.log('[VKB] Initialization complete (Fully Scalable, Ghost-Click Shield Active).');})();";

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

      await session.send('Emulation.setFocusEmulationEnabled', {
        enabled: true
      });

      try {
        await session.send('Emulation.setLocaleOverride', {
          locale: BROWSER_LOCALE
        });
      } catch {
        // Ignore if not supported
      }

      if (PREFERS_REDUCED_MOTION) {
        await session.send('Emulation.setEmulatedMedia', {
          media: 'screen',
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
      }

      await new Promise(resolve => setTimeout(resolve, 300));

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

        if (size.width === width && size.height === height) {
          console.log(`[Viewport] ✓ Successfully set to ${width}x${height}`);
          return true;
        }
      }

      if (attempt < maxRetries) {
        console.warn(`[Viewport] Size mismatch, retrying in 500ms...`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      console.error(`[Viewport] Error on attempt ${attempt}:`, error);
      if (attempt === maxRetries) throw error;
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
// MAIN: ensureDeviceAsync
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
  // BƯỚC 1: Tạo target và attach session
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
  // BƯỚC 2: Inject virtual keyboard
  // Script sẽ tự động chạy trên mọi trang được load
  // ============================================
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: KIOSK_KEYBOARD_SCRIPT
  });
  console.log('[device] ✓ Virtual keyboard script registered');

  // ============================================
  // BƯỚC 3: Setup viewport ổn định
  // ============================================
  const viewportSuccess = await setupStableViewport(session, cfg.width, cfg.height);

  if (!viewportSuccess) {
    console.warn(
      `[device] ⚠️  Viewport cho ${id} có thể không chính xác. ` +
      `Expected: ${cfg.width}x${cfg.height}`
    );
  }

  // ============================================
  // BƯỚC 4: Verify codec support (chỉ lần đầu)
  // ============================================
  await verifyCodecSupport(session);

  // ============================================
  // BƯỚC 5: Enable autoplay cho video
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
  // BƯỚC 6: Start screencast
  // ============================================
  await session.send('Page.startScreencast', {
    format: 'png',
    maxWidth: cfg.width,
    maxHeight: cfg.height,
    everyNthFrame: cfg.everyNthFrame
  });

  // ============================================
  // BƯỚC 7: Khởi tạo processor và device session
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
  // BƯỚC 8: Frame processing logic
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

  // ============================================
  // BƯỚC 9: URL navigation tracking (Packet #6)
  // ============================================
  const handleNavigation = (url: string) => {
    if (newDevice.url !== url) {
      newDevice.url = url;
      broadcaster.sendCurrentURL(newDevice.deviceId, url);
      console.log(`[device] URL changed to: ${url}`);
    }
  };

  // Triggered on full page loads
  session.on('Page.frameNavigated', (evt: any) => {
    if (!evt.frame.parentId) { // Only track the main frame, ignore iframes
      handleNavigation(evt.frame.url);
    }
  });

  // Triggered on SPA hash or history API changes
  session.on('Page.navigatedWithinDocument', (evt: any) => {
    handleNavigation(evt.url);
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
