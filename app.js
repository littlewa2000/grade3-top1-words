// app.js — 描紅同框 + 課次範圍 + 改良辨識（對稱 Chamfer + 多字型模板）

// ===== UI 元件 =====
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

// 課程範圍下拉（第 1 課 ～ 第 N 課）
const lessonMaxSel = document.getElementById('lessonMax');

// 辨識工具（存在就啟用）
const btnRecognize = document.getElementById('btnRecognize');
const scopeLesson  = document.getElementById('scopeLesson');
const scopeAll     = document.getElementById('scopeAll');
const recogList    = document.getElementById('recogList');

// ===== 狀態 =====
let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}
const TRACE_RATIO = 0.72; // 描紅/可書寫正方形邊長比例（相對較短邊）

// ===== 描紅/可書寫區的正方形框（置中） =====
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

// ===== 依下拉選單「第 1 課～第 N 課」過濾 =====
function getMaxLesson() {
  const v = parseInt(lessonMaxSel?.value || '12', 10);
  return Number.isFinite(v) ? v : 12;
}
function filteredDB() {
  const max = getMaxLesson();
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

// ===== 出題（依選定範圍） =====
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
  CTX.strokeStyle = '#cbd5e1'; // slate-300
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

// 筆觸
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
lessonMaxSel?.addEventListener('change', () => nextWord());

// ================================
// 改良版辨識器：對稱 Chamfer 距離 + 多字型模板（Top-5）
// ================================
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
  const octx = out.getContext('2d');
  octx.fillStyle='#fff'; octx.fillRect(0,0,size,size);

  if (!box2) return { mask:new Uint8Array(size*size), w:size, h:size, empty:true };

  // 擷取 bbox 縮放置中
  const src = document.createElement('canvas'); src.width=box2.w; src.height=box2.h;
  const sctx = src.getContext('2d');
  const sImg = sctx.createImageData(box2.w, box2.h);
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
  const bin = binarize(oimg, 220);
  return { ...bin, empty:false };
}

// 多字型模板
const TEMPLATE_FONTS = [
  '"TW-Kai","BiauKai","Kaiti TC","DFKai-SB","Kai","Noto Serif TC",serif', // 楷體系
  '"PMingLiU","Songti TC","Noto Serif TC",serif',                          // 明體系
  '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif'           // 黑體系
];
function renderGlyphMaskWithFont(ch, fontStack, size=192) {
  const c = document.createElement('canvas');
  c.width=size; c.height=size;
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle';
  g.font = `${Math.floor(size*0.9)}px ${fontStack}`;
  g.fillText(ch, size/2, size/2);
  const { mask } = binarize(g.getImageData(0,0,size,size), 220);
  return { mask, w:size, h:size };
}

// 距離轉換（City-block 雙向兩趟）
function distanceTransform(mask, w, h) {
  const INF = 1e9;
  const dist = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) dist[i] = mask[i] ? 0 : INF;

  // forward
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i = y*w + x;
    if (x>0)   dist[i] = Math.min(dist[i], dist[i-1] + 1);
    if (y>0)   dist[i] = Math.min(dist[i], dist[i-w] + 1);
    if (x>0&&y>0) dist[i] = Math.min(dist[i], dist[i-w-1] + 2);
    if (x<w-1&&y>0) dist[i] = Math.min(dist[i], dist[i-w+1] + 2);
  }
  // backward
  for (let y=h-1;y>=0;y--) for (let x=w-1;x>=0;x--) {
    const i = y*w + x;
    if (x<w-1)   dist[i] = Math.min(dist[i], dist[i+1] + 1);
    if (y<h-1)   dist[i] = Math.min(dist[i], dist[i+w] + 1);
    if (x<w-1&&y<h-1) dist[i] = Math.min(dist[i], dist[i+w+1] + 2);
    if (x>0&&y<h-1)   dist[i] = Math.min(dist[i], dist[i+w-1] + 2);
  }
  return dist;
}

// 對稱 Chamfer + 小比例 Jaccard
function chamferSimilarity(userMask, tmplMask, dtUser, dtTmpl) {
  const n = userMask.length;
  let sumUT = 0, cntU = 0;
  let sumTU = 0, cntT = 0;
  for (let i=0;i<n;i++) {
    if (userMask[i]) { sumUT += dtTmpl[i]; cntU++; }
    if (tmplMask[i]) { sumTU += dtUser[i]; cntT++; }
  }
  if (!cntU && !cntT) return 0;
  const avg = ( (cntU?sumUT/cntU:0) + (cntT?sumTU/cntT:0) ) / 2;
  const MAX_D = 40; // 正規化上限（可微調）
  return Math.max(0, 1 - (avg / MAX_D));
}
function jaccard(maskA, maskB) {
  let inter=0, union=0;
  for (let i=0;i<maskA.length;i++){ inter += (maskA[i] & maskB[i]); union += (maskA[i] | maskB[i]); }
  return union ? (inter/union) : 0;
}

// 模板快取：每字 x 每字型
const GLYPH_CACHE = new Map(); // key = char+'\n'+fontIndex -> {mask, dt, w, h}
function ensureGlyph(char, fontIndex=0) {
  const key = `${char}\n${fontIndex}`;
  if (!GLYPH_CACHE.has(key)) {
    const g = renderGlyphMaskWithFont(char, TEMPLATE_FONTS[fontIndex], 192);
    const dt = distanceTransform(g.mask, g.w, g.h);
    GLYPH_CACHE.set(key, { ...g, dt });
  }
  return GLYPH_CACHE.get(key);
}

// 候選字（依範圍 + 是否只比對本課）
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

// 主辨識：多字型取最佳分數，取 Top-5
function recognizeNow(){
  const norm = extractAndNormalize(CTX, 192);
  if (norm.empty){ renderRecog([]); return; }

  const dtUser = distanceTransform(norm.mask, norm.w, norm.h);
  const scope = scopeAll?.checked ? 'all' : 'lesson';
  const pool = candidateChars(scope);

  const results = [];
  for (const ch of pool){
    let best = -1;
    for (let f=0; f<TEMPLATE_FONTS.length; f++){
      const tmpl = ensureGlyph(ch, f);
      const simChamfer = chamferSimilarity(norm.mask, tmpl.mask, dtUser, tmpl.dt);
      const simJ = jaccard(norm.mask, tmpl.mask);
      const score = 0.85 * simChamfer + 0.15 * simJ; // 權重可微調
      if (score > best) best = score;
    }
    results.push({ ch, score: best });
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
