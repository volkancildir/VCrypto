/* VCrypto historical analog matcher: DTW shape search with conservative outcome labeling. */
(function(){
'use strict';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
function atr(data,end,period=14){const a=[];for(let i=Math.max(1,end-period+1);i<=end;i++)a.push(Math.max(data[i].h-data[i].l,Math.abs(data[i].h-data[i-1].c),Math.abs(data[i].l-data[i-1].c)));return mean(a)}
function features(data,start,len){
 const base=data[start].c,rows=[];
 for(let i=start;i<start+len;i++){
  const k=data[i],prev=i?data[i-1].c:k.o,range=Math.max(k.h-k.l,Math.abs(k.c)*1e-8);
  rows.push([(k.c/prev-1)*100,((k.c-k.o)/range),((k.h-Math.max(k.o,k.c))/range),((Math.min(k.o,k.c)-k.l)/range)]);
 }
 return rows;
}
function dtw(a,b,band=5){
 const n=a.length,m=b.length,prev=new Float64Array(m+1),cur=new Float64Array(m+1);prev.fill(Infinity);prev[0]=0;
 for(let i=1;i<=n;i++){cur.fill(Infinity);for(let j=Math.max(1,i-band);j<=Math.min(m,i+band);j++){let d=0;for(let z=0;z<a[i-1].length;z++){const q=a[i-1][z]-b[j-1][z];d+=q*q}cur[j]=d+Math.min(prev[j],cur[j-1],prev[j-1])}prev.set(cur)}
 return Math.sqrt(prev[m]/Math.max(n,m));
}
function outcome(data,index,dir,horizon=24,targetR=2,stopR=1){
 const entryBar=data[index+1];if(!entryBar)return null;const entry=entryBar.o,risk=atr(data,index);
 if(!(risk>0))return null;const target=entry+dir*targetR*risk,stop=entry-dir*stopR*risk,end=Math.min(data.length-1,index+1+horizon);
 for(let j=index+1;j<=end;j++){const k=data[j],th=dir>0?k.h>=target:k.l<=target,sh=dir>0?k.l<=stop:k.h>=stop;if(th&&sh)return 'loss';if(sh)return 'loss';if(th)return 'win'}
 return 'timeout';
}
function scan(data,{window=30,horizon=24,costBps=20,minMatches=25,maxCandidates=500}={}){
 if(!Array.isArray(data)||data.length<window+horizon+80)return {status:'insufficient',matches:0,winRate:null,direction:0,confidence:null,reason:'Tarihsel benzerlik için yeterli geçmiş mum bulunamadı.'};
 const end=data.length-1,current=features(data,end-window+1,window),candidates=[];
 const first=Math.max(window+20,Math.floor(data.length*.25)),last=end-horizon-2;
 for(let i=first;i<=last;i+=2){
  if(i+window>=end-horizon)continue;
  const dist=dtw(current,features(data,i-window+1,window));
  if(Number.isFinite(dist))candidates.push({index:i,distance:dist});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 const chosen=[];for(const c of candidates){if(chosen.every(x=>Math.abs(x.index-c.index)>horizon+window/2))chosen.push(c);if(chosen.length>=maxCandidates)break}
 const nearest=chosen.slice(0,Math.min(80,chosen.length));
 if(!nearest.length)return {status:'insufficient',matches:0,winRate:null,direction:0,confidence:null,reason:'Karşılaştırılabilir geçmiş örnek bulunamadı.'};
 let up=0,down=0,upN=0,downN=0;
 for(const x of nearest){const f=outcome(data,x.index,1,horizon),b=outcome(data,x.index,-1,horizon);if(f){upN++;if(f==='win')up++}if(b){downN++;if(b==='win')down++}}
 const upRate=upN?up/upN:0,downRate=downN?down/downN:0;
 const dir=upRate>=downRate?1:-1,rate=dir>0?upRate:downRate,n=dir>0?upN:downN;
 const costPenalty=Math.min(.08,(costBps/10000)*4);
 const adjusted=Math.max(0,rate-costPenalty);
 const consistent=Math.abs(upRate-downRate)>=.12;
 const valid=nearest.length>=minMatches&&n>=minMatches&&consistent&&adjusted>=.62;
 return {status:valid?'signal':'no-signal',matches:nearest.length,winRate:adjusted*100,direction:valid?dir:0,rawDirection:dir,upRate:upRate*100,downRate:downRate*100,upSamples:upN,downSamples:downN,confidence:valid?Math.round(adjusted*100):null,reason:valid?'Benzer geçmiş örneklerde aynı yönlü hedef/stop sonucu daha tutarlı.':'Benzer örnek sayısı, yön farkı veya tarihsel başarı eşiği yeterli değil; bu nedenle sinyal üretilmedi.',distance:nearest[0].distance,horizon,costBps};
}
window.VCryptoHistoricalPattern={scan};
})();