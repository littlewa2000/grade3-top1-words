// 強化版 app.js（B 方案）：資料載入更耐髒，支援多種命名與中文鍵名
// 適用於 index.html 以一般 <script> 方式載入 data.js 與 app.js（非 module）

const ZHUYIN_EL = document.getElementById('zhuyin');
const CANVAS = document.getElementById('pad');
const CTX = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext   = document.getElementById('btnNext');
const btnClear  = document.getElementById('btnClear');
const penSize   = document.getElementById('penSize');
const penSizeVal= document.getElementById('penSizeVal');
const penColor  = document.getElementById('penColor');

let drawing = false;
let last = null;

// ==================== 資料載入（耐髒版） ====================
function pickSourceArray() {
  // 1) 嘗試各種常見全域變數名稱
  let raw = window.WORDS || window.DATA || window.G3_TOP1_WORDS || window.words || window.db;

  // 2) 嘗試抓 top-level 的 const data（若 data.js 不是 module，瀏覽器上會存在）
  //    用 typeof 避免 ReferenceError
  try { if (!raw && typeof data !== 'undefined') raw = data; } catch (e) {}

  if (!raw) {
    alert('找不到 data.js 的資料陣列（WORDS / DATA / G3_TOP1_WORDS / words / db / data）。請確認 data.js 已正確載入且非 module。');
    return [];
  }

  // 3) 扁平化成 [{char, zhuyin}, ...]，同時支援中文鍵名
  const out = [];
  const pushMaybe = (o) => {
    if (!o) return;
    // 支援多種鍵名（包含中文）
    const char   = o.char || o.word || o.hanzi || o.han || o.c || o['字'];
    const zhuyin = o.zhuyin || o.bopomofo || o.phonetic || o.z || o['注音'];

    if (char && zhuyin) out.push({ char, zhuyin: String(zhuyin).trim() });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item?.words)) {
        // 支援課次巢狀格式：[{ lesson, words:[...] }, ...]
        for (const w of item.words) pushMaybe(w);
      } else {
        // 扁平格式：[{ char, zhuyin }, ...] 或中文鍵名
        pushMaybe(item);
      }
    }
  } else {
    // 假如 data.js 用的是物件包陣列的特殊格式，也嘗試展開
    if (Array.isArray(raw.words)) {
      for (const w of raw.words) pushMaybe(w);
    }
  }

  if (!out.length) {
    alert('data.js 已載入，但無法解析成 {char, zhuyin}；請確認鍵名是否為 char/zhuyin 或已含中文鍵名「字/注音」。');
  }
  return out;
}

const DB = pickSourceArray();

// ==================== 出題邏輯 ====================
let current = null; // {char, zhuyin}

function nextWord() {
  if (!DB.length) {
    ZHUYIN_EL.textContent = '—';
    return;
  }
  const idx = Math.floor(Math.random() * DB.length);
  current = DB[idx];
  ZHUYIN_EL.textContent = current.zhuyin || '—';
  clearCanvas();
}

// ==================== 畫布工具 ====================
function clearCanvas() {
  CTX.fillStyle = '#ffffff';
  CTX.fillRect(0, 0, CANVAS.width, CANVAS.height);
}

function getPos(e) {
  const rect = CANVAS.getBoundingClientRect();
  const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return {
    x: px * (CANVAS.width / rect.width),
    y: py * (CANVAS.height / rect.height)
  };
}

function setLineStyle() {
  CTX.lineCap = 'round';
  CTX.lineJoin = 'round';
  CTX.strokeStyle = penColor ? penColor.value : '#000000';
  CTX.lineWidth = Number(penSize?.value || 10);
}

// ==================== 事件繫結 ====================
CANVAS.addEventListener('pointerdown', (e) => {
  drawing = true;
  last = getPos(e);
  setLineStyle();
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

window.addEventListener('pointerup', () => { drawing = false; });

btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);

penSize?.addEventListener('input', () => {
  if (penSizeVal) penSizeVal.textContent = penSize.value;
});

// 初始狀態
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
nextWord();
