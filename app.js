// === app.js (full, updated) ===
// - Supports term selection: 小一下 / 小二上 / 小二下 / 小三上
// - Range (第1~N課), cross-term mixing with weights (50/75/100)
// - Live preview of mixing, practice canvas, recognition
// - Shows "（學期第N課）" next to zhuyin on the Practice tab
//
// Requires: data_g1_tog31.js loaded before this file and exposing window.cnkeys_all

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
const ZHUYIN_EL    = document.getElementById('zhuyin');
const LESSON_EL    = document.getElementById('lessonInfo');
const CANVAS       = document.getElementById('pad');
const CTX          = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext      = document.getElementById('btnNext');
const btnClear     = document.getElementById('btnClear');
const penColor     = document.getElementById('penColor');
const lessonMaxSel = document.getElementById('lessonMax');
const reqPassesSel = document.getElementById('reqPasses');

const termSel      = document.getElementById('termSelect');
const weightRow    = document.getElementById('weightRow');
const weightSel    = document.getElementById('currWeight');
const mixPreviewEl = document.getElementById('mixPreview');

const btnRecognize = document.getElementById('btnRecognize');
const recogList    = document.getElementById('recogList');

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

// ====== 描紅狀態/參數 ======
let drawing=false, last=null, currentTarget=null;
let pathLen=0, attemptStart=0;
let passCount=0;

let currentBand=null;      // { band, bandCount, fill, fillCount }
let locked=true;           // 未達成次數前，鎖定同一題

// *** 描紅區=整個畫布（無外圍空白） ***
const TRACE_RATIO       = 1.0;
const TRACE_ALPHA       = 0.15;
const TRACE_FONT        = `"TW-Kai","BiauKai","Kaiti TC","STKaiti","DFKai-SB","Noto Serif TC",serif`;

const INPUT_SIZE        = 128;
const BIN_THR           = 160;
const PEN_WIDTH_PX      = 40; // 更粗
const BAND_PX           = 10; // 走廊更寬
const PASS_COVERAGE     = 0.60;   // 門檻 60%
const MAX_LEAKAGE       = 0.18;   // 外漏上限
const MIN_PATH_LEN      = 180;
const MIN_DURATION_MS   = 700;

// ====== 資料載入（支援新版 cnkeys_all 與舊版 DATA）======
const TERM_ORDER = ["小一下", "小二上", "小二下", "小三上"];

function flattenLessons(ds, upto, code){
  const arr=[];
  if (!ds) return arr;
  for (const les of ds.lessons||[]){
    if (typeof upto === 'number' && les.lessonNo > upto) continue;
    for (const w of (les.words||[])){
      const char   = w['字'] ?? w.hanzi ?? w.char ?? w.word ?? w.c;
      const zhuyin = w['注音'] ?? w.zhuyin ?? w.bopomofo ?? w.phonetic ?? w.z;
      if (char && zhuyin){
        arr.push({
          char: String(char),
          zhuyin: String(zhuyin).trim(),
          lesson: les.lessonNo,
          term: code || ds.gradeCode,  // 來源學期（小一下/小二上/小二下/小三上）
          grade: ds.grade
        });
      }
    }
  }
  return arr;
}

function getDatasetByCode(code){
  if (window.cnkeys_all?.datasets){
    return window.cnkeys_all.datasets.find(d => d.gradeCode === code);
  }
  return null;
}

function buildPools(term, uptoLesson){
  // 當期池：此 term 的 1..N 課
  const curDS = getDatasetByCode(term);
  const currentPool = flattenLessons(curDS, uptoLesson, term);

  // 前期池：在 TERM_ORDER 之前的全部 term（完整所有課）
  const prevTerms = TERM_ORDER.filter(t => TERM_ORDER.indexOf(t) < TERM_ORDER.indexOf(term));
  const prevPool = [];
  for (const t of prevTerms){
    const ds = getDatasetByCode(t);
    prevPool.push(...flattenLessons(ds, undefined, t)); // 全部課，保留學期代碼
  }
  return { currentPool, prevPool, prevTerms };
}

// ====== 權重/預覽 UI ======
function getTerm(){ return termSel?.value || "小三上"; }
function getMaxLesson(){ const v=parseInt(lessonMaxSel?.value||'12',10); return Number.isFinite(v)?v:12; }
function getWeight(){ const v=parseInt(weightSel?.value||'75',10); return (v===50||v===75||v===100)?v:75; }

function updateWeightUI(){
  const term = getTerm();
  const isCross = TERM_ORDER.indexOf(term) > 0; // 不是最早期就會跨學期
  if (weightRow) weightRow.style.display = isCross ? 'flex' : 'none';

  const N = getMaxLesson();
  const W = getWeight();
  const remain = 100 - W;

  const { prevTerms } = buildPools(term, N);
  const prevLabel = prevTerms.length ? `（${prevTerms.join('、')}）` : '';
  const curRangeLabel = `${term}(1～${N})`;

  if (mixPreviewEl) {
    mixPreviewEl.textContent = isCross
      ? `${curRangeLabel} ${W}%｜其餘 ${remain}% ${prevLabel}`
      : `${term}(1～${N}) 100%`;
  }
}

// ====== 出題 ======
let CURRENT_POOL=[], PREV_POOL=[];

function refreshPools(){
  const term = getTerm();
  const N = getMaxLesson();
  const { currentPool, prevPool } = buildPools(term, N);
  CURRENT_POOL = currentPool;
  PREV_POOL = prevPool;
  updateWeightUI();
}

function pickOne(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

function nextWord(){
  refreshPools();

  // 沒資料就提示
  const allCount = CURRENT_POOL.length + PREV_POOL.length;
  if (allCount === 0){
    if (ZHUYIN_EL) ZHUYIN_EL.textContent='—';
    if (LESSON_EL) LESSON_EL.textContent='';
    clearCanvas();
    showInfo('沒有字可出題（請調整年級或範圍）');
    return;
  }

  // 決定抽題來源（權重）
  let fromCurrent = true;
  const isCross = PREV_POOL.length > 0;
  if (isCross){
    const W = getWeight(); // 當期 %
    fromCurrent = (Math.random()*100) < W;
    if (fromCurrent && CURRENT_POOL.length===0 && PREV_POOL.length>0) fromCurrent=false;
    if (!fromCurrent && PREV_POOL.length===0 && CURRENT_POOL.length>0) fromCurrent=true;
  }

  const pool = fromCurrent ? CURRENT_POOL : PREV_POOL;
  const item = pickOne(pool);
  currentTarget = item;

  if (ZHUYIN_EL) ZHUYIN_EL.textContent = item.zhuyin || '—';
  if (LESSON_EL) {
    LESSON_EL.textContent = (item.term && item.lesson)
      ? `（${item.term}第${item.lesson}課）`
      : (item.lesson ? `（第${item.lesson}課）` : '');
  }
  passCount = 0;
  locked = true;
  disableNext(true);
  clearCanvas();
  currentBand = makeTraceBand(currentTarget.char, INPUT_SIZE);
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
  CTX.font=`${Math.floor(b.w*0.92)}px ${TRACE_FONT}`;
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

// ====== 影像工具、走廊/本體、檢查 ======
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
  o.imageSmoothingEnabled=false; o.drawImage(tmp, 0,0,b.w,b.h, 0,0,size,size);
  const oimg=o.getImageData(0,0,size,size);
  const bin=binarize(oimg);
  return {mask:bin.mask, empty:false};
}
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

function checkTracing(){
  if(!currentTarget){ showFail('尚未出題'); return; }

  const dt = performance.now() - (attemptStart || performance.now());
  if (pathLen < MIN_PATH_LEN){ showFail('筆畫太少，請沿著描紅寫'); return; }
  if (dt < MIN_DURATION_MS){ showFail('寫得太快，請慢慢沿著描紅'); return; }

  const user = extractStableRegion(CTX, INPUT_SIZE);
  const userMask = user.mask;

  let userCount=0; for(let i=0;i<userMask.length;i++) userCount += userMask[i];
  if (userCount === 0){ showFail('沒有筆畫'); return; }

  currentBand = currentBand || makeTraceBand(currentTarget.char, INPUT_SIZE);
  const {band, bandCount, fill, fillCount} = currentBand;

  let coverFill=0, leak=0;
  for(let i=0;i<userMask.length;i++){
    if (userMask[i]) {
      if (fill[i]) coverFill++;
      if (!band[i]) leak++;
    }
  }
  const coverage = fillCount ? (coverFill / fillCount) : 0;
  const leakage  = userCount ? (leak / userCount) : 1;

  const PIXELS = INPUT_SIZE * INPUT_SIZE;
  const density = fillCount / PIXELS;
  const smudgeThreshold = 0.82 + Math.min(0.12, density * 0.40);
  const bandFillRatio   = bandCount ? (userCount / bandCount) : 1;

  const isSmudge = (bandFillRatio > smudgeThreshold) && (leakage > 0.30) && (coverage < 0.70);
  if (isSmudge){
    clearCanvas();
    showFail('塗抹太多，請沿著描紅書寫');
    return;
  }

  if (coverage >= PASS_COVERAGE && leakage <= MAX_LEAKAGE){
    passCount++;
    const need = getRequiredPasses();

    if (passCount >= need){
      incStats();
      locked = false;
      disableNext(false);
      showInfo(`🎉 達成 ${need}/${need} 次，已完成！自動換下一題…`);
      setTimeout(nextWord, 800);
    } else {
      const remain = Math.max(0, need - passCount);
      showInfo(`✅ 通過一次！還剩下 ${remain} 次就完成`);
      clearCanvas();
    }
  }else{
    clearCanvas();
    if (coverage < PASS_COVERAGE) showFail(`覆蓋不足 60%，請再試一次`);
    else showFail(`外漏過高，請沿著描紅邊縁書寫`);
  }
}

function getRequiredPasses(){
  const v = parseInt(reqPassesSel?.value || '3', 10);
  return Math.min(10, Math.max(1, isNaN(v)?3:v));
}

// ====== 即時覆蓋率（關閉；保留函式避免報錯）======
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

termSel?.addEventListener('change', ()=>{ nextWord(); });
lessonMaxSel?.addEventListener('change', ()=>{ nextWord(); });
weightSel?.addEventListener('change', ()=>{ updateWeightUI(); });

reqPassesSel?.addEventListener('change', ()=>{
  showProgress();
  if (passCount >= getRequiredPasses()) { locked = false; disableNext(false); }
});
btnRecognize?.addEventListener('click', checkTracing);

// 初始
updateWeightUI();
disableNext(true);
nextWord();
