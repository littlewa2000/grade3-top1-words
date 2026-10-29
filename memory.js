/* 國字記憶練習：獨立儲存，不覆寫既有統計 */
(function(){
'use strict';
const KEY='cnkeys_memory_v1', DAY=86400000;
const $=id=>document.getElementById(id);
const dateKey=d=>{const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
const today=()=>dateKey(Date.now());
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch{return {}}}
function save(x){try{localStorage.setItem(KEY,JSON.stringify(x));return true}catch{status('儲存失敗：請確認 Safari 沒有停用網站儲存。');return false}}
function dueDate(days){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+days);return dateKey(d)}
function status(s){if($('memoryFeedback'))$('memoryFeedback').textContent=s}
let target=null,phase='idle',mistakes=0,first=null,queue=[],index=0,seen=new Set();
function eligiblePools(){
 const term=$('termSelect')?.value,limit=Number($('lessonMax')?.value||12);
 const terms=window.cnkeys_all?.termOrder||[];
 const ds=window.cnkeys_all?.datasets||[];
 function collect(d, upto){
  const rows=[];
  for(const l of d.lessons||[])if(upto===null||l.lessonNo<=upto)for(const w of l.words||[]){
   const char=String(w['字']??w.hanzi??w.char??w.word??w.c??'');
   if(!char)continue;
   rows.push({id:w.id||d.gradeCode+'-'+l.lessonNo+'-'+char,char,zhuyin:String(w['注音']??w.zhuyin??w.bopomofo??w.phonetic??w.z??''),words:w.words||[],term:d.gradeCode,lesson:l.lessonNo});
  }
  return rows;
 }
 const pos=terms.indexOf(term);
 return {
  current:ds.filter(d=>d.gradeCode===term).flatMap(d=>collect(d,limit)),
  previous:pos<1?[]:ds.filter(d=>terms.indexOf(d.gradeCode)>=0&&terms.indexOf(d.gradeCode)<pos).flatMap(d=>collect(d,null))
 };
}
function eligible(){const p=eligiblePools();return [...p.current,...p.previous]}
function shuffle(items){
 const out=[...items];
 for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
 return out;
}
function weightedQueue(pools,db,count=5){
 const weight=Number($('currWeight')?.value||75);
 const current=shuffle(pools.current),previous=shuffle(pools.previous);
 const result=[],used=new Set();
 function take(pool){
  const available=pool.filter(x=>!used.has(x.id));
  if(!available.length)return false;
  const due=available.filter(x=>db[x.id]&&db[x.id].nextReview<=today());
  const unseen=available.filter(x=>!db[x.id]);
  const rest=available.filter(x=>db[x.id]&&db[x.id].nextReview>today());
  const chosen=(due[0]||unseen[0]||rest[0]);
  used.add(chosen.id);result.push(chosen);return true;
 }
 while(result.length<count&&used.size<current.length+previous.length){
  const preferCurrent=!previous.length||(current.length>0&&Math.random()*100<weight);
  if(!(preferCurrent?take(current):take(previous)))if(!(preferCurrent?take(previous):take(current)))break;
 }
 return result;
}
function updateCounts(){
 const records=read(),all=eligible(),due=all.filter(x=>records[x.id]&&records[x.id].nextReview<=today());
 if($('memoryDueCount'))$('memoryDueCount').textContent=String(due.length);
 if($('memoryLearnedCount'))$('memoryLearnedCount').textContent=String(all.filter(x=>records[x.id]).length);
}
function display(){
 const hint=$('memoryHint'),answer=$('memoryAnswer'),check=$('memoryCheck'),next=$('memoryNext'),reveal=$('memoryReveal');
 if(!target){hint.textContent='請開始記憶練習';answer.hidden=true;check.hidden=true;next.hidden=true;reveal.hidden=true;return}
 const words=(target.words||[]).filter(w=>String(w).includes(target.char));
 $('memoryMeta').textContent=target.term+' 第'+target.lesson+'課';
 if(phase==='study'){
 hint.textContent=target.char;
 $('memoryPrompt').textContent='先觀察字形與部件，再按「遮住國字」。'+(words.length?' 例詞：'+words.slice(0,2).join('、'):'');
 }else{
 hint.textContent=phase==='reveal'?target.char:'？';
 $('memoryPrompt').textContent=phase==='reveal'?'請核對剛才寫的字，誠實評估是否正確。':'請依注音默寫：'+(target.zhuyin||'（無注音）')+(words.length?'｜詞語提示：'+words[0].replace(target.char,'＿'):'');
 }
 answer.hidden=phase!=='reveal';check.hidden=phase!=='study';reveal.hidden=phase!=='write';next.hidden=phase!=='graded';
 $('memoryCanvas').hidden=phase==='study';
 $('memoryGrade').hidden=phase!=='reveal';
 $('memoryClear').hidden=phase==='study'||phase==='graded';
}
function clear(){const c=$('memoryCanvas');const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.strokeStyle='#cbd5e1';g.strokeRect(1,1,c.width-2,c.height-2)}
function start(){
 location.hash='#memory';
 const pools=eligiblePools(),db=read();
 queue=weightedQueue(pools,db);
 index=0;seen.clear();
 if(!queue.length){target=null;display();status('目前選擇的年級與課次沒有生字，請回設定調整範圍。');return}
 load();
}
function load(){
 target=queue[index]||null;phase=target?'study':'idle';mistakes=0;first=null;
 clear();display();status(target?'第 '+(index+1)+' / '+queue.length+' 字：先觀察，再遮字默寫。':'本輪練習完成！');
}
function grade(correct){
 if(phase!=='reveal'||!target)return;
 if(first===null)first=correct;
 if(!correct){
 mistakes++;phase='write';clear();display();status('已記錄一次錯誤。請再默寫一次，核對後評分。');return;
 }
 const db=read(),old=db[target.id]||{attempts:0,firstCorrect:0,errors:0,level:0,history:[]};
 const clean=first===true&&mistakes===0;
 const level=clean?Math.min(5,(old.level||0)+1):0;
 const intervals=[1,1,3,7,14,30];
 const entry={date:today(),firstCorrect:clean,errors:mistakes,review:!!old.attempts};
 db[target.id]={...old,attempts:old.attempts+1,firstCorrect:old.firstCorrect+(clean?1:0),errors:old.errors+mistakes,level,lastReviewed:today(),nextReview:dueDate(intervals[level]),history:[...(old.history||[]).slice(-49),entry]};
 if(save(db)){phase='graded';display();status('已儲存：'+(clean?'首次默寫正確':'經更正後完成')+'。下次複習：'+db[target.id].nextReview);updateCounts()}
}
function next(){if(phase!=='graded')return;index++;load()}
function init(){
 const canvas=$('memoryCanvas');if(!canvas)return;
 let drawing=false,last=null,activePointer=null;
 const ctx=canvas.getContext('2d');
 canvas.style.touchAction='none';
 function point(e){
  const r=canvas.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};
 }
 function beginStroke(e){
  if(phase!=='write'||(drawing&&activePointer!==e.pointerId))return;
  const p=point(e);if(!p)return;
  drawing=true;activePointer=e.pointerId;last=p;
  ctx.strokeStyle='#111827';ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.arc(p.x,p.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fillStyle='#111827';ctx.fill();
  try{canvas.setPointerCapture(e.pointerId)}catch(_){}
  if(e.cancelable)e.preventDefault();
 }
 function moveStroke(e){
  if(!drawing||phase!=='write'||activePointer!==e.pointerId)return;
  const p=point(e);if(!p)return;
  ctx.strokeStyle='#111827';ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;
  if(e.cancelable)e.preventDefault();
 }
 function endStroke(e){
  if(activePointer!==e.pointerId)return;
  drawing=false;last=null;activePointer=null;
  try{if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)}catch(_){}
 }
 canvas.addEventListener('pointerdown',beginStroke,{passive:false});
 canvas.addEventListener('pointermove',moveStroke,{passive:false});
 canvas.addEventListener('pointerup',endStroke);
 canvas.addEventListener('pointercancel',endStroke);
 canvas.addEventListener('lostpointercapture',()=>{drawing=false;last=null;activePointer=null});
 // Older iOS Safari: touch events are a fallback only when PointerEvent is unavailable.
 if(!window.PointerEvent){
  let touchId=null;
  function touchPoint(e){const t=[...e.changedTouches].find(x=>x.identifier===touchId)||e.changedTouches[0];return t?{clientX:t.clientX,clientY:t.clientY,pointerId:t.identifier,cancelable:e.cancelable,preventDefault:()=>e.preventDefault()}:null}
  canvas.addEventListener('touchstart',e=>{const t=e.changedTouches[0];if(!t)return;touchId=t.identifier;beginStroke(touchPoint(e));if(e.cancelable)e.preventDefault()},{passive:false});
  canvas.addEventListener('touchmove',e=>{if(touchId===null)return;moveStroke(touchPoint(e));if(e.cancelable)e.preventDefault()},{passive:false});
  const stop=e=>{if(touchId===null)return;endStroke({pointerId:touchId});touchId=null;if(e.cancelable)e.preventDefault()};
  canvas.addEventListener('touchend',stop,{passive:false});canvas.addEventListener('touchcancel',stop,{passive:false});
 }
 const openMemory=()=>{if(location.hash==='#memory')start()};
 // 直接點擊分頁也要啟動，不依賴 Safari 是否派送 hashchange。
 $('tabMemoryBtn').addEventListener('click',()=>start());
 window.addEventListener('hashchange',openMemory);
 $('memoryCheck').addEventListener('click',()=>{phase='write';clear();display();status('國字已遮住，請在白色畫布上默寫。')});
 $('memoryReveal').addEventListener('click',()=>{phase='reveal';display();status('請對照答案評分；若寫錯，選「需要再寫」。')});
 $('memoryCorrect').addEventListener('click',()=>grade(true));
 $('memoryWrong').addEventListener('click',()=>grade(false));
 $('memoryNext').addEventListener('click',next);
 $('memoryClear').addEventListener('click',clear);
 $('termSelect').addEventListener('change',updateCounts);
 $('lessonMax').addEventListener('change',updateCounts);
 $('currWeight')?.addEventListener('change',updateCounts);
 updateCounts();display();clear();
 if(location.hash==='#memory')start();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();