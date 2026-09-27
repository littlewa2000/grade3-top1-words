// Allan Learning System v3 database aggregator
(function(){
  const source = window.CNKEYS_DATASETS || {};
  const order = ["小一下","小二上","小二下","小三上","小三下","小四上"];
  const keys = ["g1s2","g2s1","g2s2","g3s1","g3s2","g4s1"];
  const datasets = keys.map(k=>source[k]).filter(Boolean);
  const records=[];
  for(const ds of datasets){
    const pair = ds.gradeCode==="小一下"?[1,2]:ds.gradeCode==="小二上"?[2,1]:ds.gradeCode==="小二下"?[2,2]:ds.gradeCode==="小三上"?[3,1]:ds.gradeCode==="小三下"?[3,2]:ds.gradeCode==="小四上"?[4,1]:[null,null];
    for(const les of ds.lessons||[]){
      (les.words||[]).forEach((w,idx)=>{
        const item = w;
        item.id = item.id || pair[0]+"-"+pair[1]+"-"+String(les.lessonNo).padStart(2,"0")+"-"+String(idx+1).padStart(2,"0");
        item.char=item.char||item.字; item.zhuyin=item.zhuyin||item.注音||"";
        item.grade=pair[0]; item.semester=pair[1]; item.lesson=les.lessonNo; item.term=ds.gradeCode;
        item.words=Array.isArray(item.words)?item.words:[]; item.sentences=Array.isArray(item.sentences)?item.sentences:[];
        if(!("radical" in item)) item.radical=null; if(!("strokes" in item)) item.strokes=null;
        records.push(item);
      });
    }
  }
  const db={version:"3.0.0",termOrder:order,datasets,records,index:records};
  window.cnkeys_all=db; window.cnkeys_db=db; window.DATA=records;
})();
