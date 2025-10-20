// app.js — FAST 版：粗篩(投影) + 精算(邊緣/方向Chamfer+Jaccard+小平移)
// 固定：筆粗=20px、描紅=15%、候選=同注音(範圍內，無則全表)

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

// ===== 參數（為速度調整）=====
let drawing=false, last=null, currentTarget=null;
const TRACE_RATIO=0.72, TRACE_ALPHA=0.15;
const INPUT_SIZE = 128;         // ↓ 160 -> 128
const BIN_THR    = 160;         // 排除 15% 灰描紅
const TOP_PREFILTER = 16;       // 粗篩後留下的個數 (12～20間可調)
const OFFSETS = [               // ↓ 小平移 9 點
  {dx:0,dy:0},{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},
  {dx:2,dy:0},{dx:-2,dy:0},{dx:0,dy:2},{dx:0,dy:-2},
];
const TEMPLATE_FONTS = [        // ↓ 只用 2 種
  '"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif',
  '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif'
];
const VARIANTS = [              // ↓ 3 種擾動
  { rot: 0,  scale: 1.00 },
  { rot: -4, scale: 0.99 },
  { rot: +4, scale: 0.99 }
];

// ===== 載入 data.js (A 方案) =====
function pickSourceArray() {
  let raw = window.WORDS || window.DATA || window.G3_TOP1_WORDS || window.words || window.db;
  try { if (!raw && typeof data !== 'undefined') raw = data; } catch(e){}
  if (!raw) { alert('找不到 data.js 的資料陣列'); return []; }
  const out=[], pushMaybe=(o,lsn)=>{
    if(!o) return;
    const c=o.char||o.word||o.hanzi||o.han||o.c||o['字'];
    const z=o.zhuyin||o.bopomofo||o.phonetic||o.z||o['注音'];
    if (c&&z) out.push({char:String(c), zhuyin:String(z).trim(), lesson: lsn??(o.lesson??o.lsn??o.lessonNo??null)});
  };
  if (Array.isArray(raw)) {
    for (const it of raw) {
      if (Array.isArray(it?.words)) { const l=it.lesson??it.lsn??it.lessonNo??null; for (const w of it.words) pushMaybe(w,l); }
      else pushMaybe(it,it.lesson??it.lsn??it.lessonNo??null);
    }
  } else if (Array.isArray(raw.words)) {
    const l=raw.lesson??raw.lsn??raw.lessonNo??null; for (const w of raw.words) pushMaybe(w,l);
  }
  if(!out.length) alert('data.js 載入但解析不到 {char, zhuyin}');
  return out;
}
const DB = pickSourceArray();

// ===== 範圍/出題 =====
function getMaxLesson(){ const v=parseInt(lessonMaxSel?.value||'12',10); return Number.isFinite(v)?v:12; }
function filteredDB(){ const m=getMaxLesson(); return DB.filter(it=>it.lesson==null||it.lesson<=m); }
function filteredGroupByZhuyin(){
  const map={}; for (const it of filteredDB()){ const k=(it.zhuyin||'').trim(); (map[k] ||= []).push(it); } return map;
}
function nextWord(){
  const F=filteredDB(); if(!F.length){ ZHUYIN_EL.textContent='—'; LESSON_EL.textContent=''; clearCanvas(); renderRecog([]); return; }
  const G=filteredGroupByZhuyin(), keys=Object.keys(G);
  let item; if(keys.length){ const k=keys[Math.floor(Math.random()*keys.length)]; const arr=G[k]; item=arr[Math.floor(Math.random()*arr.length)]; }
  else item=F[Math.floor(Math.random()*F.length)];
  currentTarget=item;
  ZHUYIN_EL.textContent=item.zhuyin||'—';
  LESSON_EL.textContent=item.lesson?`（第${item.lesson}課）`:'';
  clearCanvas(); renderRecog([]);
}

// ===== 畫布/描紅 =====
function getTraceBox(){ const w=CANVAS.width,h=CANVAS.height; const s=Math.floor(Math.min(w,h)*TRACE_RATIO); return {x:Math.floor((w-s)/2),y:Math.floor((h-s)/2),w:s,h:s};}
function clearCanvas(){
  CTX.setTransform(1,0,0,1,0,0); CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle='#fff'; CTX.fillRect(0,0,CANVAS.width,CANVAS.height); drawWritingBoxOutline();
  if(currentTarget) drawTrace(currentTarget.char);
}
function drawWritingBoxOutline(){ const b=getTraceBox(); CTX.save(); CTX.strokeStyle='#cbd5e1'; CTX.lineWidth=2; CTX.setLineDash([8,6]); CTX.strokeRect(b.x,b.y,b.w,b.h); CTX.restore(); }
function drawTrace(ch){
  const b=getTraceBox(); CTX.save(); CTX.globalAlpha=TRACE_ALPHA; CTX.fillStyle='#000'; CTX.textAlign='center'; CTX.textBaseline='middle';
  CTX.font=`${Math.floor(b.w*0.9)}px "TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif`;
  CTX.fillText(ch,b.x+b.w/2,b.y+b.h/2); CTX.restore();
}
function setLineStyle(){ CTX.lineCap='round'; CTX.lineJoin='round'; CTX.strokeStyle=penColor?.value||'#000'; CTX.lineWidth=20; }
function getPos(e){ const r=CANVAS.getBoundingClientRect(), sx=CANVAS.width/r.width, sy=CANVAS.height/r.height; const x=(e.touches?e.touches[0].clientX:e.clientX)-r.left; const y=(e.touches?e.touches[0].clientY:e.clientY)-r.top; return {x:x*sx,y:y*sy}; }
CANVAS.addEventListener('pointerdown',e=>{drawing=true; last=getPos(e); setLineStyle();});
CANVAS.addEventListener('pointermove',e=>{ if(!drawing) return; const p=getPos(e), b=getTraceBox(); CTX.save(); CTX.beginPath(); CTX.rect(b.x,b.y,b.w,b.h); CTX.clip(); CTX.beginPath(); CTX.moveTo(last.x,last.y); CTX.lineTo(p.x,p.y); CTX.stroke(); CTX.restore(); last=p;});
window.addEventListener('pointerup',()=>{drawing=false; last=null;});
CANVAS.addEventListener('touchstart', e=>e.preventDefault(), {passive:false});
CANVAS.addEventListener('touchmove', e=>e.preventDefault(), {passive:false});

// ===== 影像工具（盡量重用 TypedArray）=====
function binarize(imgData, thr=BIN_THR){
  const {data,width,height}=imgData; const n=width*height; const mask=new Uint8Array(n);
  for(let i=0, p=0;i<data.length;i+=4, p++){ const v=(data[i]+data[i+1]+data[i+2])/3; mask[p]= (v<thr)?1:0; }
  return {mask,width,height};
}
function getBBox(mask,w,h){ let minx=w,miny=h,maxx=-1,maxy=-1,area=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ if(mask[y*w+x]){ area++; if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; } }
  if(!area) return null; return {x:minx,y:miny,w:maxx-minx+1,h:maxy-miny+1,area};
}
function edgeFromMask(mask,w,h){
  const edge=new Uint8Array(w*h), val=(x,y)=> (x>=0&&x<w&&y>=0&&y<h) ? mask[y*w+x] : 0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ if(!val(x,y)) continue;
    if(x===0||y===0||x===w-1||y===h-1||!val(x-1,y)||!val(x+1,y)||!val(x,y-1)||!val(x,y+1)) edge[y*w+x]=1;
  } return edge;
}
function extractAndNormalize(ctx,size=INPUT_SIZE){
  const b=getTraceBox(); const img=ctx.getImageData(b.x,b.y,b.w,b.h); const bin=binarize(img); const bb=getBBox(bin.mask,bin.width,bin.height);
  const out=document.createElement('canvas'); out.width=size; out.height=size; const o=out.getContext('2d'); o.fillStyle='#fff'; o.fillRect(0,0,size,size);
  if(!bb) return {canvas:out, mask:new Uint8Array(size*size), empty:true};
  const src=document.createElement('canvas'); src.width=bb.w; src.height=bb.h; const s=src.getContext('2d'); const sImg=s.createImageData(bb.w,bb.h);
  for(let y=0;y<bb.h;y++) for(let x=0;x<bb.w;x++){ const on=bin.mask[(bb.y+y)*bin.width + (bb.x+x)]?0:255; const idx=(y*bb.w+x)*4; sImg.data[idx]=on; sImg.data[idx+1]=on; sImg.data[idx+2]=on; sImg.data[idx+3]=255; }
  s.putImageData(sImg,0,0);
  const scale=0.90*Math.min(size/bb.w,size/bb.h), rw=Math.max(1,Math.round(bb.w*scale)), rh=Math.max(1,Math.round(bb.h*scale));
  const dx=Math.round((size-rw)/2), dy=Math.round((size-rh)/2); o.imageSmoothingEnabled=false; o.drawImage(src,0,0,bb.w,bb.h,dx,dy,rw,rh);
  const oimg=o.getImageData(0,0,size,size); const done=binarize(oimg); return {canvas:out, mask:done.mask, empty:false};
}
function sobelDir(mask,w,h){
  const edge=edgeFromMask(mask,w,h), dir=new Uint8Array(w*h), val=(x,y)=>edge[y*w+x]?1:0;
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
    const gx = -val(x-1,y-1)-2*val(x-1,y)+-val(x-1,y+1) + val(x+1,y-1)+2*val(x+1,y)+val(x+1,y+1);
    const gy = -val(x-1,y-1)-2*val(x,y-1)-val(x+1,y-1) + val(x-1,y+1)+2*val(x,y+1)+val(x+1,y+1);
    let bin = Math.round(((Math.atan2(gy,gx)+Math.PI)/(2*Math.PI))*8)%8; dir[y*w+x]=bin;
  } return {dir, edge};
}
function distanceTransform(mask,w,h){
  const edge=edgeFromMask(mask,w,h), INF=1e9, dist=new Float32Array(w*h);
  for(let i=0;i<w*h;i++) dist[i]=edge[i]?0:INF;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=y*w+x;
    if(x>0)dist[i]=Math.min(dist[i],dist[i-1]+1); if(y>0)dist[i]=Math.min(dist[i],dist[i-w]+1);
    if(x>0&&y>0)dist[i]=Math.min(dist[i],dist[i-w-1]+2); if(x<w-1&&y>0)dist[i]=Math.min(dist[i],dist[i-w+1]+2);
  }
  for(let y=h-1;y>=0;y--) for(let x=w-1;x>=0;x--){ const i=y*w+x;
    if(x<w-1)dist[i]=Math.min(dist[i],dist[i+1]+1); if(y<h-1)dist[i]=Math.min(dist[i],dist[i+w]+1);
    if(x<w-1&&y<h-1)dist[i]=Math.min(dist[i],dist[i+w+1]+2); if(x>0&&y<h-1)dist[i]=Math.min(dist[i],dist[i+w-1]+2);
  } return dist;
}
function jaccard(a,b){ let inter=0,uni=0; for(let i=0;i<a.length;i++){ inter+=(a[i]&b[i]); uni+=(a[i]|b[i]); } return uni?inter/uni:0; }

// ===== 模板快取（含投影）=====
const GLYPH_CACHE = new Map(); // key `${char}|${f}|${v}|${INPUT_SIZE}`
function renderCharVariant(ch,font,size=INPUT_SIZE,rotDeg=0,scale=1.0){
  const c=document.createElement('canvas'); c.width=size; c.height=size; const g=c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,size,size); g.save(); g.translate(size/2,size/2); g.rotate(rotDeg*Math.PI/180); g.scale(scale,scale);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle'; g.font=`${Math.floor(size*0.9)}px ${font}`; g.fillText(ch,0,0); g.restore();
  const img=g.getImageData(0,0,size,size); const bin=binarize(img); return edgeFromMask(bin.mask,size,size);
}
function projXY(edge,w,h){
  const H=new Uint16Array(w); const V=new Uint16Array(h);
  for(let y=0;y<h;y++){ let s=0; for(let x=0;x<w;x++) s+=edge[y*w+x]; V[y]=s; }
  for(let x=0;x<w;x++){ let s=0; for(let y=0;y<h;y++) s+=edge[y*w+x]; H[x]=s; }
  return {H,V};
}
function projDist(H1,V1,H2,V2){ // L1 距離歸一化成相似度(越大越像)
  let d=0, n=H1.length+V1.length; for(let i=0;i<H1.length;i++) d+=Math.abs(H1[i]-H2[i]); for(let i=0;i<V1.length;i++) d+=Math.abs(V1[i]-V2[i]);
  const maxD = n * 255; const sim = 1 - (d / maxD); return Math.max(0,Math.min(1,sim));
}
function ensureGlyph(char,f,v){
  const key=`${char}|${f}|${v}|${INPUT_SIZE}`;
  if(!GLYPH_CACHE.has(key)){
    const edge = renderCharVariant(char, TEMPLATE_FONTS[f], INPUT_SIZE, VARIANTS[v].rot, VARIANTS[v].scale);
    const {dir} = sobelDir(edge, INPUT_SIZE, INPUT_SIZE);
    const dt = distanceTransform(edge, INPUT_SIZE, INPUT_SIZE);
    const {H,V} = projXY(edge, INPUT_SIZE, INPUT_SIZE);
    GLYPH_CACHE.set(key, {edge,dir,dt,H,V});
  }
  return GLYPH_CACHE.get(key);
}

// ===== 比對（含小平移）=====
function chamferDirectionalShifted(userEdge,userDir,tmplDT,tmplEdge,tmplDir,userDT,w,h,dx,dy){
  let su=0,cu=0, st=0,ct=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=y*w+x; if(!userEdge[i]) continue; const xx=x+dx, yy=y+dy; if(xx<0||yy<0||xx>=w||yy>=h) continue;
    const j=yy*w+xx; let d=Math.abs(userDir[i]-tmplDir[j]); if(d>4)d=8-d; if(d<=1){ su+=tmplDT[j]; cu++; }
  }
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const j=y*w+x; if(!tmplEdge[j]) continue; const xx=x-dx, yy=y-dy; if(xx<0||yy<0||xx>=w||yy>=h) continue;
    const i=yy*w+xx; let d=Math.abs(tmplDir[j]-userDir[i]); if(d>4)d=8-d; if(d<=1){ st+=userDT[i]; ct++; }
  }
  if(!cu && !ct) return 0;
  const avg=((cu?su/cu:0)+(ct?st/ct:0))/2; const MAX_D=30; // 128px 下調
  const sim=1-(avg/MAX_D); return Math.max(0,Math.min(1,Number.isFinite(sim)?sim:0));
}

// ===== 候選字（同注音優先）=====
function candidateChars(){
  const F=filteredDB(); const zy=(currentTarget?.zhuyin||"").trim();
  if(zy){ const s=new Set(); for(const it of F){ if((it.zhuyin||"").trim()===zy) s.add(it.char); } const arr=Array.from(s); if(arr.length) return arr; }
  const s2=new Set(); for(const it of F) s2.add(it.char); return Array.from(s2);
}

// ===== 主辨識（先粗篩再精算）=====
function recognizeNow(){
  const norm=extractAndNormalize(CTX, INPUT_SIZE); if(norm.empty){ renderRecog([]); return; }

  // 使用者特徵（一次算好、重用）
  const {dir:udir, edge:uedge} = sobelDir(norm.mask, INPUT_SIZE, INPUT_SIZE);
  const udt  = distanceTransform(norm.mask, INPUT_SIZE, INPUT_SIZE);
  const {H:UH, V:UV} = projXY(uedge, INPUT_SIZE, INPUT_SIZE);

  // 候選集
  const pool=candidateChars(); if(!pool.length){ renderRecog([]); return; }

  // 1) 粗篩（投影相似度，取前 TOP_PREFILTER）
  const pre = [];
  for(const ch of pool){
    let best=-1;
    for(let f=0; f<TEMPLATE_FONTS.length; f++){
      for(let v=0; v<VARIANTS.length; v++){
        const {H,V} = ensureGlyph(ch,f,v);
        const sim = projDist(UH,UV,H,V);
        if(sim>best) best=sim;
      }
    }
    pre.push({ch, preSim: best});
  }
  pre.sort((a,b)=>b.preSim-a.preSim);
  const shortlist = pre.slice(0, Math.min(TOP_PREFILTER, pre.length)).map(x=>x.ch);

  // 2) 精算（Chamfer+Jaccard + 小平移）
  const results=[];
  for(const ch of shortlist){
    let best=0;
    for(let f=0; f<TEMPLATE_FONTS.length; f++){
      for(let v=0; v<VARIANTS.length; v++){
        const {edge:tedge, dir:tdir, dt:tdt} = ensureGlyph(ch,f,v);
        let localBest=0;
        for(const {dx,dy} of OFFSETS){
          const simC = chamferDirectionalShifted(uedge, udir, tdt, tedge, tdir, udt, INPUT_SIZE, INPUT_SIZE, dx, dy);
          // 位移 Jaccard
          let inter=0, uni=0;
          for(let y=0;y<INPUT_SIZE;y++){
            const row=y*INPUT_SIZE, yy=y+dy; if(yy<0||yy>=INPUT_SIZE) continue;
            const row2=yy*INPUT_SIZE;
            for(let x=0;x<INPUT_SIZE;x++){
              const xx=x+dx; if(xx<0||xx>=INPUT_SIZE) continue;
              const i=row+x, j=row2+xx;
              inter += (uedge[i]&tedge[j]); uni += (uedge[i]|tedge[j]);
            }
          }
          const simJ = uni? inter/uni : 0;
          const score = 0.92*simC + 0.08*simJ;
          if(score>localBest) localBest=score;
        }
        if(localBest>best) best=localBest;
      }
    }
    results.push({ch, score:best});
  }
  results.sort((a,b)=>b.score-a.score);
  renderRecog(results.slice(0,5));
}

function renderRecog(items){
  if(!recogList) return; recogList.innerHTML='';
  if(!items.length){ const li=document.createElement('li'); li.textContent='（沒有結果，請在框內書寫）'; li.style.color='#64748b'; recogList.appendChild(li); return; }
  for(const it of items){
    const li=document.createElement('li'); const left=document.createElement('span'); left.textContent=it.ch; left.style.fontSize='20px';
    left.style.fontFamily='"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif';
    const right=document.createElement('span'); right.className='score'; right.textContent=`${Math.round(Math.max(0,Math.min(1,it.score||0))*100)}%`;
    if(currentTarget && it.ch===currentTarget.char){ li.style.borderColor='#10b981'; li.style.background='#ecfdf5'; }
    li.appendChild(left); li.appendChild(right); recogList.appendChild(li);
  }
}

// ===== 綁定/初始化 =====
btnClear?.addEventListener('click', clearCanvas);
btnNext?.addEventListener('click', nextWord);
lessonMaxSel?.addEventListener('change', nextWord);
btnRecognize?.addEventListener('click', recognizeNow);
nextWord();
