// app.js — 描紅合規檢查（覆蓋率=覆蓋字體本體；外漏率=band 外）+ 固定座標 + 即時覆蓋率 + 次數可選(1~10)
// 規則：同一題需達成指定次數，才能換下一題；未達成前〈下一題〉按鈕會停用或提示。

// ====== UI ======
const ZHUYIN_EL   = document.getElementById('zhuyin');
const LESSON_EL   = document.getElementById('lessonInfo');
const CANVAS      = document.getElementById('pad');
const CTX         = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext     = document.getElementById('btnNext');
const btnClear    = document.getElementById('btnClear');
const penColor    = document.getElementById('penColor');
const lessonMaxSel= document.getElementById('lessonMax');
const reqPassesSel= document.getElementById('reqPasses');

const btnRecognize= document.getElementById('btnRecognize'); // 「檢查描紅」
const recogList   = document.getElementById('recogList');

// 即時覆蓋率
const liveBar  = document.getElementById('liveCoverageBar');
const liveText = document.getElementById('liveCoverageText');

// ====== 參數 ======
let drawing=false, last=null, currentTarget=null;
let pathLen=0, attemptStart=0;
let passCount=0;           // 已合格次數
let lastLiveTs=0;

let currentBand=null;      // { band, bandCount, fill, fillCount }
let locked=true;           // ← 是否鎖定題目（達成次數前維持同一字）

const TRACE_RATIO       = 0.72;
const TRACE_ALPHA       = 0.15;
const TRACE_FONT        = `"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif`;

const INPUT_SIZE        = 128;
const BIN_THR           = 160;
const PEN_WIDTH_PX      = 20;
const BAND_PX           = 8;
const PASS_COVERAGE     = 0.60;   // 門檻 60%
const MAX_LEAKAGE       = 0.18;
const MIN_PATH_LEN      = 180;
const MIN_DURATION_MS   = 700;
const MAX_EDGE_PIXELS   = 5200;

function getRequiredPasses(){
  const v = parseInt(reqPassesSel?.value || '3', 10);
  return Math.min(10, Math.max(1, isNaN(v)?3:v));
}

// ====== 載入 data.js（A 方案容錯）======
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

// ====== 範圍/出題 ======
function getMaxLesson(){ const v=parseInt(lessonMaxSel?.value||'12',10); return Number.isFinite(v)?v:12; }
function filteredDB(){ const m=getMaxLesson(); return DB.filter(it=>it.lesson==null||it.lesson<=m); }
function filteredGroupByZhuyin(){
  const map={}; for (const it of filteredDB()){ const k=(it.zhuyin||'').trim(); (map[k] ||= []).push(it); } return map;
}
function nextWord(){
  const F=filteredDB(); if(!F.length){ ZHUYIN_EL.textContent='—'; LESSON_EL.textContent=''; clearCanvas(); showInfo('沒有字可出題'); return; }
  const G=filteredGroupByZhuyin(), keys=Object.keys(G);
  let item; if(keys.length){ const k=keys[Math.floor(Math.random()*keys.length)]; const arr=G[k]; item=arr[Math.floor(Math.random()*arr.length)]; }
  else item=F[Math.floor(Math.random()*F.length)];
  currentTarget=item;
  ZHUYIN_EL.textContent=item.zhuyin||'—';
  LESSON_EL.textContent=item.lesson?`（第${item.lesson}課）`:'';
  passCount = 0;
  locked = true;                 // 新題目開始 → 鎖定
  disableNext(true);             // 達成前禁用「下一題」
  clearCanvas();
  currentBand = makeTraceBand(currentTarget.char, INPUT_SIZE);
  updateLive(0);
  showProgress();
}

// ====== 畫布與描紅 ======
function getTraceBox(){ const w=CANVAS.width,h=CANVAS.height; const s=Math.floor(Math.min(w,h)*TRACE_RATIO); return {x:Math.floor((w-s)/2),y:Math.floor((h-s)/2),w:s,h:s};}
function clearCanvas(){
  CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle='#fff'; CTX.fillRect(0,0,CANVAS.width,CANVAS.height);
  drawWritingBoxOutline();
  if(currentTarget) drawTrace(currentTarget.char);
  pathLen = 0;
  attemptStart = performance.now();
  updateLive(0);
}
function drawWritingBoxOutline(){ const b=getTraceBox(); CTX.save(); CTX.strokeStyle='#cbd5e1'; CTX.lineWidth=2; CTX.setLineDash([8,6]); CTX.strokeRect(b.x,b.y,b.w,b.h); CTX.restore(); }
function drawTrace(ch){
  const b=getTraceBox();
  CTX.save();
  CTX.globalAlpha=TRACE_ALPHA;
  CTX.fillStyle='#000'; CTX.textAlign='center'; CTX.textBaseline='middle';
  CTX.font=`${Math.floor(b.w*0.9)}px ${TRACE_FONT}`;
  CTX.fillText(ch, b.x+b.w/2, b.y+b.h/2);
  CTX.restore();
}
function setLineStyle(){ CTX.lineCap='round'; CTX.lineJoin='round'; CTX.strokeStyle=penColor?.value||'#000'; CTX.lineWidth=PEN_WIDTH_PX; }
function getPos(e){ const r=CANVAS.getBoundingClientRect(), sx=CANVAS.width/r.width, sy=CANVAS.height/r.height; const x=(e.touches?e.touches[0].clientX:e.clientX)-r.left; const y=(e.touches?e.touches[0].clientY:e.clientY)-r.top; return {x:x*sx,y:y*sy}; }

CANVAS.addEventListener('pointerdown',e=>{
  drawing=true; last=getPos(e); setLineStyle(); if(!attemptStart) attemptStart=performance.now();
  if (!currentBand && currentTarget) currentBand = makeTraceBand(currentTarget.char, INPUT_SIZE);
});
CANVAS.addEventListener('pointermove',e=>{
  if(!drawing) return; const p=getPos(e), b=getTraceBox();
  const dx=p.x-last.x, dy=p.y-last.y; pathLen += Math.hypot(dx,dy);
  CTX.save(); CTX.beginPath(); CTX.rect(b.x,b.y,b.w,b.h); CTX.clip();
  CTX.beginPath(); CTX.moveTo(last.x,last.y); CTX.lineTo(p.x,p.y); CTX.stroke(); CTX.restore();
  last=p;

  const now = performance.now();
  if (now - lastLiveTs >= 50) { computeLiveCoverage(); lastLiveTs = now; }
});
window.addEventListener('pointerup',()=>{drawing=false; last=null;});
CANVAS.addEventListener('touchstart', e=>e.preventDefault(), {passive:false});
CANVAS.addEventListener('touchmove', e=>e.preventDefault(), {passive:false});

// ====== 影像工具（固定座標）======
function binarize(imgData, thr=BIN_THR){
  const {data,width,height}=imgData; const n=width*height; const mask=new Uint8Array(n);
  for(let i=0, p=0;i<data.length;i+=4, p++){ const v=(data[i]+data[i+1]+data[i+2])/3; mask[p]= (v<thr)?1:0; }
  return {mask,width,height};
}
function extractStableRegion(ctx, size=INPUT_SIZE){
  const b=getTraceBox();
  const img = ctx.getImageData(b.x, b.y, b.w, b.h);
  const tmp=document.createElement('canvas'); tmp.width=b.w; tmp.height=b.h;
  const tg=tmp.getContext('2d'); tg.putImageData(img,0,0);
  const out=document.createElement('canvas'); out.width=size; out.height=size;
  const o=out.getContext('2d'); o.fillStyle='#fff'; o.fillRect(0,0,size,size);
  o.imageSmoothingEnabled=false;
  o.drawImage(tmp, 0,0,b.w,b.h, 0,0,size,size);
  const oimg=o.getImageData(0,0,size,size);
  const bin=binarize(oimg);
  return {mask:bin.mask, empty:false};
}

// ====== 走廊/本體 ======
function makeTraceBand(char, size=INPUT_SIZE){
  const c=document.createElement('canvas'); c.width=size; c.height=size;
  const g=c.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,size,size);
  g.fillStyle='#000'; g.textAlign='center'; g.textBaseline='middle';
  g.font = `${Math.floor(size*0.9)}px ${TRACE_FONT}`;
  g.fillText(char, size/2, size/2);

  const img=g.getImageData(0,0,size,size);
  const bin=binarize(img);
  const fill = bin.mask;
  let fillCount=0; for(let i=0;i<fill.length;i++) fillCount += fill[i];

  // 外擴 band
  const INF=1e9, dist=new Float32Array(size*size);
  for(let i=0;i<dist.length;i++) dist[i]=fill[i]?0:INF;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const i=y*size+x;
    if(x>0) dist[i]=Math.min(dist[i], dist[i-1]+1);
    if(y>0) dist[i]=Math.min(dist[i], dist[i-size]+1);
    if(x>0&&y>0) dist[i]=Math.min(dist[i], dist[i-size-1]+2);
    if(x<size-1&&y>0) dist[i]=Math.min(dist[i], dist[i-size+1]+2);
  }
  for(let y=size-1;y>=0;y--) for(let x=size-1;x>=0;x--){
    const i=y*size+x;
    if(x<size-1) dist[i]=Math.min(dist[i], dist[i+1]+1);
    if(y<size-1) dist[i]=Math.min(dist[i], dist[i+size]+1);
    if(x<size-1&&y<size-1) dist[i]=Math.min(dist[i], dist[i+size+1]+2);
    if(x>0&&y<size-1) dist[i]=Math.min(dist[i], dist[i+size-1]+2);
  }
  const band=new Uint8Array(size*size);
  let bandCount=0;
  for(let i=0;i<dist.length;i++){
    if(dist[i] <= BAND_PX){ band[i]=1; bandCount++; }
  }
  return { band, bandCount, fill, fillCount };
}

// ====== 檢查描紅（保持同一題直到達標）======
function checkTracing(){
  if(!currentTarget){ showInfo('尚未出題'); return; }

  // 基本防呆
  const dt = performance.now() - (attemptStart || performance.now());
  if (pathLen < MIN_PATH_LEN){ showFail('筆畫太少，請沿著描紅寫'); return; }
  if (dt < MIN_DURATION_MS){ showFail('寫得太快，請慢慢沿著描紅'); return; }

  const user = extractStableRegion(CTX, INPUT_SIZE);
  const userMask = user.mask;

  let userCount=0; for(let i=0;i<userMask.length;i++) userCount += userMask[i];
  if (userCount > MAX_EDGE_PIXELS){ showFail('塗抹太多，請沿描紅書寫'); return; }
  if (userCount === 0){ showFail('沒有筆畫'); return; }

  currentBand = currentBand || makeTraceBand(currentTarget.char, INPUT_SIZE);
  const {band, fill, fillCount} = currentBand;

  let coverFill=0, leak=0;
  for(let i=0;i<userMask.length;i++){
    if (userMask[i]) {
      if (fill[i]) coverFill++;
      if (!band[i]) leak++;
    }
  }
  const coverage = fillCount ? (coverFill / fillCount) : 0;
  const leakage  = userCount ? (leak / userCount) : 1;

  if (coverage >= PASS_COVERAGE && leakage <= MAX_LEAKAGE){
    passCount++;
    showPass(coverage, leakage, passCount);

    const need = getRequiredPasses();
    if (passCount >= need){
      // 達標 → 解鎖並自動下一題
      locked = false;
      disableNext(false);
      showInfo(`🎉 完成 ${need}/${need} 次！自動換下一題…`);
      setTimeout(nextWord, 800);
    } else {
      // 未達滿次數 → 保持同一題，清畫布再寫
      clearCanvas();
      showInfo(`已完成 ${passCount}/${need}，請再沿描紅寫一次`);
    }
  }else{
    const msg = `覆蓋率 ${Math.round(coverage*100)}%，外漏 ${Math.round(leakage*100)}%`;
    showFail(`尚未合格：${msg}（需要覆蓋≥${Math.round(PASS_COVERAGE*100)}%，外漏≤${Math.round(MAX_LEAKAGE*100)}%）`);
  }
}

// ====== 即時覆蓋率 ======
function updateLive(pct){
  if (!liveBar || !liveText) return;
  const clamped = Math.max(0, Math.min(1, pct));
  liveBar.style.width = (clamped*100).toFixed(0) + '%';
  liveBar.style.background = clamped >= PASS_COVERAGE ? '#10b981' : '#f59e0b';
  liveText.textContent = (clamped*100).toFixed(0) + '%';
}
function computeLiveCoverage(){
  if (!currentTarget || !currentBand){ updateLive(0); return; }
  const user = extractStableRegion(CTX, INPUT_SIZE);
  const mask = user.mask;
  const {fill, fillCount} = currentBand;

  let coverFill=0;
  for (let i=0;i<mask.length;i++) if (mask[i] && fill[i]) coverFill++;
  const pct = fillCount ? (coverFill / fillCount) : 0;
  updateLive(pct);
}

// ====== UI 呈現/控制 ======
function showProgress(){
  if(!recogList) return;
  recogList.innerHTML='';
  const need = getRequiredPasses();
  const li=document.createElement('li');
  li.textContent = `描紅完成次數：${passCount}/${need}`;
  li.style.fontWeight='600';
  li.style.color='#0f172a';
  recogList.appendChild(li);
}
function showInfo(text){
  showProgress();
  const li=document.createElement('li'); li.textContent=text; li.style.color='#334155';
  recogList.appendChild(li);
}
function showPass(coverage, leakage, count){
  showProgress();
  const li=document.createElement('li');
  li.textContent = `✅ 合格！覆蓋 ${Math.round(coverage*100)}%，外漏 ${Math.round(leakage*100)}%（第 ${count}/${getRequiredPasses()} 次）`;
  li.style.color='#065f46'; li.style.background='#ecfdf5'; li.style.border='1px solid #10b981'; li.style.borderRadius='8px'; li.style.padding='6px 8px';
  recogList.appendChild(li);
}
function showFail(text){
  showProgress();
  const li=document.createElement('li');
  li.textContent = `❌ ${text}`;
  li.style.color='#b91c1c'; li.style.background='#fef2f2'; li.style.border='1px solid #ef4444'; li.style.borderRadius='8px'; li.style.padding='6px 8px';
  recogList.appendChild(li);
}
function disableNext(disabled){
  if (!btnNext) return;
  btnNext.disabled = disabled;
  btnNext.style.opacity = disabled ? '0.5' : '1';
  btnNext.style.cursor  = disabled ? 'not-allowed' : 'pointer';
}

// ====== 綁定/初始化 ======
btnClear?.addEventListener('click', ()=>{ clearCanvas(); updateLive(0); });
btnNext?.addEventListener('click', ()=>{
  // 只有達標或未鎖定時才允許換題
  if (!locked) { nextWord(); return; }
  const need = getRequiredPasses();
  showInfo(`還差 ${Math.max(0, need - passCount)} 次描紅才可換題`);
});
lessonMaxSel?.addEventListener('change', ()=>{ nextWord(); });
reqPassesSel?.addEventListener('change', ()=>{
  showProgress();
  // 已經超過新門檻就解鎖並可換題
  if (passCount >= getRequiredPasses()) { locked = false; disableNext(false); }
});
btnRecognize?.addEventListener('click', checkTracing);

// 初始化
disableNext(true);
nextWord();
