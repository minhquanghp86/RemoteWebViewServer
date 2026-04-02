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
  selfTestRunner: SelfTestRunner;

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

// ============================================================
// Keyboard + Telex IME — embedded as TS template literal.
// Rules: no backticks inside JS, CSS uses string concat,
//        backslash chars use \\u005C unicode escape.
// ============================================================
const KIOSK_KEYBOARD_SCRIPT = `(function(){
  var VKB_WIDTH  = '100%';
  var VKB_HEIGHT = '196px';
  if (window.__kioskKeyboardInitialized) return;
  window.__kioskKeyboardInitialized = true;

  var keyboardContainer = null;
  var currentLayout    = 'default';
  var activeInput      = null;
  var isShifted        = false;
  var isVietnamese     = false;
  var telexWord        = '';
  var commitOnEnterOnly = true;

  function commitInput(){
    if(!activeInput) return;
    activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    console.log('[VKB] Commit input');
  }

  var layouts = {
    default: [
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l'],
      ['\\u21E7','z','x','c','v','b','n','m','\\u232B'],
      ['\\u25BC','?123','VN','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ],
    shift: [
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['\\u21E7','Z','X','C','V','B','N','M','\\u232B'],
      ['\\u25BC','?123','VN','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ],
    symbols: [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['@','#','$','%','&','*','-','+','(',')'],
      ['ABC','!','"',"'",':', ';','/','?','\\u232B'],
      ['\\u25BC','=\\u005C<',',','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ],
    extended: [
      ['~','|','^','_','=','{','}','[',']','\\u2713'],
      ['<','>','\\u00A3','\\u20AC','\\u00A2','\\u00B0','\\u00B1','\\u00F7','\\u00D7','\\u005C'],
      ['?123','\\u21B9','\\u00A9','\\u00AE','\\u2122','\\u00BF','\\u00A1','\\u00A7','\\u232B'],
      ['\\u25BC','ABC',',','\\u25C4','Space','\\u25BA','.','\\u23CE']
    ]
  };

  /* ---- Telex engine ----------------------------------------
     tone index: 0=flat 1=sac 2=huyen 3=hoi 4=nga 5=nang      */
  var TONE_KEYS = {s:1, f:2, r:3, x:4, j:5, z:0};

  var TONE_MAP = {
    'a'        :['a',        '\\u00E1','\\u00E0','\\u1EA3','\\u00E3','\\u1EA1'],
    '\\u0103'  :['\\u0103',  '\\u1EAF','\\u1EB1','\\u1EB3','\\u1EB5','\\u1EB7'],
    '\\u00E2'  :['\\u00E2',  '\\u1EA5','\\u1EA7','\\u1EA9','\\u1EAB','\\u1EAD'],
    'e'        :['e',        '\\u00E9','\\u00E8','\\u1EBB','\\u1EBD','\\u1EB9'],
    '\\u00EA'  :['\\u00EA',  '\\u1EBF','\\u1EC1','\\u1EC3','\\u1EC5','\\u1EC7'],
    'i'        :['i',        '\\u00ED','\\u00EC','\\u1EC9','\\u0129','\\u1ECB'],
    'o'        :['o',        '\\u00F3','\\u00F2','\\u1ECF','\\u00F5','\\u1ECD'],
    '\\u00F4'  :['\\u00F4',  '\\u1ED1','\\u1ED3','\\u1ED5','\\u1ED7','\\u1ED9'],
    '\\u01A1'  :['\\u01A1',  '\\u1EDB','\\u1EDD','\\u1EDF','\\u1EE1','\\u1EE3'],
    'u'        :['u',        '\\u00FA','\\u00F9','\\u1EE7','\\u0169','\\u1EE5'],
    '\\u01B0'  :['\\u01B0',  '\\u1EE9','\\u1EEB','\\u1EED','\\u1EEF','\\u1EF1'],
    'y'        :['y',        '\\u00FD','\\u1EF3','\\u1EF7','\\u1EF9','\\u1EF5']
  };

  var VI = {};
  (function(){
    for (var b in TONE_MAP) {
      var a = TONE_MAP[b];
      for (var t = 0; t < a.length; t++) VI[a[t]] = {b:b, t:t};
    }
  })();

  function vi(c) { return VI[c] || null; }

  function modVowel(oldCh, newBase) {
    var v = vi(oldCh);
    var t = v ? v.t : 0;
    return TONE_MAP[newBase] ? TONE_MAP[newBase][t] : newBase;
  }

  function strip(word) {
    var t=0, w='';
    for (var i=0; i<word.length; i++) {
      var v=vi(word[i]);
      if(v){ if(v.t>0) t=v.t; w+=v.b; } else w+=word[i];
    }
    return {w:w, t:t};
  }

  function tonePos(word) {
    for (var i=word.length-1; i>=0; i--) if(vi(word[i])) return i;
    return -1;
  }

  function telex(word, key) {
    var last  = word.length > 0 ? word[word.length-1] : '';
    var lv    = vi(last);
    var lBase = lv ? lv.b : last;

    if (key in TONE_KEYS) {
      var newT = TONE_KEYS[key];
      var s = strip(word);
      var pos = tonePos(s.w);
      if (pos < 0) return null;
      var applyT = (s.t === newT) ? 0 : newT;
      var vb = vi(s.w[pos]) ? vi(s.w[pos]).b : s.w[pos];
      var nc = TONE_MAP[vb] ? TONE_MAP[vb][applyT] : s.w[pos];
      return s.w.slice(0,pos) + nc + s.w.slice(pos+1);
    }

    if (key === 'd') {
      if (last === 'd')        return word.slice(0,-1) + '\\u0111';
      if (last === '\\u0111')  return word.slice(0,-1) + 'd';
      return null;
    }

    if (key === 'a' && lBase === 'a') {
      return word.slice(0,-1) + modVowel(last, (lv && lv.b==='\\u00E2') ? 'a' : '\\u00E2');
    }
    if (key === 'e' && lBase === 'e') {
      return word.slice(0,-1) + modVowel(last, (lv && lv.b==='\\u00EA') ? 'e' : '\\u00EA');
    }
    if (key === 'o' && lBase === 'o') {
      return word.slice(0,-1) + modVowel(last, (lv && lv.b==='\\u00F4') ? 'o' : '\\u00F4');
    }

    if (key === 'w') {
      if (word.length>=2 && lBase==='o') {
        var prev=word[word.length-2]; var pv=vi(prev);
        if (pv && pv.b==='u') return word.slice(0,-2) + modVowel(prev,'\\u01B0') + last;
      }
      if (lBase==='a')       return word.slice(0,-1)+modVowel(last,'\\u0103');
      if (lBase==='\\u0103') return word.slice(0,-1)+modVowel(last,'a');
      if (lBase==='o')       return word.slice(0,-1)+modVowel(last,'\\u01A1');
      if (lBase==='\\u01A1') return word.slice(0,-1)+modVowel(last,'o');
      if (lBase==='u')       return word.slice(0,-1)+modVowel(last,'\\u01B0');
      if (lBase==='\\u01B0') return word.slice(0,-1)+modVowel(last,'u');
      return null;
    }

    return null;
  }

  function telexReplace(newWord) {
    if (!activeInput) return;
    var dc = telexWord.length;
    if (activeInput.isContentEditable) {
      for (var i=0;i<dc;i++) document.execCommand('delete',false,null);
      document.execCommand('insertText',false,newWord);
    } else {
      var val=activeInput.value||'', pos=activeInput.selectionStart||0;
      var from=Math.max(0,pos-dc);
      activeInput.value=val.slice(0,from)+newWord+val.slice(pos);
      activeInput.selectionStart=activeInput.selectionEnd=from+newWord.length;
    }
    telexWord=newWord;
  }

  function resetTelex(){ telexWord=''; }

  /* ---- DOM ------------------------------------------------- */
  function ensureDOM() {
    if(!document.body||!document.head) return false;
    if(!document.getElementById('kiosk-vkb-style')){
      var st=document.createElement('style');
      st.id='kiosk-vkb-style';
      st.textContent=
        '#kiosk-vkb-container{position:fixed !important;top:auto !important;bottom:-200vh !important;'+
        'left:0 !important;right:0 !important;margin:0 auto !important;'+
        'width:'+VKB_WIDTH+' !important;height:'+VKB_HEIGHT+' !important;'+
        'container-type:size;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;'+
        'display:flex;flex-direction:column;padding:4px;box-sizing:border-box;'+
        'user-select:none;-webkit-user-select:none;font-family:sans-serif;touch-action:manipulation;border:none;}'+
        '#kiosk-vkb-container:popover-open{display:flex;}'+
        '#kiosk-vkb-container.vkb-visible{bottom:0 !important;}'+
        '.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;flex:1;}'+
        '.vkb-row:last-child{margin-bottom:0;}'+
        '.vkb-key{flex:1;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;'+
        'font-size:11.5cqh;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}'+
        '.vkb-key:active{background:#555;}'+
        '.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:9cqh;}'+
        '.vkb-key-layout:active{background:#233544;}'+
        '.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:11cqh;}'+
        '.vkb-key-special:active{background:#364538;}'+
        '.vkb-key-large-icon{font-size:15cqh;}'+
        '.vkb-key-backspace{font-size:18cqh;}'+
        '.vkb-key-hide{background:#8b3a3a;color:#e2e8f0;font-size:12.5cqh;}'+
        '.vkb-key-hide:active{background:#6b2a2a;}'+
        '.vkb-key-enter{background:#E95420;color:#fff;border-color:#c94618;font-size:12.5cqh;}'+
        '.vkb-key-enter:active{background:#c94618;}'+
        '.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}'+
        '.vkb-key-vn{font-size:8.5cqh !important;}'+
        '.vkb-key-vn-on{background:#1a5c1a !important;color:#7fff7f !important;}';
      document.head.appendChild(st);
    }
    if(!keyboardContainer){
      keyboardContainer=document.createElement('div');
      keyboardContainer.id='kiosk-vkb-container';
      if(keyboardContainer.popover!==undefined) keyboardContainer.popover='manual';
      renderKeyboard();
    }
    if(!document.body.contains(keyboardContainer)) document.body.appendChild(keyboardContainer);
    return true;
  }

  function renderKeyboard(){
    if(!keyboardContainer) return;
    keyboardContainer.innerHTML='';
    layouts[currentLayout].forEach(function(row){
      var rd=document.createElement('div');
      rd.className='vkb-row';
      row.forEach(function(key){
        var btn=document.createElement('button');
        btn.className='vkb-key';
        btn.textContent=(key==='Space')?'':key;
        btn.dataset.key=key;
        if(['?123','ABC','=\\u005C<'].includes(key)) btn.classList.add('vkb-key-layout');
        if(['\\u21E7','\\u232B','\\u25C4','\\u25BA','\\u21B9'].includes(key)) btn.classList.add('vkb-key-special');
        if(['\\u21E7','\\u21B9'].includes(key)) btn.classList.add('vkb-key-large-icon');
        if(key==='\\u232B') btn.classList.add('vkb-key-backspace');
        if(key==='\\u25BC') btn.classList.add('vkb-key-hide');
        if(key==='Space')   btn.classList.add('vkb-key-space');
        if(key==='\\u25C4'||key==='\\u25BA') btn.classList.add('vkb-key-arrow');
        if(key==='\\u23CE') btn.classList.add('vkb-key-enter');
        if(key==='\\u21E7'&&isShifted){btn.style.background='#e2e8f0';btn.style.color='#121212';}
        if(key==='VN'){
          btn.classList.add('vkb-key-layout','vkb-key-vn');
          btn.textContent=isVietnamese?'VN\\u2713':'VN';
          if(isVietnamese) btn.classList.add('vkb-key-vn-on');
        }
        rd.appendChild(btn);
      });
      keyboardContainer.appendChild(rd);
    });
  }

  /* ---- Text insertion -------------------------------------- */
  function insertText(text){
    if(!activeInput) return;
    if(activeInput.isContentEditable){
      document.execCommand('insertText',false,text);
    } else {
      var val=activeInput.value||'', s=activeInput.selectionStart||0, e=activeInput.selectionEnd||0;
      activeInput.value=val.slice(0,s)+text+val.slice(e);
      activeInput.selectionStart=activeInput.selectionEnd=s+text.length;
    }
  }

  /* ---- Process key ----------------------------------------- */
  function processKey(key){
    if(!activeInput) return;
    if(typeof activeInput.focus==='function') activeInput.focus();

    switch(key){
      case '\\u25BC': hideKeyboard(); resetTelex(); break;

      case '\\u21E7':
        isShifted=!isShifted; currentLayout=isShifted?'shift':'default'; renderKeyboard(); break;

      case 'VN':
        isVietnamese=!isVietnamese; resetTelex(); renderKeyboard(); break;

      case '?123':
        currentLayout='symbols'; isShifted=false; resetTelex(); renderKeyboard(); break;
      case 'ABC':
        currentLayout='default'; isShifted=false; resetTelex(); renderKeyboard(); break;
      case '=\\u005C<':
        currentLayout='extended'; isShifted=false; resetTelex(); renderKeyboard(); break;

      case '\\u21B9': insertText('\\t'); resetTelex(); break;

      case '\\u232B':
        if(activeInput.isContentEditable){
          document.execCommand('delete',false,null);
        } else {
          var val2=activeInput.value||'', s2=activeInput.selectionStart||0, e2=activeInput.selectionEnd||0;
          if(s2===e2&&s2>0){ activeInput.value=val2.slice(0,s2-1)+val2.slice(e2); activeInput.selectionStart=activeInput.selectionEnd=s2-1; }
          else if(s2!==e2){ activeInput.value=val2.slice(0,s2)+val2.slice(e2); activeInput.selectionStart=activeInput.selectionEnd=s2; }
        }
        if(telexWord.length>0) telexWord=telexWord.slice(0,-1);
        break;

      case 'Space': insertText(' '); resetTelex(); break;

      case '\\u25C4':
        if(!activeInput.isContentEditable){ var s3=activeInput.selectionStart||0; if(s3>0) activeInput.selectionStart=activeInput.selectionEnd=s3-1; }
        resetTelex(); break;

      case '\\u25BA':
        if(!activeInput.isContentEditable){ var e3=activeInput.selectionEnd||0; if(e3<(activeInput.value||'').length) activeInput.selectionStart=activeInput.selectionEnd=e3+1; }
        resetTelex(); break;

      case '\\u23CE':
        if(activeInput.isContentEditable){
      document.execCommand('insertParagraph',false,null);
        activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
        } else if(activeInput.tagName==='TEXTAREA'){
          insertText('\\n');
        } else {
          var ev={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,composed:true,cancelable:true};
          activeInput.dispatchEvent(new KeyboardEvent('keydown',ev));
          activeInput.dispatchEvent(new KeyboardEvent('keypress',ev));
          activeInput.dispatchEvent(new KeyboardEvent('keyup',ev));
        }

        // ✅ CHỈ COMMIT Ở ĐÂY
        if (commitOnEnterOnly) {
          commitInput();
        }

        hideKeyboard();
        resetTelex();
        break;

      default:
        if(!key) break;
        var isLetter=/^[a-zA-Z]$/.test(key);
        if(isVietnamese&&(currentLayout==='default'||currentLayout==='shift')&&isLetter){
          var lk=key.toLowerCase();
          var nw=telex(telexWord,lk);
          if(nw!==null){ telexReplace(nw); }
          else { insertText(key); telexWord+=lk; }
        } else {
          if(!isLetter) resetTelex();
          insertText(key);
        }
        if(isShifted&&isLetter){ isShifted=false; currentLayout='default'; renderKeyboard(); }
        break;
    }

    // ❌ KHÔNG gửi event mỗi phím nữa
    if (!commitOnEnterOnly && key!=='\\u23CE'&&key!=='\\u25BC'){
      activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    }
  }

  /* ---- Show / Hide ----------------------------------------- */
  function showKeyboard(el){
    activeInput=el; renderKeyboard();
    window.__vkbOpeningShield=Date.now();
    if(keyboardContainer.showPopover){
      if(keyboardContainer.matches(':popover-open')) keyboardContainer.hidePopover();
      keyboardContainer.showPopover();
    }
    keyboardContainer.classList.add('vkb-visible');
    if(activeInput&&activeInput.scrollIntoView) activeInput.scrollIntoView({behavior:'auto',block:'center'});
  }

  function hideKeyboard(){
    window.__vkbClosingShield=Date.now();
    if(keyboardContainer){
      keyboardContainer.classList.remove('vkb-visible');
      if(keyboardContainer.hidePopover&&keyboardContainer.matches(':popover-open')) keyboardContainer.hidePopover();
    }
    if(activeInput&&activeInput.blur) activeInput.blur();
    activeInput=null; isShifted=false; currentLayout='default';
  }

  /* ---- Input resolver -------------------------------------- */
  var validTypes=['text','email','number','password','search','tel','url'];
  function resolveInput(path){
    for(var i=0;i<path.length;i++){
      var el=path[i]; if(!el||!el.tagName) continue;
      var t=el.tagName.toUpperCase();
      if(t==='INPUT'&&validTypes.includes(el.type)) return el;
      if(t==='TEXTAREA'||el.isContentEditable||(el.classList&&el.classList.contains('cm-content'))) return el;
      if(['HA-TEXTFIELD','HA-SEARCH-INPUT','HA-CODE-EDITOR','HA-SELECTOR-TEXT'].includes(t)){
        var inner=el.shadowRoot?el.shadowRoot.querySelector('input,textarea,[contenteditable="true"],.cm-content'):null;
        if(inner) return inner;
      }
    }
    return null;
  }

  function checkAndShow(e){
    var path=e.composedPath?e.composedPath():[e.target];
    var inp=resolveInput(path);
    if(inp&&ensureDOM()){
      var vis=keyboardContainer&&keyboardContainer.classList.contains('vkb-visible');
      if(activeInput!==inp||!vis) showKeyboard(inp);
    }
  }

  document.addEventListener('focusin',checkAndShow,true);
  document.addEventListener('click',checkAndShow,true);

  /* ---- Master event shield --------------------------------- */
  ['pointerdown','pointerup','mousedown','mouseup','click','touchstart','touchend'].forEach(function(ev){
    document.addEventListener(ev,function(e){
      if(window.__vkbClosingShield&&(Date.now()-window.__vkbClosingShield<400)){
        e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return;
      }
      if(keyboardContainer&&keyboardContainer.classList.contains('vkb-visible')){
        var x=e.clientX,y=e.clientY;
        if(x===undefined&&e.changedTouches&&e.changedTouches.length>0){x=e.changedTouches[0].clientX;y=e.changedTouches[0].clientY;}
        if(x===undefined||y===undefined) return;
        var rect=keyboardContainer.getBoundingClientRect();
        if(y>=rect.top&&y<=rect.bottom&&x>=rect.left&&x<=rect.right){
          e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
          if(window.__vkbOpeningShield&&(Date.now()-window.__vkbOpeningShield<400)) return;
          if(['pointerdown','touchstart','mousedown','click'].includes(ev)){
            if(window.__vkbLastTap&&(Date.now()-window.__vkbLastTap<250)) return;
            window.__vkbLastTap=Date.now();
            var keys=keyboardContainer.querySelectorAll('.vkb-key'),found=null;
            for(var i=0;i<keys.length;i++){
              var kr=keys[i].getBoundingClientRect();
              if(y>=kr.top&&y<=kr.bottom&&x>=kr.left&&x<=kr.right){found=keys[i];break;}
            }
            if(found){
              var k=found.dataset.key;
              found.style.background='#555';
              setTimeout(function(){found.style.background='';},100);
              processKey(k);
            }
          }
          return;
        }
        if(ev==='pointerdown'){
          var p2=e.composedPath?e.composedPath():[e.target];
          if(!resolveInput(p2)) hideKeyboard();
        }
      }
    },true);
  });

  console.log('[VKB] Ready — Telex Vietnamese IME active.');
})();`;

// ============================================
// HELPER: Setup viewport
// ============================================
async function setupStableViewport(
  session: CDPSession, width: number, height: number, maxRetries = 3
): Promise<boolean> {
  console.log(`[Viewport] Setting up ${width}x${height}`);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
        screenWidth: width, screenHeight: height, positionX: 0, positionY: 0
      });
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      try { await session.send('Emulation.setLocaleOverride', { locale: BROWSER_LOCALE }); } catch { }
      if (PREFERS_REDUCED_MOTION) {
        await session.send('Emulation.setEmulatedMedia', {
          media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
      }
      await new Promise(r => setTimeout(r, 300));
      const res = await session.send('Runtime.evaluate', {
        expression: `({width:window.innerWidth,height:window.innerHeight})`, returnByValue: true
      });
      const sz = res.result?.value;
      if (sz) {
        console.log(`[Viewport] Attempt ${attempt}: got ${sz.width}x${sz.height}`);
        if (sz.width === width && sz.height === height) { console.log(`[Viewport] ✓`); return true; }
      }
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.warn(`[Viewport] ⚠️ Failed after ${maxRetries} attempts`);
  return false;
}

// ============================================
// HELPER: Codec check (once)
// ============================================
async function verifyCodecSupport(session: CDPSession): Promise<void> {
  if (_codecVerified) return;
  try {
    const r = await session.send('Runtime.evaluate', {
      expression: `(()=>{const v=document.createElement('video');return{h264:v.canPlayType('video/mp4;codecs="avc1.42E01E"')};})()`,
      returnByValue: true
    });
    const s = r.result?.value;
    if (s) {
      if (!s.h264) console.warn('⚠️  H.264 not supported — install google-chrome-stable');
      else console.log('✅ H.264 supported');
    }
    _codecVerified = true;
  } catch { }
}

// ============================================
// MAIN
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
    }
    console.log(`[device] Reconfiguring ${id}`);
    await deleteDeviceAsync(device);
  }

  const { targetId } = await root.send<{ targetId: string }>('Target.createTarget', {
    url: 'about:blank', width: cfg.width, height: cfg.height,
  });
  const { sessionId } = await root.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId, flatten: true
  });
  const session = (root as any).session(sessionId);

  await session.send('Page.enable');
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: KIOSK_KEYBOARD_SCRIPT });
  console.log('[device] ✓ Keyboard + Telex IME registered');

  const vpOk = await setupStableViewport(session, cfg.width, cfg.height);
  if (!vpOk) console.warn(`[device] ⚠️ Viewport mismatch ${cfg.width}x${cfg.height}`);

  await verifyCodecSupport(session);

  try {
    await session.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux x86_64'
    });
  } catch { }

  await session.send('Page.startScreencast', {
    format: 'png', maxWidth: cfg.width, maxHeight: cfg.height, everyNthFrame: cfg.everyNthFrame
  });

  const processor = new FrameProcessor({
    tileSize: cfg.tileSize,
    fullframeTileCount: cfg.fullFrameTileCount,
    fullframeAreaThreshold: cfg.fullFrameAreaThreshold,
    jpegQuality: cfg.jpegQuality,
    fullFrameEvery: cfg.fullFrameEvery,
    maxBytesPerMessage: cfg.maxBytesPerMessage,
  });

  const newDevice: DeviceSession = {
    id: targetId, deviceId: id, cdp: session, cfg,
    url: '', lastActive: Date.now(), frameId: 0, prevFrameHash: 0,
    processor, selfTestRunner: new SelfTestRunner(broadcaster),
    pendingB64: undefined, throttleTimer: undefined, lastProcessedMs: undefined,
  };
  devices.set(id, newDevice);
  newDevice.processor.requestFullFrame();

  const flushPending = async () => {
    const dev = newDevice;
    dev.throttleTimer = undefined;
    const b64 = dev.pendingB64;
    dev.pendingB64 = undefined;
    if (!b64) return;
    try {
      const pngFull = Buffer.from(b64, 'base64');
      const h32 = hash32(pngFull);
      if (dev.prevFrameHash === h32) { dev.lastProcessedMs = Date.now(); return; }
      dev.prevFrameHash = h32;
      let img = sharp(pngFull);
      if (dev.cfg.rotation) img = img.rotate(dev.cfg.rotation);
      const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const out = await processor.processFrameAsync({ data, width: info.width, height: info.height });
      if (out.rects.length > 0) {
        dev.frameId = (dev.frameId + 1) >>> 0;
        broadcaster.sendFrameChunked(id, out, dev.frameId, cfg.maxBytesPerMessage);
      }
    } catch (e) {
      console.warn(`[device] Frame error ${id}: ${(e as Error).message}`);
    } finally {
      dev.lastProcessedMs = Date.now();
    }
  };

  session.on('Page.screencastFrame', async (evt: any) => {
    session.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => { });
    if (broadcaster.getClientCount(newDevice.deviceId) === 0) return;
    newDevice.lastActive = Date.now();
    newDevice.pendingB64 = evt.data;
    const now = Date.now();
    const since = newDevice.lastProcessedMs ? (now - newDevice.lastProcessedMs) : Infinity;
    if (!newDevice.throttleTimer) {
      const delay = Math.max(0, cfg.minFrameInterval - (Number.isFinite(since) ? since : 0));
      newDevice.throttleTimer = setTimeout(flushPending, delay);
    }
  });

  console.log(`[device] ✓ Device ${id} ready (${cfg.width}x${cfg.height})`);
  return newDevice;
}

export async function cleanupIdleAsync(ttlMs = 5 * 60_000) {
  if (_cleanupRunning) return;
  _cleanupRunning = true;
  try {
    const now = Date.now();
    const stale = Array.from(devices.values())
      .filter(d => now - d.lastActive > ttlMs).map(d => d.deviceId);
    for (const id of stale) {
      const dev = devices.get(id);
      if (dev) await deleteDeviceAsync(dev).catch(() => { });
    }
  } finally { _cleanupRunning = false; }
}

async function deleteDeviceAsync(device: DeviceSession) {
  const root = getRoot();
  if (!devices.delete(device.deviceId)) return;
  if (device.throttleTimer) clearTimeout(device.throttleTimer);
  try { await device.cdp.send("Page.stopScreencast").catch(() => { }); } catch { }
  try { await root?.send("Target.closeTarget", { targetId: device.id }); } catch { }
}
