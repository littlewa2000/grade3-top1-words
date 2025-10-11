// app.js — 描紅 + 手寫辨識（Top-5）

// ===== UI =====
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

const btnRecognize = document.getElementById('btnRecognize');
const scopeLesson  = document.getElementById('scopeLesson');
const scopeAll     = document.getElementById('scopeAll');
const recogList    = document.getElementById('recogList');

let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}

// ===== Data load (keeps lesson; supports multiple key names / const data) =====
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

// Group by zhuyin; also collect unique chars per lesson/all
const GROUP_BY_ZHUYIN = {};
const UNIQUE_ALL = new Map(); // char -> Set(lessons)
for (const it of DB) {
  const key = (it.zhuyin || '').trim();
  (GROUP_BY_ZHUYIN[key] ||= []).push(it);
  if (!UNIQUE_ALL.has(it.char)) UNIQUE_ALL.set(it.char, new Set());
  if (it.lesson != null) UNIQUE_ALL.get(it.char).add(it.lesson);
}
const ALL_KEYS = Object.keys(GROUP_BY_ZHUYIN);

// ===== Question picking =====
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
  clearCanvas();
  renderRecog([]); // clear results
}

// ===== Canvas & tracing =====
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
  const r = CANVAS.getBoundingClientRect();
  const sx = CANVAS.width / r.width, sy = CANVAS.height / r.height;
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
  return { x: x * sx, y: y * sy };
}
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

// Pointer events
CANVAS.addEventListener('pointerdown', (e)=>{ drawing=true; last=getPos(e); setLineStyle(); });
CANVAS.addEventListener('pointermove', (e)=>{
  if (!drawing) return;
  const p = getPos(e);
  CTX.beginPath(); CTX.moveTo(last.x, last.y); CTX.lineTo(p.x, p.y); CTX.stroke();
  last = p;
});
window.addEventListener('pointerup', ()=>{ drawing=false; last=null; });
CANVAS.addEventListener('touchstart',(e)=>e.preventDefault(),{passive:false});
CANVAS.addEventListener('touchmove',(e)=>e.preventDefault(),{passive:false});

btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
penSize?.addEventListener('input', ()=>{ if (penSizeVal) penSizeVal.textContent = penSize.value; });
cbTrace?.addEventListener('change', clearCanvas);
traceAlpha?.addEventListener('input', ()=>{
  if (traceAlphaVal) traceAlphaVal.textContent = traceAlpha.value;
  if (cbTrace?.checked) clearCanvas();
});

// ===== Handwriting recognition (template matching, no ML) =====
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
  let minx=w, miny=h, maxx=-1, maxy=-1, area=0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    if (mask[y*w+x]){ area++; if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
  }
  if (!area) return null;
  return { x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1,area };
}
function extractAndNormalize(ctx, size=192) {
  const img = ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height);
  const { mask, width, height } = binarize(img, 220);
  const box = getBBox(mask, width, height);
  const out = document.createElement('canvas');
  out.width=size; out.height=size;
  const octx = out.getContext('2d');
  octx.fillStyle='#fff'; octx.fillRect(0,0,size,size);

  if (!box) return { mask:new Uint8Array(size*size), w:size, h:size, empty:true };

  // copy bbox to src canvas
  const src = document.createElement('canvas');
  src.width=box.w; src.height=box.h;
  const sctx = src.getContext('2d');
  const sImg = sctx.createImageData(box.w, box.h);
  for (let y=0;y<box.h;y++) for (let x=0;x<box.w;x++){
    const on = mask[(box.y+y)*width + (box.x+x)] ? 0 : 255;
    const idx=(y*box.w+x)*4; sImg.data[idx]=on; sImg.data[idx+1]=on; sImg.data[idx+2]=on; sImg.data[idx+3]=255;
  }
  sctx.putImageData(sImg,0,0);

  const scale = 0.86 * Math.min(size/box.w, size/box.h);
  const renderW = Math.max(1, Math.round(box.w*scale));
  const renderH = Math.max(1, Math.round(box.h*scale));
  const dx=Math.round((size-renderW)/2), dy=Math.round((size-renderH)/2);
  octx.imageSmoothingEnabled=false;
  octx.drawImage(src,0,0,box.w,box.h,dx,dy,renderW,renderH);

  const oimg=octx.getImageData(0,0,size,size);
  return { ...binarize(oimg, 220), empty:false };
}
function renderGlyphMask(ch, size=192) {
  const c = document.createElement('canvas');
  c.width=size; c.height=size;
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle';
  g.font = `${Math.floor(size*0.72)}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  g.fillText(ch, size/2, size/2);
  const { mask } = binarize(g.getImageData(0,0,size,size), 220);
  return { mask, w:size, h:size };
}
function jaccard(a, b) {
  let inter=0, union=0;
  for (let i=0;i<a.length;i++){ const av=a[i], bv=b[i]; inter += (av & bv); union += (av | bv); }
  return union ? (inter/union) : 0;
}

// Precompute glyph masks for all unique chars (speed!)
const GLYPH_CACHE = new Map(); // char -> {mask,w,h}
function ensureGlyph(char){
  if (!GLYPH_CACHE.has(char)){
    GLYPH_CACHE.set(char, renderGlyphMask(char, 192));
  }
  return GLYPH_CACHE.get(char);
}

function candidateChars(scope){
  if (scope==='lesson' && currentTarget?.lesson!=null){
    // all chars that appear in the same lesson number
    const l = currentTarget.lesson;
    const set = new Set();
    for (const it of DB) if (it.lesson===l) set.add(it.char);
    return Array.from(set);
  }
  // all unique chars
  return Array.from(UNIQUE_ALL.keys());
}

function recognizeNow(){
  // normalize user drawing
  const norm = extractAndNormalize(CTX, 192);
  if (norm.empty){ renderRecog([]); return; }

  const scope = scopeAll?.checked ? 'all' : 'lesson';
  const pool = candidateChars(scope);

  // score each candidate
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
    li.textContent = '（沒有可顯示的結果，請在畫布上先寫字）';
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

    li.appendChild(left);
    li.appendChild(right);
    recogList.appendChild(li);
  }
}

// Hook up button
btnRecognize?.addEventListener('click', recognizeNow);

// ===== Init =====
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
if (traceAlphaVal && traceAlpha) traceAlphaVal.textContent = traceAlpha.value;
nextWord();
