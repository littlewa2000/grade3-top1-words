// app.js — 注音抽題、課次範圍、描紅固定開啟(15%)、畫布書寫

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
const lessonMaxSel = document.getElementById('lessonMax');

// ===== 狀態 =====
let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}
const TRACE_RATIO = 0.72;
const TRACE_ALPHA = 0.15; // 固定 15%

// ===== 載入資料（支援 A 方案 data.js）=====
function pickSourceArray() {
  let raw = window.WORDS || window.DATA || window.G3_TOP1_WORDS || window.words || window.db;
  try { if (!raw && typeof data !== 'undefined') raw = data; } catch(e){}
  if (!raw) { alert('找不到 data.js 的資料陣列'); return []; }

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

// ===== 範圍/出題 =====
function getMaxLesson(){ const v = parseInt(lessonMaxSel?.value || '12',10); return Number.isFinite(v)?v:12; }
function filteredDB(){ const max = getMaxLesson(); return DB.filter(it => it.lesson==null || it.lesson<=max); }
function filteredGroupByZhuyin(){
  const map = {}; for (const it of filteredDB()){ const k=(it.zhuyin||'').trim(); (map[k] ||= []).push(it); } return map;
}
function nextWord(){
  const F = filteredDB();
  if (!F.length){ ZHUYIN_EL.textContent='—'; LESSON_EL.textContent=''; clearCanvas(); return; }
  const G = filteredGroupByZhuyin(), keys = Object.keys(G);
  let item;
  if (keys.length){ const k = keys[Math.floor(Math.random()*keys.length)]; const arr = G[k]; item = arr[Math.floor(Math.random()*arr.length)]; }
  else item = F[Math.floor(Math.random()*F.length)];
  currentTarget = item;
  ZHUYIN_EL.textContent = currentTarget.zhuyin || '—';
  LESSON_EL.textContent = currentTarget.lesson ? `（第${currentTarget.lesson}課）` : '';
  clearCanvas();
}

// ===== 畫布與描紅（固定開啟）=====
function getTraceBox(){
  const w=CANVAS.width, h=CANVAS.height;
  const size = Math.floor(Math.min(w,h)*TRACE_RATIO);
  return { x:Math.floor((w-size)/2), y:Math.floor((h-size)/2), w:size, h:size };
}
function clearCanvas(){
  CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle='#fff'; CTX.fillRect(0,0,CANVAS.width,CANVAS.height);
  drawWritingBoxOutline();
  if (currentTarget) drawTrace(currentTarget.char);
}
function drawWritingBoxOutline(){
  const b=getTraceBox();
  CTX.save(); CTX.strokeStyle='#cbd5e1'; CTX.lineWidth=2; CTX.setLineDash([8,6]); CTX.strokeRect(b.x,b.y,b.w,b.h); CTX.restore();
}
function drawTrace(ch){
  const b=getTraceBox();
  CTX.save();
  CTX.globalAlpha = TRACE_ALPHA; // 固定 15%
  CTX.fillStyle='#000'; CTX.textAlign='center'; CTX.textBaseline='middle';
  CTX.font = `${Math.floor(b.w*0.9)}px "TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif`;
  CTX.fillText(ch, b.x+b.w/2, b.y+b.h/2);
  CTX.restore();
}
function setLineStyle(){ CTX.lineCap='round'; CTX.lineJoin='round'; CTX.strokeStyle=penColor?.value || '#000'; CTX.lineWidth=Number(penSize?.value||10); }
function getPos(e){
  const r=CANVAS.getBoundingClientRect(), sx=CANVAS.width/r.width, sy=CANVAS.height/r.height;
  const x=(e.touches?e.touches[0].clientX:e.clientX) - r.left;
  const y=(e.touches?e.touches[0].clientY:e.clientY) - r.top;
  return {x:x*sx,y:y*sy};
}
CANVAS.addEventListener('pointerdown', e=>{drawing=true; last=getPos(e); setLineStyle();});
CANVAS.addEventListener('pointermove', e=>{
  if(!drawing) return; const p=getPos(e), b=getTraceBox();
  CTX.save(); CTX.beginPath(); CTX.rect(b.x,b.y,b.w,b.h); CTX.clip();
  CTX.beginPath(); CTX.moveTo(last.x,last.y); CTX.lineTo(p.x,p.y); CTX.stroke(); CTX.restore();
  last=p;
});
window.addEventListener('pointerup', ()=>{drawing=false; last=null;});
CANVAS.addEventListener('touchstart', e=>e.preventDefault(), {passive:false});
CANVAS.addEventListener('touchmove', e=>e.preventDefault(), {passive:false});

// ===== 控制綁定 =====
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
penSize?.addEventListener('input', ()=> penSizeVal && (penSizeVal.textContent = penSize.value));
lessonMaxSel?.addEventListener('change', nextWord);

// ===== 初始化 =====
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
nextWord();
