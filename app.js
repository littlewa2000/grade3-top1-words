// app.js — 非深度學習手寫辨識（邊緣+方向Chamfer+Jaccard+平移搜尋）
// 需求：筆粗固定 20px、描紅固定 15%、依課次範圍抽題；候選集=同注音(範圍內)，無則全字表

// ===== UI =====
const ZHUYIN_EL  = document.getElementById('zhuyin');
const LESSON_EL  = document.getElementById('lessonInfo');
const CANVAS     = document.getElementById('pad');
const CTX        = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext    = document.getElementById('btnNext');
const btnClear   = document.getElementById('btnClear');
const penColor   = document.getElementById('penColor');
const lessonMaxSel = document.getElementById('lessonMax');

const btnRecognize = document.getElementById('btnRecognize');
const recogList    = document.getElementById('recogList');

// ===== 狀態/參數 =====
let drawing = false;
let last = null;
let currentTarget = null; // {char, zhuyin, lesson}
const TRACE_RATIO = 0.72;
const TRACE_ALPHA = 0.15;  // 描紅固定 15%
const INPUT_SIZE  = 160;   // 標準化尺寸
const BIN_THR     = 160;   // 二值化門檻：排除 15% 灰描紅 (~217)

// 平移搜尋（像素）
const OFFSETS = [
  {dx:0,dy:0},
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},
  {dx:2,dy:0},{dx:-2,dy:0},{dx:0,dy:2},{dx:0,dy:-2},
  {dx:3,dy:0},{dx:-3,dy:0},{dx:0,dy:3},{dx:0,dy:-3},
  {dx:2,dy:1},{dx:2,dy:-1},{dx:-2,dy:1},{dx:-2,dy:-1},
  {dx:1,dy:2},{dx:1,dy:-2},{dx:-1,dy:2},{dx:-1,dy:-2}
];

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
      } else pushMaybe(item, item.lesson ?? item.lsn ?? item.lessonNo ?? null);
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
  if (!F.length){ ZHUYIN_EL.textContent='—'; LESSON_EL.textContent=''; clearCanvas(); renderRecog([]); return; }
  const G = filteredGroupByZhuyin(), keys = Object.keys(G);
  let item;
  if (keys.length){ const k = keys[Math.floor(Math.random()*keys.length)]; const arr = G[k]; item = arr[Math.floor(Math.random()*arr.length)]; }
  else item = F[Math.floor(Math.random()*F.length)];
  currentTarget = item;
  ZHUYIN_EL.textContent = currentTarget.zhuyin || '—';
  LESSON_EL.textContent = currentTarget.lesson ? `（第${currentTarget.lesson}課）` : '';
  clearCanvas(); renderRecog([]);
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
function setLineStyle(){
  CTX.lineCap='round';
  CTX.lineJoin='round';
  CTX.strokeStyle = penColor?.value || '#000';
  CTX.lineWidth = 20; // 固定 20px
}
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

// ===== 影像處理：保留使用者「筆畫輪廓」，排除描紅 =====
function binarize(imgData, thresh = BIN_THR){
  const {data,width,height}=imgData; const mask=new Uint8Array(width*height);
  for(let i=0;i<data.length;i+=4){
    const v=(data[i]+data[i+1]+data[i+2])/3;
    mask[i>>2] = v < thresh ? 1 : 0; // 只吃很黑的像素
  }
  return {mask,width,height};
}
function getBBox(mask,w,h){
  let minx=w,miny=h,maxx=-1,maxy=-1,area=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    if(mask[y*w+x]){ area++; if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
  }
  if(!area) return null;
  return {x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1,area};
}
// 從填色 mask 取 1px 輪廓
function edgeFromMask(mask,w,h){
  const edge=new Uint8Array(w*h);
  const val=(x,y)=> (x>=0&&x<w&&y>=0&&y<h) ? mask[y*w+x] : 0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    if(!val(x,y)) continue;
    if(x===0||y===0||x===w-1||y===h-1 || !val(x-1,y)||!val(x+1,y)||!val(x,y-1)||!val(x,y+1)){
      edge[y*w+x]=1;
    }
  }
  return edge;
}
function extractAndNormalize(ctx,size=INPUT_SIZE){
  const b=getTraceBox();
  const img=ctx.getImageData(b.x,b.y,b.w,b.h);
  const bin=binarize(img);                 // 低門檻，排除描紅
  const bb=getBBox(bin.mask,bin.width,bin.height);

  const out=document.createElement('canvas'); out.width=size; out.height=size;
  const octx=out.getContext('2d'); octx.fillStyle='#fff'; octx.fillRect(0,0,size,size);
  if(!bb) return {canvas:out, mask:new Uint8Array(size*size), empty:true};

  // 摘出 bbox → 置中縮放
  const src=document.createElement('canvas'); src.width=bb.w; src.height=bb.h;
  const sctx=src.getContext('2d'); const sImg=sctx.createImageData(bb.w,bb.h);
  for(let y=0;y<bb.h;y++) for(let x=0;x<bb.w;x++){
    const on=bin.mask[(bb.y+y)*bin.width + (bb.x+x)] ? 0 : 255;
    const idx=(y*bb.w+x)*4; sImg.data[idx]=on; sImg.data[idx+1]=on; sImg.data[idx+2]=on; sImg.data[idx+3]=255;
  }
  sctx.putImageData(sImg,0,0);
  const scale=0.90*Math.min(size/bb.w, size/bb.h);
  const rw=Math.max(1,Math.round(bb.w*scale));
  const rh=Math.max(1,Math.round(bb.h*scale));
  const dx=Math.round((size-rw)/2), dy=Math.round((size-rh)/2);
  octx.imageSmoothingEnabled=false; octx.drawImage(src,0,0,bb.w,bb.h,dx,dy,rw,rh);

  // 重新取 mask（標準尺寸）
  const oimg=octx.getImageData(0,0,size,size);
  const done=binarize(oimg);
  return {canvas:out, mask:done.mask, empty:false};
}
// Sobel 方向（8-bin），對邊緣圖計算
function sobelDir(mask, w, h){
  const dir=new Uint8Array(w*h);
  const edge=edgeFromMask(mask,w,h);
  const val = (x,y)=> edge[y*w+x] ? 1 : 0;
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
    const gx = -val(x-1,y-1)-2*val(x-1,y)+-val(x-1,y+1) + val(x+1,y-1)+2*val(x+1,y)+val(x+1,y+1);
    const gy = -val(x-1,y-1)-2*val(x,y-1)-val(x+1,y-1) + val(x-1,y+1)+2*val(x,y+1)+val(x+1,y+1);
    const ang = Math.atan2(gy, gx);
    let bin = Math.round(((ang + Math.PI) / (2*Math.PI)) * 8) % 8;
    dir[y*w+x] = bin;
  }
  return {dir, edge};
}
// 距離轉換（Chamfer）對邊緣圖做
function distanceTransform(mask,w,h){
  const INF=1e9, dist=new Float32Array(w*h);
  const edge=edgeFromMask(mask,w,h);
  for(let i=0;i<w*h;i++) dist[i] = edge[i] ? 0 : INF;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=y*w+x;
    if(x>0) dist[i]=Math.min(dist[i], dist[i-1]+1);
    if(y>0) dist[i]=Math.min(dist[i], dist[i-w]+1);
    if(x>0&&y>0) dist[i]=Math.min(dist[i], dist[i-w-1]+2);
    if(x<w-1&&y>0) dist[i]=Math.min(dist[i], dist[i-w+1]+2);
  }
  for(let y=h-1;y>=0;y--) for(let x=w-1;x>=0;x--){
    const i=y*w+x;
    if(x<w-1) dist[i]=Math.min(dist[i], dist[i+1]+1);
    if(y<h-1) dist[i]=Math.min(dist[i], dist[i+w]+1);
    if(x<w-1&&y<h-1) dist[i]=Math.min(dist[i], dist[i+w+1]+2);
    if(x>0&&y<h-1) dist[i]=Math.min(dist[i], dist[i+w-1]+2);
  }
  return dist;
}
function jaccard(a,b){
  let inter=0,uni=0; for(let i=0;i<a.length;i++){ inter+=(a[i]&b[i]); uni+=(a[i]|b[i]); }
  return uni? inter/uni : 0;
}

// ===== 模板（多字型 × 輕擾動）→ 產生「邊緣模板」=====
const TEMPLATE_FONTS = [
  '"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif',
  '"PMingLiU","Songti TC","Noto Serif TC",serif',
  '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif'
];
const VARIANTS = [
  { rot: 0,   scale: 1.00 },
  { rot: -6,  scale: 0.98 },
  { rot: +6,  scale: 0.98 },
  { rot: -3,  scale: 1.02 },
  { rot: +3,  scale: 1.02 }
];

function renderCharVariant(ch, font, size=INPUT_SIZE, rotDeg=0, scale=1.0){
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.save();
  g.translate(size/2, size/2);
  g.rotate(rotDeg*Math.PI/180);
  g.scale(scale, scale);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle';
  g.font = `${Math.floor(size*0.9)}px ${font}`;
  g.fillText(ch, 0, 0);
  g.restore();

  const img=g.getImageData(0,0,size,size);
  const bin=binarize(img);                    // → 填色 mask
  return edgeFromMask(bin.mask, size, size);  // → 邊緣模板
}

const GLYPH_CACHE = new Map(); // key: `${ch}|${f}|${v}` => {edge, dir, dt}
function ensureGlyph(char, f, v){
  const key=`${char}|${f}|${v}`;
  if(!GLYPH_CACHE.has(key)){
    const edge = renderCharVariant(char, TEMPLATE_FONTS[f], INPUT_SIZE, VARIANTS[v].rot, VARIANTS[v].scale);
    const {dir} = sobelDir(edge, INPUT_SIZE, INPUT_SIZE);
    const dt  = distanceTransform(edge, INPUT_SIZE, INPUT_SIZE);
    GLYPH_CACHE.set(key, {edge, dir, dt});
  }
  return GLYPH_CACHE.get(key);
}

// 方向感知對稱 Chamfer（支援平移搜尋）
function chamferDirectionalShifted(userEdge, userDir, tmplDT, tmplEdge, tmplDir, userDT, w, h, dx, dy){
  let su=0,cu=0, st=0,ct=0;

  // user -> templateDT（模板位移 dx,dy）
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i = y*w+x;
      if(!userEdge[i]) continue;
      const xx = x+dx, yy = y+dy;
      if(xx<0||yy<0||xx>=w||yy>=h) continue;
      const j = yy*w+xx;
      let d = Math.abs(userDir[i] - tmplDir[j]); if (d>4) d = 8 - d;
      if(d<=1){ su += tmplDT[j]; cu++; }
    }
  }

  // template -> userDT（對稱；相對位移 -dx,-dy）
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const j = y*w+x;
      if(!tmplEdge[j]) continue;
      const xx = x-dx, yy = y-dy;
      if(xx<0||yy<0||xx>=w||yy>=h) continue;
      const i = yy*w+xx;
      let d = Math.abs(tmplDir[j] - userDir[i]); if (d>4) d = 8 - d;
      if(d<=1){ st += userDT[i]; ct++; }
    }
  }

  if(!cu && !ct) return 0;
  const avg=((cu?su/cu:0) + (ct?st/ct:0))/2;
  const MAX_D = 36;               // 與 INPUT_SIZE/筆粗/擾動相關的常數
  const sim = 1 - (avg / MAX_D);  // 距離越小分數越高
  return Math.max(0, Math.min(1, Number.isFinite(sim)?sim:0));
}

// 候選字：優先「同注音 + 範圍內」；若無才退回全部
function candidateChars(){
  const F = filteredDB();
  const targetZy = (currentTarget?.zhuyin || "").trim();
  if (targetZy) {
    const s = new Set();
    for (const it of F) {
      if ((it.zhuyin || "").trim() === targetZy) s.add(it.char);
    }
    const byZhuyin = Array.from(s);
    if (byZhuyin.length) return byZhuyin;
  }
  // fallback: 全部字
  const s2 = new Set(); for (const it of F) s2.add(it.char);
  return Array.from(s2);
}

// ===== 主辨識 =====
function recognizeNow(){
  const norm = extractAndNormalize(CTX, INPUT_SIZE);
  if (norm.empty){ renderRecog([]); return; }

  // 使用者：邊緣/方向/DT
  const {dir:udir, edge:uedge} = sobelDir(norm.mask, INPUT_SIZE, INPUT_SIZE);
  const udt = distanceTransform(norm.mask, INPUT_SIZE, INPUT_SIZE);

  const pool = candidateChars();
  if(!pool.length){ renderRecog([]); return; }

  const results = [];
  for(const ch of pool){
    let best = 0;
    for(let f=0; f<TEMPLATE_FONTS.length; f++){
      for(let v=0; v<VARIANTS.length; v++){
        const {edge:tedge, dir:tdir, dt:tdt} = ensureGlyph(ch, f, v);

        // 平移搜尋：找此模板的最佳位移
        let localBest = 0;
        for (const {dx,dy} of OFFSETS){
          const simC = chamferDirectionalShifted(uedge, udir, tdt, tedge, tdir, udt, INPUT_SIZE, INPUT_SIZE, dx, dy);

          // 邊緣 Jaccard（同樣採位移；簡易位移對齊）
          let inter=0, uni=0;
          for(let y=0;y<INPUT_SIZE;y++){
            for(let x=0;x<INPUT_SIZE;x++){
              const i = y*INPUT_SIZE + x;
              const xx = x+dx, yy = y+dy;
              if(xx<0||yy<0||xx>=INPUT_SIZE||yy>=INPUT_SIZE) continue;
              const j = yy*INPUT_SIZE + xx;
              inter += (uedge[i] & tedge[j]);
              uni   += (uedge[i] | tedge[j]);
            }
          }
          const simJ = uni? inter/uni : 0;

          const score = 0.92*simC + 0.08*simJ;
          if(score > localBest) localBest = score;
        }

        if (localBest > best) best = localBest;
      }
    }
    results.push({ ch, score: best });
  }

  results.sort((a,b)=>b.score-a.score);
  renderRecog(results.slice(0,5));
}

function renderRecog(items){
  if(!recogList) return;
  recogList.innerHTML='';
  if(!items.length){
    const li=document.createElement('li'); li.textContent='（沒有結果，請在框內書寫）'; li.style.color='#64748b'; recogList.appendChild(li); return;
  }
  for(const it of items){
    const li=document.createElement('li');
    const left=document.createElement('span'); left.textContent=it.ch; left.style.fontSize='20px';
    left.style.fontFamily='"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif';
    const right=document.createElement('span'); right.className='score';
    right.textContent = `${Math.round(Math.max(0,Math.min(1,it.score||0))*100)}%`;
    if(currentTarget && it.ch===currentTarget.char){ li.style.borderColor='#10b981'; li.style.background='#ecfdf5'; }
    li.appendChild(left); li.appendChild(right); recogList.appendChild(li);
  }
}

// ===== 綁定 =====
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
lessonMaxSel?.addEventListener('change', nextWord);
btnRecognize?.addEventListener('click', recognizeNow);

// ===== 初始化 =====
nextWord();
