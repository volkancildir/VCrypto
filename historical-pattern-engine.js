/* VCrypto historical analog engine v2
 * Similarity search uses only candles available at the decision time.
 * Outcomes: next-bar open, 2 ATR target / 1 ATR stop, 24-bar horizon,
 * conservative same-bar handling and round-trip transaction costs.
 */
(function(){
'use strict';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const median=a=>{if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
function atr(data,end,period=14){
 const a=[];for(let i=Math.max(1,end-period+1);i<=end;i++)a.push(Math.max(data[i].h-data[i].l,Math.abs(data[i].h-data[i-1].c),Math.abs(data[i].l-data[i-1].c)));
 return mean(a);
}
function features(data,start,len){
 const end=start+len,vols=data.slice(start,end).map(x=>Math.max(0,Number(x.v)||0)),vMed=Math.max(median(vols),1e-12),rows=[];
 for(let i=start;i<end;i++){
  const k=data[i],prev=i?data[i-1].c:k.o,range=Math.max(k.h-k.l,Math.abs(k.c)*1e-8),a=Math.max(atr(data,i),Math.abs(k.c)*1e-8);
  const ret=(k.c/Math.max(prev,1e-12)-1),body=(k.c-k.o)/range,upper=(k.h-Math.max(k.o,k.c))/range,lower=(Math.min(k.o,k.c)-k.l)/range;
  const v=Math.log(Math.max(Number(k.v)||0,1e-12)/vMed);
  const back=data[Math.max(0,i-9)],trend=(k.c/Math.max(back.c,1e-12)-1)/(a/Math.max(k.c,1e-12)*Math.sqrt(Math.max(1,i-Math.max(0,i-9))));
  const volRatio=a/Math.max(Math.abs(k.c),1e-12)*100;
  rows.push([ret/(a/Math.max(Math.abs(k.c),1e-12)),body,upper,lower,Math.max(-3,Math.min(3,v))*.35,Math.max(-3,Math.min(3,trend))*.35,Math.log(Math.max(volRatio,1e-8))*.25]);
 }
 return rows;
}
function dtw(a,b,band=5){
 const n=a.length,m=b.length,prev=new Float64Array(m+1),cur=new Float64Array(m+1);prev.fill(Infinity);prev[0]=0;
 for(let i=1;i<=n;i++){
  cur.fill(Infinity);
  for(let j=Math.max(1,i-band);j<=Math.min(m,i+band);j++){
   let d=0;for(let z=0;z<a[i-1].length;z++){const q=a[i-1][z]-b[j-1][z];d+=q*q}
   cur[j]=d+Math.min(prev[j],cur[j-1],prev[j-1]);
  }
  prev.set(cur);
 }
 return Math.sqrt(prev[m]/Math.max(n,m));
}
function outcome(data,index,dir,{horizon=24,targetR=2,stopR=1,costBps=20}={}){
 const entryBar=data[index+1];if(!entryBar)return null;
 const entry=entryBar.o,risk=atr(data,index);if(!(risk>0&&entry>0))return null;
 const target=entry+dir*targetR*risk,stop=entry-dir*stopR*risk,end=Math.min(data.length-1,index+1+horizon),cost=costBps/10000;
 for(let j=index+1;j<=end;j++){
  const k=data[j],th=dir>0?k.h>=target:k.l<=target,sh=dir>0?k.l<=stop:k.h>=stop;
  if(th&&sh)return {label:'loss',netR:-stopR-cost*entry/risk,exitIndex:j};
  if(sh)return {label:'loss',netR:-stopR-cost*entry/risk,exitIndex:j};
  if(th)return {label:'win',netR:targetR-cost*entry/risk,exitIndex:j};
 }
 const close=data[end].c,netR=dir*(close-entry)/risk-cost*entry/risk;
 return {label:'timeout',netR,exitIndex:end};
}
function wilsonLower(w,n,z=1.96){
 if(!n)return 0;const p=w/n,z2=z*z,den=1+z2/n;
 return (p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/den;
}
function scan(data,{window=30,horizon=24,costBps=20,minMatches=30,maxCandidates=180,maxNeighbors=60,maxDistance=1.15,minWinRate=.62,minWilson=.48,targetR=2,stopR=1}={}){
 const empty={status:'insufficient',matches:0,winRate:null,direction:0,confidence:null,reason:'Tarihsel benzerlik için yeterli geçmiş mum bulunamadı.'};
 if(!Array.isArray(data)||data.length<window+horizon+100)return empty;
 const end=data.length-1,current=features(data,end-window+1,window),candidates=[];
 const first=Math.max(window+30,Math.floor(data.length*.2)),last=end-horizon-2;
 for(let i=first;i<=last;i+=4){
  if(i+window>=end-horizon)continue;
  const dist=dtw(current,features(data,i-window+1,window));
  if(Number.isFinite(dist))candidates.push({index:i,distance:dist});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 const spaced=[];for(const c of candidates){if(spaced.every(x=>Math.abs(x.index-c.index)>horizon+window))spaced.push(c);if(spaced.length>=maxCandidates)break}
 const nearest=spaced.filter(x=>x.distance<=maxDistance).slice(0,maxNeighbors);
 if(nearest.length<minMatches)return {...empty,status:'no-signal',matches:nearest.length,distance:nearest[0]?.distance??null,reason:'Benzerlik eşiğini geçen yeterli tarihsel örnek yok. Zayıf eşleşmeler zorla kullanılmadı.'};
 let up=0,down=0,upN=0,downN=0;
 for(const x of nearest){
  const f=outcome(data,x.index,1,{horizon,costBps,targetR,stopR}),b=outcome(data,x.index,-1,{horizon,costBps,targetR,stopR});
  if(f){upN++;if(f.label==='win'&&f.netR>0)up++}
  if(b){downN++;if(b.label==='win'&&b.netR>0)down++}
 }
 const upRate=upN?up/upN:0,downRate=downN?down/downN:0,dir=upRate>=downRate?1:-1,rate=dir>0?upRate:downRate,n=dir>0?upN:downN,w=dir>0?up:down,lower=wilsonLower(w,n);
 const adjusted=rate,consistent=Math.abs(upRate-downRate)>=.12;
 const valid=n>=minMatches&&consistent&&adjusted>=minWinRate&&lower>=minWilson;
 return {status:valid?'signal':'no-signal',matches:nearest.length,winRate:adjusted*100,direction:valid?dir:0,rawDirection:dir,upRate:upRate*100,downRate:downRate*100,upSamples:upN,downSamples:downN,confidence:valid?Math.round(lower*100):null,wilsonLower:lower*100,reason:valid?'Benzerlik eşiğini geçen geçmiş örneklerde maliyet sonrası hedefe ulaşma oranı yeterli; yine de bağımsız test sonucu değildir.':'Örneklem, yön farkı veya %95 güven aralığının alt sınırı yeterli değil; sinyal üretilmedi.',distance:nearest[0].distance,maxDistance,horizon,costBps,targetR,stopR};
}
/* Strict chronological walk-forward: every test decision sees only earlier candles.
 * A later test outcome is scored once; no future candle enters its own analog search.
 */
function validate(data,{window=30,horizon=24,costBps=20,step=8,startFraction=.65,minMatches=30,maxDistance=1.15,targetR=2,stopR=1}={}){
 if(!Array.isArray(data)||data.length<window+horizon+180)return {status:'insufficient',tested:0,reason:'Bağımsız walk-forward test için geçmiş veri yetersiz.'};
 const start=Math.max(window+horizon+100,Math.floor(data.length*startFraction)),rows=[];let decisions=0;
 for(let i=start;i<data.length-horizon-1;i+=step){
  const prefix=data.slice(0,i+1),s=scan(prefix,{window,horizon,costBps,minMatches,maxDistance,targetR,stopR});
  if(s.status!=='signal')continue;
  decisions++;const result=outcome(data,i,s.direction,{horizon,costBps,targetR,stopR});
  if(result)rows.push({index:i,direction:s.direction,label:result.label,netR:result.netR,matches:s.matches,winRate:s.winRate});
 }
 const wins=rows.filter(x=>x.label==='win'&&x.netR>0).length,n=rows.length,rate=n?wins/n*100:0,lower=wilsonLower(wins,n)*100,netR=rows.reduce((a,x)=>a+x.netR,0);
 return {status:n>=30&&lower>=50&&netR>0?'pass':n?'fail':'no-signals',tested:n,signals:decisions,winRate:rate,wilsonLower:lower,netR,expectancyR:n?netR/n:0,coverage:decisions/Math.max(1,Math.ceil((data.length-horizon-1-start)/step))*100,from:data[start]?.t,to:data[Math.min(data.length-1,start+(Math.max(0,Math.ceil((data.length-horizon-1-start)/step)-1))*step)]?.t,step,horizon,costBps,reason:n<30?'Bağımsız testte en az 30 sinyal oluşmadı.':lower<50?'%95 güven aralığının alt sınırı %50 eşiğini geçmedi.':netR<=0?'Maliyet sonrası toplam net R pozitif değil.':'Bu tarihsel test aralığında önceden belirlenmiş eşikler karşılandı; ileriye dönük garanti değildir.'};
}
window.VCryptoHistoricalPattern={scan,validate};
})();