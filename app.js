// 無評分版 app.js（保留課次顯示與描紅）

const ZHUYIN_EL  = document.getElementById('zhuyin');
const LESSON_EL  = document.getElementById('lessonInfo');
const CANVAS     = document.getElementById('pad');
const CTX        = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext    = document.getElementById('btnNext');
const btnClear   = document.getElementById('btnClear');
const penSize    = document.getElementById('penSize');
const penSizeVal = document.getElementById('penSizeVal');
const penColor   = document.getElementById('penColor');
const cbTrace    = document.getElementById('cbTrace');
const traceAlpha = document.getElementById('traceAlpha');
const traceAlphaVal = document.getElementById('traceAlphaVal');

let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}

// ========== 資料載入（保留 lesson；支援多種鍵名與 const data） ==========
function pickSourceArray() {
  let raw = window.WORDS || window.DATA || window.G3_TOP1_WORDS || window.words || window.db;
  try { if (!raw && typeof data !== 'undefined') raw = data; } catch(e){}

  if (!raw) {
    alert('找不到 data.js 的資料陣列（WORDS / DATA / G3_TOP1_WORDS / words / db / data）。');
    return [];
  }

  const out = [];
  const pushMaybe = (o, lessonNo) => {
    if (!o) return;
    const char   = o.char || o.word || o.hanzi || o.han || o.c || o['字'];
    const zhuyin = o.zhuyin || o.bopomofo || o.phonetic || o.z || o['注音'];
    if (char && zhuyin) out.push({ char: String(char), zhuyin: String(zhuyin).trim(), lesson: lessonNo ?? null });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item?.words)) {
        const lessonNo = item.lesson ?? item.lsn ?? item.lessonNo ?? null;
        for (const w of item.words) pushMaybe(w, lessonNo);
      } else {
        pushMaybe(item, item.lesson ?? item.lsn ?? item.lessonNo ?? null);
      }
    }
  } else if (Array.isArray(raw.words)) {
    const lessonNo = raw.lesson ?? raw.lsn ?? raw.lessonNo ?? null;
    for (const w of raw.words) pushMaybe(w, lessonNo);
  }

  if (!out.length) alert('data.js 已載入，但無法解析成 {char, zhuyin}。');
  return out;
}
const DB = pickSourceArray();

// 依注音分組（保留整個物件，含 lesson）
const GROUP_BY_ZHUYIN = {};
for (const it of DB) {
  const key = (it.zhuyin || '').trim();
  if (!key) continue;
  (GROUP_BY_ZHUYIN[key] ||= []).push(it);
}
const ALL_KEYS = Object.keys(GROUP_BY_ZHUYIN);

// ========== 題目抽選（顯示課次；清畫布 + 描紅） ==========
function nextWord() {
  if (!DB.length) {
    if (ZHUYIN_EL) ZHUYIN_EL.textContent = '—';
    if (LESSON_EL) LESSON_EL.textContent = '';
    clearCanvas();
    return;
  }

  let item;
  if (ALL_KEYS.length) {
    const key = ALL_KEYS[Math.floor(Math.random() * ALL_KEYS.length)];
    const arr = GROUP_BY_ZHUYIN[key];
    item = arr[Math.floor(Math.random() * arr.length)];
  } else {
    item = DB[Math.floor(Math.random() * DB.length)];
  }

  currentTarget = item; // {char, zhuyin, lesson}
  if (ZHUYIN_EL) ZHUYIN_EL.textContent = currentTarget.zhuyin || '—';
  if (LESSON_EL) LESSON_EL.textContent = currentTarget.lesson ? `（第${currentTarget.lesson}課）` : '';

  clearCanvas(); // 會依勾選自動描紅
}

// ========== 畫布與描紅 ==========
function clearCanvas() {
  CTX.save();
  CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle = '#ffffff';
  CTX.fillRect(0,0,CANVAS.width,CANVAS.height);
  CTX.restore();
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
  if (e.touches && e.touches[0]) return { x: cx(e.touches[0].clientX), y: cy(e.touches[0].clientY) };
  return { x: cx(e.clientX), y: cy(e.clientY) };
}

// 描紅：把標準字以指定透明度畫在中心（不影響書寫）
function drawTrace(char) {
  const alpha = traceAlpha ? Math.max(0.05, Math.min(0.6, Number(traceAlpha.value)/100)) : 0.12;
  CTX.save();
  CTX.globalAlpha = alpha;
  const w = CANVAS.width, h = CANVAS.height, size = Math.min(w, h) * 0.72;
  CTX.fillStyle = '#000';
  CTX.textAlign = 'center';
  CTX.textBaseline = 'middle';
  CTX.font = `${size}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  CTX.fillText(char, w/2, h/2);
  CTX.restore();
}

// 繪圖事件
CANVAS.addEventListener('pointerdown', (e) => { drawing = true; last = getPos(e); setLineStyle(); });
CANVAS.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = getPos(e);
  CTX.beginPath(); CTX.moveTo(last.x, last.y); CTX.lineTo(p.x, p.y); CTX.stroke();
  last = p;
});
window.addEventListener('pointerup', () => { drawing = false; last = null; });
CANVAS.addEventListener('touchstart', (e)=>e.preventDefault(), {passive:false});
CANVAS.addEventListener('touchmove', (e)=>e.preventDefault(), {passive:false});

// 控制項
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
penSize?.addEventListener('input', () => { if (penSizeVal) penSizeVal.textContent = penSize.value; });
cbTrace?.addEventListener('change', () => clearCanvas());
traceAlpha?.addEventListener('input', () => { if (traceAlphaVal) traceAlphaVal.textContent = traceAlpha.value; if (cbTrace?.checked) clearCanvas(); });

// 初始化
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
if (traceAlphaVal && traceAlpha) traceAlphaVal.textContent = traceAlpha.value;
nextWord();
