// 強化版 app.js（B 方案）— 資料載入更耐髒，UI 元件可選用
// 與 index.html 以一般 <script> 方式搭配（非 module）

// ===== 取得 UI 元件（有就用，沒有就自動忽略） =====
const ZHUYIN_EL       = document.getElementById('zhuyin');
const CANVAS          = document.getElementById('pad');
const CTX             = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext         = document.getElementById('btnNext');
const btnClear        = document.getElementById('btnClear');
const penSize         = document.getElementById('penSize');
const penSizeVal      = document.getElementById('penSizeVal');
const penColor        = document.getElementById('penColor');

//（以下為可選元件；若你的 index.html 沒有它們，程式會自動跳過不報錯）
const meterBar        = document.getElementById('meterBar');
const resultEl        = document.getElementById('result');
const explainEl       = document.getElementById('explain');
const cbTrace         = document.getElementById('cbTrace');
const traceAlpha      = document.getElementById('traceAlpha');
const traceAlphaVal   = document.getElementById('traceAlphaVal');

let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin}

// ==================== 資料載入（超耐髒版） ====================
function pickSourceArray() {
  // 1) 嘗試常見全域名稱
  let raw = window.WORDS || window.DATA || window.G3_TOP1_WORDS || window.words || window.db;

  // 2) 嘗試抓 top-level 的 const data（非 module 的 data.js 會存在）
  try { if (!raw && typeof data !== 'undefined') raw = data; } catch (e) {}

  if (!raw) {
    alert('找不到 data.js 的資料陣列（WORDS / DATA / G3_TOP1_WORDS / words / db / data）。請確認 data.js 已正確載入且非 module。');
    return [];
  }

  // 3) 扁平化為 [{char, zhuyin}, ...]，支援中文鍵名
  const out = [];
  const pushMaybe = (o) => {
    if (!o) return;
    const char   = o.char || o.word || o.hanzi || o.han || o.c || o['字'];
    const zhuyin = o.zhuyin || o.bopomofo || o.phonetic || o.z || o['注音'];
    if (char && zhuyin) out.push({ char: String(char), zhuyin: String(zhuyin).trim() });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item?.words)) {
        for (const w of item.words) pushMaybe(w);
      } else {
        pushMaybe(item);
      }
    }
  } else if (Array.isArray(raw.words)) {
    for (const w of raw.words) pushMaybe(w);
  }

  if (!out.length) {
    alert('data.js 已載入，但無法解析成 {char, zhuyin}；請確認鍵名是否為 char/zhuyin 或中文鍵名「字/注音」。');
  }
  return out;
}

const DB = pickSourceArray();

// ====================（可選）把資料依注音分組 ====================
const GROUP_BY_ZHUYIN = {};
for (const it of DB) {
  const key = (it.zhuyin || '').trim();
  if (!key) continue;
  (GROUP_BY_ZHUYIN[key] ||= []).push(it.char);
}
const ALL_KEYS = Object.keys(GROUP_BY_ZHUYIN);

// ==================== 題目抽選 ====================
function nextWord() {
  if (!DB.length) {
    if (ZHUYIN_EL) ZHUYIN_EL.textContent = '—';
    clearCanvas();
    return;
  }

  // 隨機抽一組注音，再在該組中抽一個字（若沒分組則直接從 DB 抽）
  let char, key;
  if (ALL_KEYS.length) {
    key = ALL_KEYS[Math.floor(Math.random() * ALL_KEYS.length)];
    const chars = GROUP_BY_ZHUYIN[key];
    char = chars[Math.floor(Math.random() * chars.length)];
  } else {
    const it = DB[Math.floor(Math.random() * DB.length)];
    key = it.zhuyin; char = it.char;
  }

  currentTarget = { char, zhuyin: key };
  if (ZHUYIN_EL) ZHUYIN_EL.textContent = key || '—';

  clearCanvas();
  updateMeter(0, '—', null); // 若沒有評分 UI 會自動忽略
  if (explainEl) explainEl.textContent = '';
}

// ==================== 畫布工具 ====================
function clearCanvas() {
  CTX.save();
  CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle = '#ffffff';
  CTX.fillRect(0,0,CANVAS.width,CANVAS.height);
  CTX.restore();

  // 若有描紅選項且開啟，畫出描紅（不影響評分）
  if (cbTrace?.checked && currentTarget) drawTrace(currentTarget.char);
}

function setLineStyle() {
  CTX.lineCap = 'round';
  CTX.lineJoin = 'round';
  CTX.strokeStyle = penColor?.value || '#000000';
  CTX.lineWidth = Number(penSize?.value || 10);
}

function getPos(e) {
  const rect = CANVAS.getBoundingClientRect();
  const cx = (x) => (x - rect.left) * (CANVAS.width / rect.width);
  const cy = (y) => (y - rect.top) * (CANVAS.height / rect.height);
  if (e.touches && e.touches[0]) {
    return { x: cx(e.touches[0].clientX), y: cy(e.touches[0].clientY) };
    } else {
    return { x: cx(e.clientX), y: cy(e.clientY) };
  }
}

// 事件：繪圖
CANVAS.addEventListener('pointerdown', (e) => {
  drawing = true; last = getPos(e); setLineStyle();
});
CANVAS.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = getPos(e);
  CTX.beginPath();
  CTX.moveTo(last.x, last.y);
  CTX.lineTo(p.x, p.y);
  CTX.stroke();
  last = p;
});
window.addEventListener('pointerup', () => {
  drawing = false; last = null;
  // 每次畫完一筆嘗試評分（若有評分 UI）
  if (currentTarget && (meterBar || resultEl)) scoreNow();
});

// 避免觸控捲動頁面
CANVAS.addEventListener('touchstart', (e)=>e.preventDefault(), {passive:false});
CANVAS.addEventListener('touchmove', (e)=>e.preventDefault(), {passive:false});

// 清除 / 下一題 / 筆粗顯示
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
penSize?.addEventListener('input', () => { if (penSizeVal) penSizeVal.textContent = penSize.value; });

// （可選）描紅控制
cbTrace?.addEventListener('change', () => clearCanvas());
traceAlpha?.addEventListener('input', () => {
  if (traceAlphaVal) traceAlphaVal.textContent = traceAlpha.value;
  if (cbTrace?.checked) clearCanvas();
});

// ====================（可選）描紅 ====================
function drawTrace(char) {
  const alpha = traceAlpha ? Math.max(0.05, Math.min(0.6, Number(traceAlpha.value)/100)) : 0.12;
  CTX.save();
  CTX.globalAlpha = alpha;
  const w = CANVAS.width, h = CANVAS.height;
  const size = Math.min(w, h) * 0.72;
  CTX.fillStyle = '#000';
  CTX.textAlign = 'center';
  CTX.textBaseline = 'middle';
  CTX.font = `${size}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  CTX.fillText(char, w/2, h/2);
  CTX.restore();
}

// ====================（可選）評分：Jaccard Pixel Overlap ====================
function binarize(imgData, thresh=200) {
  const { data, width, height } = imgData;
  const mask = new Uint8Array(width * height);
  for (let i=0; i<data.length; i+=4) {
    const v = (data[i] + data[i+1] + data[i+2]) / 3;
    mask[i>>2] = v < thresh ? 1 : 0;
  }
  return { mask, width, height };
}

function getBBox(mask, w, h) {
  let minx=w, miny=h, maxx=-1, maxy=-1, area=0;
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (mask[y*w + x]) {
        area++;
        if (x<minx) minx=x;
        if (x>maxx) maxx=x;
        if (y<miny) miny=y;
        if (y>maxy) maxy=y;
      }
    }
  }
  if (area===0) return null;
  return { x:minx, y:miny, w:maxx-minx+1, h:maxy-miny+1, area };
}

function extractAndNormalize(ctx, size=256) {
  const img = ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height);
  const { mask, width, height } = binarize(img, 220);
  const bbox = getBBox(mask, width, height);
  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0,0,size,size);

  if (!bbox) return { canvas: out, empty: true, mask: new Uint8Array(size*size), w:size, h:size };

  const scale = 0.86 * Math.min(size / bbox.w, size / bbox.h);
  const renderW = Math.max(1, Math.round(bbox.w * scale));
  const renderH = Math.max(1, Math.round(bbox.h * scale));

  const src = document.createElement('canvas');
  src.width = bbox.w; src.height = bbox.h;
  const sctx = src.getContext('2d');

  const srcImg = sctx.createImageData(bbox.w, bbox.h);
  for (let y=0; y<bbox.h; y++) {
    for (let x=0; x<bbox.w; x++) {
      const v = mask[(bbox.y+y)*width + (bbox.x+x)] ? 0 : 255;
      const idx = (y*bbox.w + x)*4;
      srcImg.data[idx]=v; srcImg.data[idx+1]=v; srcImg.data[idx+2]=v; srcImg.data[idx+3]=255;
    }
  }
  sctx.putImageData(srcImg, 0, 0);
  octx.imageSmoothingEnabled = false;
  const dx = Math.round((size - renderW)/2);
  const dy = Math.round((size - renderH)/2);
  octx.drawImage(src, 0, 0, bbox.w, bbox.h, dx, dy, renderW, renderH);

  const oimg = octx.getImageData(0,0,size,size);
  const bin = binarize(oimg, 220);
  return { canvas: out, empty: false, mask: bin.mask, w:size, h:size };
}

function renderTargetGlyph(ch, size=CANVAS.width) {
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,size,size);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(size*0.72)}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  ctx.fillText(ch, size/2, size/2);
  return off;
}

function dilateMask(mask, w, h, r=1) {
  if (r<=0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    let on = 0;
    for (let dy=-r; dy<=r; dy++) {
      for (let dx=-r; dx<=r; dx++) {
        const nx=x+dx, ny=y+dy;
        if (nx>=0 && nx<w && ny>=0 && ny<h) {
          if (mask[ny*w + nx]) { on=1; break; }
        }
      }
      if (on) break;
    }
    out[y*w + x] = on;
  }
  return out;
}

function jaccard(a, b) {
  let inter=0, union=0, ca=0, cb=0;
  const n = a.length;
  for (let i=0; i<n; i++) {
    if (a[i]) ca++;
    if (b[i]) cb++;
    const u = (a[i] | b[i]);
    const t = (a[i] & b[i]);
    union += u;
    inter += t;
  }
  return { j: union ? inter/union : 0, inter, union, ca, cb };
}

function updateMeter(pct, text, pass=null) {
  if (!meterBar && !resultEl) return; // 沒有評分 UI 就略過
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (meterBar) meterBar.style.width = clamped + '%';
  if (resultEl) {
    resultEl.textContent = `相似度：${clamped}%${text ? `｜${text}` : ''}`;
    resultEl.style.color = pass === true ? '#16a34a' : pass === false ? '#dc2626' : 'inherit';
  }
  if (meterBar) {
    meterBar.style.background = pass === true
      ? 'linear-gradient(90deg,#34d399,#10b981)'
      : pass === false
      ? 'linear-gradient(90deg,#fca5a5,#f87171)'
      : 'linear-gradient(90deg,#93c5fd,#60a5fa)';
  }
}

function scoreNow() {
  if (!currentTarget) return;
  if (!meterBar && !resultEl) return; // 沒有評分 UI 就不做計算

  const userNorm = extractAndNormalize(CTX, 256);
  if (userNorm.empty) { updateMeter(0, '請在畫布寫字'); return; }

  const glyph = renderTargetGlyph(currentTarget.char, 900);
  const gctx = glyph.getContext('2d');
  const glyphNorm = extractAndNormalize(gctx, 256);

  const userDil = dilateMask(userNorm.mask, userNorm.w, userNorm.h, 1);
  const { j, inter, union, ca, cb } = jaccard(userDil, glyphNorm.mask);

  const coverage = inter / (cb || 1);
  const score = Math.round(j * 100);
  const pass = (j >= 0.55) && (coverage >= 0.45);

  updateMeter(score, pass ? '判定：通過！' : '判定：再試試', pass);
  if (explainEl) {
    explainEl.textContent =
      `重疊覆蓋：${(coverage*100|0)}%，門檻：相似度≥55%、覆蓋≥45%。 ` +
      `你的像素：${ca}，標準像素：${cb}，聯集：${union}`;
  }
}

// ==================== 初始化 ====================
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
if (traceAlphaVal && traceAlpha) traceAlphaVal.textContent = traceAlpha.value;
nextWord();
