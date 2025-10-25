// ---- Tabs：預設顯示「設定」；用 hash 控制 + .active 切換 ----
(function setupTabs(){
  const settingsBtn = document.getElementById('tabSettingsBtn');
  const practiceBtn = document.getElementById('tabPracticeBtn');
  const settingsPan = document.getElementById('settings');
  const practicePan = document.getElementById('practice');

  function applyActive(isSettings){
    settingsBtn?.classList.toggle('active', isSettings);
    practiceBtn?.classList.toggle('active', !isSettings);
    settingsPan?.classList.toggle('active', isSettings);
    practicePan?.classList.toggle('active', !isSettings);
  }
  function updateByHash(){
    const h = (location.hash || '#settings').toLowerCase();
    applyActive(h === '#settings');
  }
  window.addEventListener('hashchange', updateByHash);
  if (!location.hash) location.replace('#settings'); // 預設 settings
  updateByHash();
})();

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

const btnRecognize= document.getElementById('btnRecognize');
const recogList   = document.getElementById('recogList');

// 覆蓋率（UI 不顯示）
const SHOW_LIVE = false;

// ====== 統計：累計完成題數（本次開啟期間，重新載入會歸零）======
let statsTotal = 0;
const statsTotalEl = document.getElementById('statsTotal');
const btnResetStats = document.getElementById('btnResetStats');
function updateStatsUI(){ if(statsTotalEl) statsTotalEl.textContent = String(statsTotal); }
function incStats(){ statsTotal++; updateStatsUI(); }
function resetStats(){ statsTotal = 0; updateStatsUI(); }
btnResetStats?.addEventListener('click', resetStats);
resetStats();

// ====== 狀態/參數（部分改為動態計算）======
let drawing=false, last=null, currentTarget=null;
let pathLen=0, attemptStart=0;
let passCount=0;
let lastLiveTs=0;

let currentBand=null;      // { band, bandCount, fill, fillCount }
let locked=true;           // 未達成次數前，鎖定同一題

// 描紅區=整個畫布
const TRACE_ALPHA       = 0.15;
const TRACE_FONT        = `"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif`;

// 影像解析固定 128x128（演算法用），不影響畫布視覺大小
const INPUT_SIZE        = 128;
const BIN_THR           = 160;

// ★ 這三個值改為動態計算：筆粗、走廊寬度、最小筆畫長度
let PEN_WIDTH_PX        = 30;   // 會在 computeDynamicParams() 依畫布尺寸覆寫
let BAND_PX             = 9;    // 依筆粗自動推算
let MIN_PATH_LEN        = 180;  // 依畫布尺寸自動推算

// 其他判定
const PASS_COVERAGE     = 0.60;   // 覆蓋率門檻 60%
const MAX_LEAKAGE       = 0.18;   // 外漏容許 18%
const MIN_DURATION_MS   = 700;    // 至少書寫時間
// ★ 「塗抹太多」改為依「描紅區總像素」的比例（避免不同裝置/筆粗誤判）
const MAX_FILL_FRACTION = 0.50;   // 使用者塗滿 > 50% 畫布視為亂塗

// 依畫布大小動態計算參數（iPhone 會自動變瘦一點，避免「塗抹太多」）
function computeDynamicParams(){
  const dim = Math.min(CANVAS.width, CANVAS.height);
  // 筆粗 ≈ 6% 的最小邊，限制在 18~40 之間
  PEN_WIDTH_PX = Math.round(Math.max(18, Math.min(40, dim * 0.06)));
  // 走廊寬度 ≈ 筆粗的 0.25，限制在 8~14 之間
  BAND_PX = Math.max(8, Math.min(14, Math.round(PEN_WIDTH_PX * 0.25)));
  // 最小筆畫長度 ≈ 0.3 倍的最小邊（以前 600px → 180）
  MIN_PATH_LEN = Math.round(dim * 0.3);
}
computeDynamicParams();

// ====== 載入 data.js（A 方案容錯）======
function getRequiredPasses(){
  const v = parseInt(reqPassesSel?.value || '3', 10);
  return Math.min(10, Math.max(1, isNaN(v)?3:v));
}
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
  locked = true;
  disableNext(true);
  clearCanvas();
  currentBand = makeTraceBand(currentTarget.char, INPUT_SIZE); // 使用最新 BAND_PX 生成
  showProgress();
}

// ====== 畫布與描紅 ======
function getTraceBox(){ return { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height }; }
function clearCanvas(){
  CTX.setTransform(1,0,0,1,0,0);
  CTX.clearRect(0,0,CANVAS.width,CANVAS.height);
  CTX.fillStyle='#fff'; CTX.fillRect(0,0,CANVAS.width,CANVAS.height);

  const b=getTraceBox();
  CTX.save();
  CTX.strokeStyle='#cbd5e1';
  CTX.lineWidth=2;
  CTX.setLineDash([8,6]);
  CTX.strokeRect(b.x,b.y,b.w,b.h);
  CTX.restore();

  if(currentTarget) drawTrace(currentTarget.char);
  pathLen = 0;
  attemptStart = performance.now();
}
function drawTrace(ch){
  const b=getTraceBox();
  CTX.save();
  CTX.globalAlpha=TRACE_ALPHA;
  CTX.fillStyle='#000'; CTX.textAlign='center'; CTX.textBaseline='middle';
  CTX.font=`${Math.floor(b.w*0.92)}px ${TRACE_FONT}`; // 稍微縮 8% 避免切邊
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
});
window.addEventListener('pointerup',()=>{drawing=false; last=null;});
CANVAS.addEventListener('touchstart', e=>e.preventDefault(), {passive:false});
CANVAS.addEventListener('touchmove', e=>e.preventDefault(), {passive:false});

// 視窗尺寸/旋轉改變時，重新計算動態參數（若你未改 canvas 固定大小，這步通常不會變）
window.addEventListener('resize', ()=>{
  const oldPen = PEN_WIDTH_PX, oldBand = BAND_PX;
  computeDynamicParams();
  if (PEN_WIDTH_PX !== oldPen || BAND_PX !== oldBand) {
    currentBand = currentTarget ? makeTraceBand(currentTarget.char, INPUT_SIZE) : null;
    clearCanvas();
  }
});

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

// ====== 走廊/本體（用動態 BAND_PX）======
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

  // 外擴 band（距離轉換）
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
  for(let i=0;i<dist.length;i++) if(dist[i] <= BAND_PX) band[i]=1;
  return { band, bandCount:0, fill, fillCount };
}

// ====== 檢查（<60% 清除重寫；≥60% 顯示剩餘次數；達標→下一題並統計+1）======
function checkTracing(){
  if(!currentTarget){ showInfo('尚未出題'); return; }

  const dt = performance.now() - (attemptStart || performance.now());
  if (pathLen < MIN_PATH_LEN){ showFail('筆畫太少，請沿著描紅寫'); return; }
  if (dt < MIN_DURATION_MS){ showFail('寫得太快，請慢慢沿著描紅'); return; }

  const user = extractStableRegion(CTX, INPUT_SIZE);
  const userMask = user.mask;

  // 「塗抹太多」以比例判斷，避免不同裝置筆粗造成誤判
  const totalPixels = INPUT_SIZE * INPUT_SIZE;
  let userCount=0; for(let i=0;i<userMask.length;i++) userCount += userMask[i];
  if (userCount > totalPixels * MAX_FILL_FRACTION){ showFail('塗抹太多，請沿描紅書寫'); return; }
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
    const need = getRequiredPasses();

    if (passCount >= need){
      // 統計 +1（完成一題：本次開頁面內的累計）
      incStats();

      locked = false;
      disableNext(false);
      showInfo(`🎉 達成 ${need}/${need} 次，已完成！自動換下一題…`);
      setTimeout(nextWord, 800);
    } else {
      const remain = Math.max(0, need - passCount);
      showInfo(`✅ 通過一次！還剩下 ${remain} 次就完成`);
      clearCanvas(); // 下一次嘗試
    }
  }else{
    clearCanvas();
    showFail('覆蓋不足 60% 或外漏過高，請再試一次');
  }
}

// ====== 即時覆蓋率（本需求關閉；函式保留避免報錯）======
function updateLive(_) { /* no-op */ }
function computeLiveCoverage(){ /* no-op */ }

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
btnClear?.addEventListener('click', ()=>{ clearCanvas(); });
btnNext?.addEventListener('click', ()=>{
  if (!locked) { nextWord(); return; }
  const need = getRequiredPasses();
  showInfo(`還差 ${Math.max(0, need - passCount)} 次描紅才可換題`);
});
lessonMaxSel?.addEventListener('change', ()=>{ nextWord(); });
reqPassesSel?.addEventListener('change', ()=>{
  showProgress();
  if (passCount >= getRequiredPasses()) { locked = false; disableNext(false); }
});
btnRecognize?.addEventListener('click', checkTracing);

// 初始
disableNext(true);
nextWord();
