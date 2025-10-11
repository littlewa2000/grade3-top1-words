// app.js — 手機級手寫體驗：TF.js 小模型 + 注音重排 + 備援（Chamfer）

// ====== UI 元件 ======
const ZHUYIN_EL    = document.getElementById('zhuyin');
const LESSON_EL    = document.getElementById('lessonInfo');
const CANVAS       = document.getElementById('pad');
const CTX          = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext      = document.getElementById('btnNext');
const btnClear     = document.getElementById('btnClear');
const penSize      = document.getElementById('penSize');
const penSizeVal   = document.getElementById('penSizeVal');
const penColor     = document.getElementById('penColor');

const cbTrace      = document.getElementById('cbTrace');
const traceAlpha   = document.getElementById('traceAlpha');
const traceAlphaVal= document.getElementById('traceAlphaVal');

const lessonMaxSel = document.getElementById('lessonMax');

const btnRecognize = document.getElementById('btnRecognize');
const scopeLesson  = document.getElementById('scopeLesson');
const scopeAll     = document.getElementById('scopeAll');
const recogList    = document.getElementById('recogList');

// ====== 狀態 ======
let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}
const TRACE_RATIO = 0.72;

// ====== 模型設定（你要上傳的檔案路徑；沒檔案就自動 fallback）======
const MODEL_URL  = './model/model.json';   // TF.js GraphModel or LayersModel
const LABELS_URL = './model/labels.json';  // ["字","字",...，順序須對應模型輸出]
const INPUT_SIZE = 64;                     // 你的模型輸入尺寸（64 或 96 皆可）
const USE_SOFTMAX_TEMPERATURE = 1.0;       // 可微調分佈平滑
const ZHUYIN_BOOST = 0.25;                 // 注音符合的加權（0.0~0.5 建議）

let tfModel = null;
let labels = null;                         // 模型標籤（字表，順序要與模型吻合）
let labelIndex = new Map();                // char -> index

// ====== 描紅/可書寫框 ======
function getTraceBox() {
  const w = CANVAS.width, h = CANVAS.height;
  const size = Math.floor(Math.min(w, h) * TRACE_RATIO);
  const x = Math.floor((w - size) / 2);
  const y = Math.floor((h - size) / 2);
  return { x, y, w: size, h: size };
}

// ====== 載入 data.js（支援 A 方案 / 多鍵名）======
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

// 範圍過濾（第 1 課～第 N 課）
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

// ====== 出題 ======
function nextWord() {
  const FDB = filteredDB();
  if (!FDB.length) {
    if (ZHUYIN_EL) ZHUYIN_EL.textContent = '—';
    if (LESSON_EL) LESSON_EL.textContent = '';
    clearCanvas(); renderRecog([]); return;
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
  clearCanvas(); renderRecog([]);
}

// ====== 畫布/描紅 ======
function clearCanvas() {
  CTX.save(); CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle = '#ffffff'; CTX.fillRect(0,0,CANVAS.width,CANVAS.height);
  CTX.restore();
  drawWritingBoxOutline();
  if (cbTrace?.checked && currentTarget) drawTrace(currentTarget.char);
}
function drawWritingBoxOutline() {
  const box = getTraceBox();
  CTX.save();
  CTX.strokeStyle = '#cbd5e1'; CTX.lineWidth = 2; CTX.setLineDash([8, 6]);
  CTX.strokeRect(box.x, box.y, box.w, box.h);
  CTX.restore();
}
function drawTrace(char) {
  const box = getTraceBox();
  const alpha = traceAlpha ? Math.max(0.05, Math.min(0.6, Number(traceAlpha.value)/100)) : 0.12;
  CTX.save();
  CTX.globalAlpha = alpha; CTX.fillStyle = '#000';
  CTX.textAlign = 'center'; CTX.textBaseline = 'middle';
  CTX.font = `${Math.floor(box.w*0.9)}px "TW-Kai","BiauKai","Kai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC", serif`;
  CTX.fillText(char, box.x + box.w/2, box.y + box.h/2);
  CTX.restore();
}
function setLineStyle() {
  CTX.lineCap='round'; CTX.lineJoin='round';
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
CANVAS.addEventListener('pointerdown', (e)=>{ drawing=true; last=getPos(e); setLineStyle(); });
CANVAS.addEventListener('pointermove', (e)=>{
  if (!drawing) return;
  const p = getPos(e);
  const box = getTraceBox();
  CTX.save(); CTX.beginPath(); CTX.rect(box.x, box.y, box.w, box.h); CTX.clip();
  CTX.beginPath(); CTX.moveTo(last.x,last.y); CTX.lineTo(p.x,p.y); CTX.stroke();
  CTX.restore(); last = p;
});
window.addEventListener('pointerup', ()=>{ drawing=false; last=null; });
CANVAS.addEventListener('touchstart',(e)=>e.preventDefault(),{passive:false});
CANVAS.addEventListener('touchmove',(e)=>e.preventDefault(),{passive:false});

// ====== 控制 ======
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
penSize?.addEventListener('input', ()=>{ if (penSizeVal) penSizeVal.textContent = penSize.value; });
cbTrace?.addEventListener('change', clearCanvas);
traceAlpha?.addEventListener('input', ()=>{
  if (traceAlphaVal) traceAlphaVal.textContent = traceAlpha.value;
  if (cbTrace?.checked) clearCanvas();
});
lessonMaxSel?.addEventListener('change', nextWord);

// ====== 共同的影像前處理 ======
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
function getUserCropCanvas(size=INPUT_SIZE) {
  // 取框內畫面，二值化、擷取 BBox、等比縮放置中至 size×size
  const box = getTraceBox();
  const img = CTX.getImageData(box.x, box.y, box.w, box.h);
  const { mask, width, height } = binarize(img, 220);
  const bb = getBBox(mask, width, height);

  const out = document.createElement('canvas'); out.width=size; out.height=size;
  const octx = out.getContext('2d');
  octx.fillStyle='#fff'; octx.fillRect(0,0,size,size);

  if (!bb) return out; // 空白就回傳白圖

  const src = document.createElement('canvas'); src.width=bb.w; src.height=bb.h;
  const sctx = src.getContext('2d');
  const sImg = sctx.createImageData(bb.w, bb.h);
  for (let y=0;y<bb.h;y++) for (let x=0;x<bb.w;x++){
    const on = mask[(bb.y+y)*width + (bb.x+x)] ? 0 : 255;
    const idx=(y*bb.w+x)*4; sImg.data[idx]=on; sImg.data[idx+1]=on; sImg.data[idx+2]=on; sImg.data[idx+3]=255;
  }
  sctx.putImageData(sImg,0,0);

  const scale = 0.9 * Math.min(size/bb.w, size/bb.h);
  const rw = Math.max(1, Math.round(bb.w*scale));
  const rh = Math.max(1, Math.round(bb.h*scale));
  const dx = Math.round((size-rw)/2), dy = Math.round((size-rh)/2);
  octx.imageSmoothingEnabled=false;
  octx.drawImage(src,0,0,bb.w,bb.h,dx,dy,rw,rh);

  return out;
}

// ====== TF.js 模型載入（可離線，放 GitHub Pages）======
async function tryLoadModel() {
  if (!window.tf) return; // 沒有 tf.js（例如網路被阻擋）就算了
  try {
    tfModel = await tf.loadLayersModel(MODEL_URL); // 若你匯出的是 GraphModel，可改 loadGraphModel
  } catch (e) {
    console.warn('TF.js model not found/failed, fallback to classic recognizer.', e);
    tfModel = null;
  }
  try {
    const res = await fetch(LABELS_URL);
    if (res.ok) {
      labels = await res.json();
      labelIndex = new Map(labels.map((ch,i)=>[ch,i]));
    }
  } catch (e) {
    console.warn('labels.json missing; model outputs cannot be mapped.', e);
    labels = null;
    labelIndex = new Map();
  }
}
tryLoadModel();

// ====== 傳統（Chamfer）備援需要的模板（簡化版）======
const TEMPLATE_FONTS = [
  '"TW-Kai","BiauKai","Kaiti TC","DFKai-SB","Kai","Noto Serif TC",serif',
  '"PMingLiU","Songti TC","Noto Serif TC",serif',
  '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif'
];
const GLYPH_CACHE = new Map();
function renderGlyphMaskWithFont(ch, fontStack, size=INPUT_SIZE) {
  const c = document.createElement('canvas'); c.width=size; c.height=size;
  const g = c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle';
  g.font = `${Math.floor(size*0.9)}px ${fontStack}`;
  g.fillText(ch, size/2, size/2);
  const img = g.getImageData(0,0,size,size);
  return binarize(img, 220).mask;
}
function distanceTransform(mask, w, h) {
  const INF = 1e9; const dist = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) dist[i] = mask[i] ? 0 : INF;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const i=y*w+x;
    if (x>0) dist[i]=Math.min(dist[i],dist[i-1]+1);
    if (y>0) dist[i]=Math.min(dist[i],dist[i-w]+1);
    if (x>0&&y>0) dist[i]=Math.min(dist[i],dist[i-w-1]+2);
    if (x<w-1&&y>0) dist[i]=Math.min(dist[i],dist[i-w+1]+2);
  }
  for (let y=h-1;y>=0;y--) for (let x=w-1;x>=0;x--){
    const i=y*w+x;
    if (x<w-1) dist[i]=Math.min(dist[i],dist[i+1]+1);
    if (y<h-1) dist[i]=Math.min(dist[i],dist[i+w]+1);
    if (x<w-1&&y<h-1) dist[i]=Math.min(dist[i],dist[i+w+1]+2);
    if (x>0&&y<h-1) dist[i]=Math.min(dist[i],dist[i+w-1]+2);
  }
  return dist;
}
function chamferSimilarity(userMask, tmplMask, dtUser, dtTmpl) {
  const n=userMask.length; let su=0,cu=0, st=0,ct=0;
  for (let i=0;i<n;i++){ if (userMask[i]){su+=dtTmpl[i];cu++;} if (tmplMask[i]){st+=dtUser[i];ct++;} }
  if (!cu && !ct) return 0;
  const avg=((cu?su/cu:0)+(ct?st/ct:0))/2;
  const MAX_D=40; const sim=1-(avg/MAX_D);
  return Number.isFinite(sim)? Math.max(0,Math.min(1,sim)) : 0;
}
function jaccard(maskA, maskB) {
  let inter=0, union=0;
  for (let i=0;i<maskA.length;i++){ inter+=(maskA[i]&maskB[i]); union+=(maskA[i]|maskB[i]); }
  return union? inter/union : 0;
}
function ensureGlyph(char, fontIndex=0) {
  const key = `${char}\n${fontIndex}`;
  if (!GLYPH_CACHE.has(key)) {
    const mask = renderGlyphMaskWithFont(char, TEMPLATE_FONTS[fontIndex], INPUT_SIZE);
    const dt   = distanceTransform(mask, INPUT_SIZE, INPUT_SIZE);
    GLYPH_CACHE.set(key, { mask, dt });
  }
  return GLYPH_CACHE.get(key);
}

// ====== 候選集（依範圍＋是否只比對本課）======
function candidateChars(scope){
  const FDB = filteredDB();
  if (scope==='lesson' && currentTarget?.lesson!=null){
    const set = new Set(); for (const it of FDB) if (it.lesson===currentTarget.lesson) set.add(it.char);
    return Array.from(set);
  }
  const set = new Set(); for (const it of FDB) set.add(it.char);
  return Array.from(set);
}

// ====== TF.js 推論（首選）======
function tensorFromCanvas(c) {
  // c: size×size canvas，白底黑字 -> 正規化到 [0,1]（黑=1，白=0 或反之取決於訓練）
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0,0,c.width,c.height).data;
  const arr = new Float32Array(c.width*c.height);
  for (let i=0, p=0; i<img.length; i+=4, p++){
    const v = (img[i]+img[i+1]+img[i+2])/3; // 0~255
    arr[p] = (255 - v) / 255;               // 黑筆劃=1，白底=0
  }
  return tf.tensor4d(arr, [1, c.height, c.width, 1]); // NHWC
}

function zhuyinOfChar(ch) {
  // 從 DB 找該字的注音（若同字多音，任一個相符就加權）
  const list = DB.filter(it => it.char === ch).map(it => it.zhuyin);
  return new Set(list);
}

function rerankByZhuyin(probs, idx2char, targetZhuyin) {
  if (!targetZhuyin) return probs;
  const boosted = probs.slice();
  for (let i=0;i<boosted.length;i++){
    const ch = idx2char[i];
    const zs = zhuyinOfChar(ch);
    if (zs.has(targetZhuyin)) {
      boosted[i] = Math.min(1, boosted[i] * (1 + ZHUYIN_BOOST)); // 乘法加權
    }
  }
  // 重新 normalize
  const sum = boosted.reduce((a,b)=>a+b, 0) || 1;
  for (let i=0;i<boosted.length;i++) boosted[i] /= sum;
  return boosted;
}

async function predictTFJS() {
  if (!tfModel || !labels || !labels.length) return null;

  const crop = getUserCropCanvas(INPUT_SIZE);
  const x = tensorFromCanvas(crop);

  let y = tf.tidy(()=>{
    let logits = tfModel.predict(x); // [1,num_classes]
    if (Array.isArray(logits)) logits = logits[0];
    if (USE_SOFTMAX_TEMPERATURE !== 1.0) {
      logits = tf.div(logits, USE_SOFTMAX_TEMPERATURE);
    }
    return tf.softmax(logits);
  });
  const probs = Array.from(await y.data());
  y.dispose(); x.dispose();

  // 限定候選於「範圍內」：不在 labels / 或不在所選課數的候選可以直接保留，因為模型輸出固定 labels
  const idx2char = labels;

  // 注音重排（若有目標注音）
  const targetZ = currentTarget?.zhuyin || null;
  const probs2 = rerankByZhuyin(probs, idx2char, targetZ);

  // 取 Top-5
  const idxs = probs2.map((p,i)=>[i,p]).sort((a,b)=>b[1]-a[1]).slice(0,5).map(v=>v[0]);
  return idxs.map(i=>({ ch: idx2char[i], score: probs2[i] }));
}

// ====== 備援辨識（Chamfer + 多字型）======
function recognizeFallback() {
  const crop = getUserCropCanvas(INPUT_SIZE);
  const gctx = crop.getContext('2d');
  const maskUser = binarize(gctx.getImageData(0,0,crop.width,crop.height), 220).mask;
  const dtUser   = distanceTransform(maskUser, INPUT_SIZE, INPUT_SIZE);

  const scope = scopeAll?.checked ? 'all' : 'lesson';
  const pool = candidateChars(scope);
  if (!pool.length) return [];

  const results = [];
  for (const ch of pool){
    let best = 0;
    for (let f=0; f<TEMPLATE_FONTS.length; f++){
      const { mask:maskT, dt:dtT } = ensureGlyph(ch, f);
      const simC = chamferSimilarity(maskUser, maskT, dtUser, dtT);
      const simJ = jaccard(maskUser, maskT);
      const score = 0.85*simC + 0.15*simJ;
      if (score > best) best = score;
    }
    results.push({ ch, score: best });
  }
  results.sort((a,b)=>b.score-a.score);
  return results.slice(0,5);
}

// ====== 封裝辨識按鈕 ======
async function recognizeNow() {
  // 先試 TF.js（若成功載入）
  let items = null;
  try {
    items = await predictTFJS();
  } catch (e) {
    console.warn('TFJS predict failed, fallback...', e);
    items = null;
  }
  if (!items || !items.length) {
    items = recognizeFallback();
  }
  renderRecog(items);
}

function renderRecog(items){
  if (!recogList) return;
  recogList.innerHTML = '';
  if (!items || !items.length){
    const li = document.createElement('li');
    li.textContent = '（沒有結果，請先在框內書寫，或上傳模型到 /model/）';
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
    const pct = Math.round(Math.max(0, Math.min(1, it.score || 0))*100);
    right.textContent = `${pct}%`;
    if (currentTarget && it.ch === currentTarget.char){
      li.style.borderColor = '#10b981';
      li.style.background = '#ecfdf5';
    }
    li.appendChild(left); li.appendChild(right);
    recogList.appendChild(li);
  }
}
btnRecognize?.addEventListener('click', recognizeNow);

// ====== 初始化 ======
if (penSizeVal && penSize) penSizeVal.textContent = penSize.value;
if (traceAlphaVal && traceAlpha) traceAlphaVal.textContent = traceAlpha.value;
nextWord();
