// app.js — 描紅 + 辨識 +「測驗範圍（第1課～第N課）」下拉選單

// ===== 主要 UI =====
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

// 新增：篩選範圍用下拉選單
const lessonMaxSel = document.getElementById('lessonMax');

// （可選）辨識工具
const btnRecognize = document.getElementById('btnRecognize');
const scopeLesson  = document.getElementById('scopeLesson');
const scopeAll     = document.getElementById('scopeAll');
const recogList    = document.getElementById('recogList');

// ===== 狀態 =====
let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}
const TRACE_RATIO = 0.72;

// ===== 描紅/可書寫區 =====
function getTraceBox() {
  const w = CANVAS.width, h = CANVAS.height;
  const size = Math.floor(Math.min(w, h) * TRACE_RATIO);
  const x = Math.floor((w - size) / 2);
  const y = Math.floor((h - size) / 2);
  return { x, y, w: size, h: size };
}

// ===== 載入資料（保留 lesson；支援多鍵名與 const data） =====
function pickSourceArray() {
  let raw = window.WORDS || window.DATA || window.G3_TOP1_WORDS || window.words || window.db;
  try { if (!raw && typeof data !== 'undefined') raw = data; } catch(e){}
  if (!raw) { alert('找不到 data.js 的資料陣列'); return []; }

  const out = [];
  const pushMaybe = (o, lessonNo) => {
    const char   = o?.char || o?.word || o?.hanzi || o?.han || o?.c || o?.['字'];
    const zhuyin = o?.zhuyin || o?.bopomofo || o?.phonetic || o?.z || o?.['注音'];
    if (char && zhuyin) out.push({ char: String(char), zhuyin: String(zhuyin).trim(), lesson: lessonNo ?? null });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (Array.isArray(item?.words)) {
        const lessonNo = item.lesson ?? item.lsn ?? item.lessonNo ?? null;
        for (const w of item.words) pushMaybe(w, lessonNo);
      } else { pushMaybe(item, item.lesson ?? item.lsn ?? item.lessonNo ?? null); }
    }
  } else if (Array.isArray(raw.words)) {
    const lessonNo = raw.lesson ?? raw.lsn ?? raw.lessonNo ?? null;
    for (const w of raw.words) pushMaybe(w, lessonNo);
  }

  if (!out.length) alert('data.js 已載入，但無法解析成 {char, zhuyin}');
  return out;
}
const DB = pickSourceArray();

// ===== 依選單篩選：第 1 課～第 N 課 =====
function getMaxLesson() {
  const v = parseInt(lessonMaxSel?.value || '12', 10);
  return Number.isFinite(v) ? v : 12;
}
function filteredDB() {
  const max = getMaxLesson();
  // lesson 可能為 null（沒標課次）則也納入
  return DB.filter(it => it.lesson == null || it.lesson <= max);
}
function filteredGroupByZhuyin() {
  const map = {};
  for (const it of filteredDB()) {
    const key = (it.zhuyin || '').trim();
    (map[key] ||= []).push(it);
  }
  return map;
}
function filteredUniqueChars() {
  const set = new Set();
  for (const it of filteredDB()) set.add(it.char);
  return Array.from(set);
}

// ===== 出題（依範圍） =====
function nextWord() {
  const FDB = filteredDB();
  if (!FDB.length) {
    if (ZHUYIN_EL) ZHUYIN_EL.textContent = '—';
    if (LESSON_EL) LESSON_EL.textContent = '';
    clearCanvas();
    renderRecog([]);
    return;
  }
  const G = filteredGroupByZhuyin();
  const keys = Object.keys(G);
  let item;
  if (keys.length) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    const arr = G[key];
    item = arr[Math.floor(Math.random() * arr.length)];
  } else {
    item = FDB[Math.floor(Math.random() * FDB.length)];
  }
  currentTarget = item;
  if (ZHUYIN_EL) ZHUYIN_EL.textContent = currentTarget.zhuyin || '—';
  if (LESSON_EL) LESSON_EL.textContent = currentTarget.lesson ? `（第${currentTarget.lesson}課）` : '';
  clearCanvas();
  renderRecog([]);
}

// ===== 畫布：清空、外框、描紅、限制寫字區 =====
function clearCanvas() {
  CTX.save();
  CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle = '#ffffff';
  CTX.fillRect(0,0,CANVAS.width,CANVAS.height);
  CTX.restore();
  drawWritingBoxOutline();
  if (cbTrace?.checked && currentTarget) drawTrace(currentTarget.char);
}
function drawWritingBoxOutline() {
  const box = getTraceBox();
  CTX.save();
  CTX.strokeStyle = '#cbd5e1';
  CTX.lineWidth = 2;
  CTX.setLineDash([8, 6]);
  CTX.strokeRect(box.x, box.y, box.w, box.h);
  CTX.restore();
}
function drawTrace(char) {
  const box = getTraceBox();
  const alpha = traceAlpha ? Math.max(0.05, Math.min(0.6, Number(traceAlpha.value)/100)) : 0.12;
  CTX.save();
  CTX.globalAlpha = alpha;
  CTX.fillStyle = '#000';
  CTX.textAlign = 'center';
  CTX.textBaseline = 'middle';
  CTX.font = `${Math.floor(box.w * 0.9)}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  CTX.fillText(char, box.x + box.w/2, box.y + box.h/2);
  CTX.restore();
}
function setLineStyle() {
  CTX.lineCap = 'round';
  CTX.lineJoin = 'round';
  CTX.strokeStyle = penColor?.value || '#000000';
  CTX.lineWidth = Number(penSize?.value || 10);
}
function getPos(e) {
  const r = CANVAS.getBoundingClientRect();
  const sx = CANVAS.width / r.width, sy = CANVAS.height / r.height;
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
  return { x: x * sx, y: y * sy };
}
CANVAS.addEventListener('pointerdown', (e) => { drawing = true; last = getPos(e); setLineStyle(); });
CANVAS.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = getPos(e);
  const box = getTraceBox();
  CTX.save();
  CTX.beginPath(); CTX.rect(box.x, box.y, box.w, box.h); CTX.clip();
  CTX.beginPath(); CTX.moveTo(last.x, last.y); CTX.lineTo(p.x, p.y); CTX.stroke();
  CTX.restore();
  last = p;
});
window.addEventListener('pointerup', () => { drawing = false; last = null; });
CANVAS.addEventListener('touchstart',(e)=>e.preventDefault(),{passive:false});
CANVAS.addEventListener('touchmove',(e)=>e.preventDefault(),{passive:false});

// 控制項
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
penSize?.addEventListener('input', ()=>{ if (penSizeVal) penSizeVal.textContent = penSize.value; });
cbTrace?.addEventListener('change', clearCanvas);
traceAlpha?.addEventListener('input', ()=>{
  if (traceAlphaVal) traceAlphaVal.textContent = traceAlpha.value;
  if (cbTrace?.checked) clearCanvas();
});
// ⭐ 當變更「測驗範圍」時，立即重抽一題
lessonMaxSel?.addEventListener('change', () => nextWord());

// =====（可選）辨識：模板比對（Top-5），候選依範圍 =====
function binarize(imgData, thresh=200) {
  const { data, width, height } = imgData;
  const mask = new Uint8Array(width*height);
  for (let i=0;i<data.length;i+=4){
    const v=(data[i]+data[i+1]+data[i+2])/3;
    mask[i>>2] = v < thresh ? 1 : 0;
  }
  return { mask, width, height };
}
function getBBox(mask, w, h) {
  let minx=w,miny=h,maxx=-1,maxy=-1, area=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    if (mask[y*w+x]){ area++; if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
  }
  if (!area) return null;
  return { x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1, area };
}
function extractAndNormalize(ctx, size=192) {
  const box = getTraceBox();
  const img = ctx.getImageData(box.x, box.y, box.w, box.h);
  const { mask, width, height } = binarize(img, 220);
  const box2 = getBBox(mask, width, height);
  const out = document.createElement('canvas'); out.width=size; out.height=size;
  const octx = out.getContext('2d'); octx.fillStyle='#fff'; octx.fillRect(0,0,size,size);
  if (!box2) return { mask:new Uint8Array(size*size), w:size, h:size, empty:true };
  const src = document.createElement('canvas'); src.width=box2.w; src.height=box2.h;
  const sctx = src.getContext('2d'); const sImg = sctx.createImageData(box2.w, box2.h);
  for (let y=0;y<box2.h;y++) for (let x=0;x<box2.w;x++){
    const on = mask[(box2.y+y)*width + (box2.x+x)] ? 0 : 255;
    const idx=(y*box2.w+x)*4; sImg.data[idx]=on; sImg.data[idx+1]=on; sImg.data[idx+2]=on; sImg.data[idx+3]=255;
  }
  sctx.putImageData(sImg,0,0);
  const scale = 0.9 * Math.min(size/box2.w, size/box2.h);
  const renderW = Math.max(1, Math.round(box2.w*scale));
  const renderH = Math.max(1, Math.round(box2.h*scale));
  const dx=Math.round((size-renderW)/2), dy=Math.round((size-renderH)/2);
  octx.imageSmoothingEnabled=false;
  octx.drawImage(src,0,0,box2.w,box2.h,dx,dy,renderW,renderH);
  const oimg=octx.getImageData(0,0,size,size);
  return { ...binarize(oimg, 220), empty:false };
}
function renderGlyphMask(ch, size=192) {
  const c = document.createElement('canvas'); c.width=size; c.height=size;
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle';
  g.font = `${Math.floor(size*0.9)}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  g.fillText(ch, size/2, size/2);
  const { mask } = binarize(g.getImageData(0,0,size,size), 220);
  return { mask, w:size, h:size };
}
function jaccard(a, b) {
  let inter=0, union=0;
  for (let i=0;i<a.length;i++){ inter += (a[i] & b[i]); union += (a[i] | b[i]); }
  return union ? (inter/union) : 0;
}
const GLYPH_CACHE = new Map();
function ensureGlyph(char){
  if (!GLYPH_CACHE.has(char)) GLYPH_CACHE.set(char, renderGlyphMask(char, 192));
  return GLYPH_CACHE.get(char);
}
function candidateChars(scope){
  const FDB = filteredDB();
  if (scope==='lesson' && currentTarget?.lesson!=null){
    const set = new Set();
    for (const it of FDB) if (it.lesson === currentTarget.lesson) set.add(it.char);
    return Array.from(set);
  }
  const set = new Set();
  for (const it of FDB) set.add(it.char);
  return Array.from(set);
}
function recognizeNow(){
  const norm = extractAndNormalize(CTX, 192);
  if (norm.empty){ renderRecog([]); return; }
  const scope = scopeAll?.checked ? 'all' : 'lesson';
  const pool = candidateChars(scope);
  const results = [];
  for (const ch of pool){
    const g = ensureGlyph(ch);
    const score = jaccard(norm.mask, g.mask);
    results.push({ ch, score });
  }
  results.sort((a,b)=>b.score-a.score);
  renderRecog(results.slice(0,5));
}
function renderRecog(items){
  if (!recogList) return;
  recogList.innerHTML = '';
  if (!items.length){
    const li = document.createElement('li');
    li.textContent = '（沒有可顯示的結果，請先在框內書寫）';
    li.style.color = '#64748b';
    recogList.appendChild(li);
    return;
  }
  for (const it of items){
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = it.ch;
    left.style.fontSize = '20px';
    left.style.fontFamily = '"TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif';
    const right = document.createElement('span');
    right.className = 'score';
    right.textContent = `${Math.round(it.score*100)}%`;
    if (currentTarget && it.ch === currentTarget.char){
      li.style.borderColor = '#10b981';
      li.style.background = '#ecfdf5';
    }
    li.appendChild(left); li.appendChild(right);
    recogList.appendChild(li);
  }
}
btnRecognize?.addEventListener('click', recognizeNow);

// ===== 初始化 =====
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
if (traceAlphaVal && traceAlpha) traceAlphaVal.textContent = traceAlpha.value;
nextWord();
