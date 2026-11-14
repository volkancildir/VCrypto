/* VCrypto shared graph/card target analysis. Browser + Node compatible. */
(function(root){
'use strict';
function pivots(data,type){
 const out=[],radius=2;
 for(let i=radius;i<data.length-radius;i++){
  let ok=true;const value=type==='high'?data[i].h:data[i].l;
  for(let j=i-radius;j<=i+radius;j++){if(j===i)continue;const other=type==='high'?data[j].h:data[j].l;if(type==='high'?other>=value:other<=value){ok=false;break}}
  if(ok)out.push({i,p:value});
 }
 return out;
}
function analyze(data){
 const last=data[data.length-1],close=last.c,highs=pivots(data,'high'),lows=pivots(data,'low');
 const window=data.slice(-Math.min(30,data.length)),hi=Math.max(...window.map(x=>x.h)),lo=Math.min(...window.map(x=>x.l)),range=Math.max(hi-lo,close*.005);
 const tr=[];for(let i=Math.max(1,data.length-15);i<data.length;i++)tr.push(Math.max(data[i].h-data[i].l,Math.abs(data[i].h-data[i-1].c),Math.abs(data[i].l-data[i-1].c)));
 const atr=tr.reduce((a,b)=>a+b,0)/Math.max(1,tr.length);
 const avg=(arr)=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
 const vols=data.slice(-21,-1).map(x=>x.v),volAvg=avg(vols),volRecent=avg(data.slice(-5).map(x=>x.v)),volumeRatio=volAvg>0?volRecent/volAvg:1;
 const closes=data.map(x=>x.c),rsiPeriod=14;let gains=0,losses=0;
 for(let i=Math.max(1,closes.length-rsiPeriod);i<closes.length;i++){const change=closes[i]-closes[i-1];if(change>0)gains+=change;else losses-=change}
 const rsi=losses===0?100:100-(100/(1+(gains/Math.max(losses,1e-12))));
 const emaFast=avg(closes.slice(-9)),emaSlow=avg(closes.slice(-21)),trend=emaFast>emaSlow?1:-1;
 const recentH=highs.slice(-4),recentL=lows.slice(-4);
 let direction=trend,name='Yatay kanal / net formasyon yok',confidence=42,reason='Net bir klasik formasyon teyit edilmedi. Yön değerlendirmesi trend, momentum ve volatiliteyle desteklenen alternatif senaryodur.',neck=null,height=range*.6,confirmed=false,patternFound=false;
 const tol=Math.max(close*.018,atr*.65);
 // Çift tepe/dip: iki dönüş noktasının benzerliği, aralık ve boyun çizgisi kontrol edilir.
 if(recentH.length>=2){
  const a=recentH[recentH.length-2],b=recentH[recentH.length-1],between=data.slice(a.i,b.i+1),neckLow=Math.min(...between.map(x=>x.l));
  if(b.i-a.i>=4&&Math.abs(a.p-b.p)<=tol&&between.length>=5){
   patternFound=true;neck=neckLow;height=Math.max(a.p,b.p)-neck;
   if(close<neckLow){direction=-1;name='Çift tepe · aşağı kırılım teyitli';confidence=62;confirmed=true;reason='Benzer seviyelerde iki tepe oluştu ve fiyat aradaki dip seviyesinin altında kapandı.'}
   else {direction=-1;name='Çift tepe adayı · kırılım bekleniyor';confidence=46;reason='İki tepe benzer seviyede; ancak boyun çizgisi aşağı kırılmadı. Bu nedenle formasyon henüz teyitli değil.'}
  }
 }
 if(!patternFound&&recentL.length>=2){
  const a=recentL[recentL.length-2],b=recentL[recentL.length-1],between=data.slice(a.i,b.i+1),neckHigh=Math.max(...between.map(x=>x.h));
  if(b.i-a.i>=4&&Math.abs(a.p-b.p)<=tol&&between.length>=5){
   patternFound=true;neck=neckHigh;height=neck-Math.min(a.p,b.p);
   if(close>neckHigh){direction=1;name='Çift dip · yukarı kırılım teyitli';confidence=62;confirmed=true;reason='Benzer seviyelerde iki dip oluştu ve fiyat aradaki tepe seviyesinin üzerinde kapandı.'}
   else {direction=1;name='Çift dip adayı · kırılım bekleniyor';confidence=46;reason='İki dip benzer seviyede; ancak boyun çizgisi yukarı kırılmadı. Bu nedenle formasyon henüz teyitli değil.'}
  }
 }
 // Omuz-baş-omuz ve ters formasyon; başın iki omuzdan anlamlı biçimde ayrılması aranır.
 if(!patternFound&&recentH.length>=3){
  const [a,b,c]=recentH.slice(-3),between=data.slice(a.i,c.i+1),neckLow=Math.min(...between.map(x=>x.l));
  if(b.i>a.i&&c.i>b.i&&b.p>a.p+atr*.5&&b.p>c.p+atr*.5&&Math.abs(a.p-c.p)<=Math.max(close*.04,atr*1.5)){
   patternFound=true;neck=neckLow;height=b.p-neckLow;
   if(close<neckLow){direction=-1;name='Omuz-baş-omuz · kırılım teyitli';confidence=64;confirmed=true;reason='Baş iki omuzdan yüksek ve boyun çizgisi aşağı kırılmış durumda.'}
   else {direction=-1;name='Omuz-baş-omuz adayı · teyit bekliyor';confidence=47;reason='Omuz-baş-omuz geometrisi oluşuyor; boyun çizgisi kırılmadan sinyal teyitli sayılmaz.'}
  }
 }
 if(!patternFound&&recentL.length>=3){
  const [a,b,c]=recentL.slice(-3),between=data.slice(a.i,c.i+1),neckHigh=Math.max(...between.map(x=>x.h));
  if(b.i>a.i&&c.i>b.i&&b.p<a.p-atr*.5&&b.p<c.p-atr*.5&&Math.abs(a.p-c.p)<=Math.max(close*.04,atr*1.5)){
   patternFound=true;neck=neckHigh;height=neckHigh-b.p;
   if(close>neckHigh){direction=1;name='Ters omuz-baş-omuz · kırılım teyitli';confidence=64;confirmed=true;reason='Baş iki omuzdan aşağıda ve boyun çizgisi yukarı kırılmış durumda.'}
   else {direction=1;name='Ters omuz-baş-omuz adayı · teyit bekliyor';confidence=47;reason='Ters omuz-baş-omuz geometrisi oluşuyor; boyun çizgisi kırılmadan sinyal teyitli sayılmaz.'}
  }
 }
 // Üçgen: pivot tepeler/dipler birbirine yaklaşırken kırılım veya bekleme durumu belirlenir.
 if(!patternFound&&recentH.length>=3&&recentL.length>=3){
  const hs=recentH.slice(-3),ls=recentL.slice(-3),hDrop=hs[0].p-hs[2].p,lRise=ls[2].p-ls[0].p;
  const contracting=hDrop>atr*.35&&lRise>atr*.35&&hs[0].i<hs[1].i&&hs[1].i<hs[2].i&&ls[0].i<ls[1].i&&ls[1].i<ls[2].i;
  const flatHigh=Math.max(...hs.map(p=>p.p))-Math.min(...hs.map(p=>p.p))<=Math.max(close*.012,atr*.8);
  const flatLow=Math.max(...ls.map(p=>p.p))-Math.min(...ls.map(p=>p.p))<=Math.max(close*.012,atr*.8);
  const upper=avg(hs.map(p=>p.p)),lower=avg(ls.map(p=>p.p));
  if(contracting&&upper>lower){
   patternFound=true;neck=direction>0?upper:lower;height=Math.max((upper-lower)*.75,atr);
   if(close>Math.max(...hs.map(p=>p.p))){direction=1;name='Simetrik üçgen · yukarı kırılım';confidence=59;confirmed=true;reason='Alçalan tepeler ve yükselen diplerden oluşan sıkışma yukarı kırıldı.'}
   else if(close<Math.min(...ls.map(p=>p.p))){direction=-1;name='Simetrik üçgen · aşağı kırılım';confidence=59;confirmed=true;reason='Alçalan tepeler ve yükselen diplerden oluşan sıkışma aşağı kırıldı.'}
   else {direction=trend;name='Simetrik üçgen · kırılım bekleniyor';confidence=45;reason='Tepeler ve dipler birbirine yaklaşıyor; yön, sınırların dışında kapanışla netleşebilir.'}
  }else if(flatHigh&&lRise>atr*.5){
   patternFound=true;neck=upper;height=Math.max(upper-ls[0].p,atr);
   if(close>Math.max(...hs.map(p=>p.p))){direction=1;name='Yükselen üçgen · yukarı kırılım';confidence=60;confirmed=true;reason='Yatay direnç ve yükselen dipler yapısı direnç üstü kapanışla kırıldı.'}
   else {direction=1;name='Yükselen üçgen adayı · teyit bekliyor';confidence=46;reason='Yatay direnç ve yükselen dipler görülüyor; direnç kırılmadan teyit yok.'}
  }else if(flatLow&&hDrop>atr*.5){
   patternFound=true;neck=lower;height=Math.max(hs[0].p-lower,atr);
   if(close<Math.min(...ls.map(p=>p.p))){direction=-1;name='Alçalan üçgen · aşağı kırılım';confidence=60;confirmed=true;reason='Yatay destek ve alçalan tepeler yapısı destek altı kapanışla kırıldı.'}
   else {direction=-1;name='Alçalan üçgen adayı · teyit bekliyor';confidence=46;reason='Yatay destek ve alçalan tepeler görülüyor; destek kırılmadan teyit yok.'}
  }
 }
 // Formasyon yoksa basit yön sinyali; son 20 kapanışın değişimi ve momentum birlikte kullanılır.
 if(!patternFound){
  const n=Math.min(20,data.length),change=close/data[data.length-n].c-1;
  direction=Math.abs(change)>.02?(change>0?1:-1):trend;
  name=Math.abs(change)>.025?(change>0?'Yükselen eğilim · devam senaryosu':'Düşen eğilim · devam senaryosu'):'Yatay sıkışma · kırılım bekleniyor';
  confidence=Math.abs(change)>.05?52:41;height=Math.max(range*.55,atr*1.5,close*.012);
 }
 // Hacim ve RSI yalnızca teyit puanını etkiler; tek başlarına formasyon oluşturmazlar.
 if(confirmed){confidence+=volumeRatio>=1.25?8:volumeRatio<.75?-5:0}
 else if(patternFound&&volumeRatio>=1.5)confidence+=2;
 if(direction>0&&rsi>=50&&rsi<=72)confidence+=4;
 else if(direction<0&&rsi<=50&&rsi>=28)confidence+=4;
 else if((direction>0&&rsi>78)||(direction<0&&rsi<22))confidence-=4;
 confidence=Math.max(35,Math.min(78,Math.round(confidence)));
 if(confirmed){
  reason+=' Son 5 mumun ortalama hacmi, önceki 20 mumla karşılaştırıldı ('+volumeRatio.toFixed(2)+'×); RSI(14) '+Math.round(rsi)+'. Hacim teyidi tek başına yeterli değildir.';
 }else{
  reason+=' Hacim oranı '+volumeRatio.toFixed(2)+'×, RSI(14) '+Math.round(rsi)+'. “Heuristik güven” istatistiksel başarı olasılığı değildir.';
 }
 height=Math.max(height||0,atr*1.5,close*.005);
 // Hedef 1: formasyon varsa klasik ölçülü hareket; yoksa ATR tabanlı senaryo.
 const targetBase=patternFound&&Number.isFinite(neck)?neck:close;
 let target1=direction>0?targetBase+height:targetBase-height;
 // Hedefler mevcut fiyatın yanlış tarafında kalamaz; formasyon ölçümü fiyatı geçmişse kalan mesafe korunarak ileri taşınır.
 if(direction>0&&!(target1>close))target1=close+Math.max(height,atr);
 if(direction<0&&!(target1<close))target1=close-Math.max(height,atr);
 // Hedef 2 uzatması: geçmişteki benzer yönlü kırılım benzeri hareketlerde ATR uzatmalarını test eder.
 const optimizeExtension=(series,dir,atrNow)=>{
  const candidates=[0.75,1,1.25,1.5,1.618,2,2.5,3],samples=[];
  for(let i=30;i<series.length-7;i++){
   const hist=series.slice(Math.max(0,i-14),i),bar=series[i];
   const priorHigh=Math.max(...hist.map(x=>x.h)),priorLow=Math.min(...hist.map(x=>x.l));
   const breaks=dir>0?bar.c>priorHigh&&bar.v>=avg(hist.slice(-5).map(x=>x.v)):bar.c<priorLow&&bar.v>=avg(hist.slice(-5).map(x=>x.v));
   if(!breaks)continue;
   const localTr=[];for(let j=Math.max(1,i-14);j<=i;j++)localTr.push(Math.max(series[j].h-series[j].l,Math.abs(series[j].h-series[j-1].c),Math.abs(series[j].l-series[j-1].c)));
   const localAtr=avg(localTr);if(!(localAtr>0))continue;
   const future=series.slice(i+1,i+7);if(future.length<6)continue;
   const favorable=dir>0?Math.max(...future.map(x=>x.h))-bar.c:bar.c-Math.min(...future.map(x=>x.l));
   const adverse=dir>0?bar.c-Math.min(...future.map(x=>x.l)):Math.max(...future.map(x=>x.h))-bar.c;
   samples.push({favorable:favorable/localAtr,adverse:adverse/localAtr});
  }
  if(samples.length<8)return {multiple:1.5,count:samples.length,optimized:false};
  let best={multiple:1.5,score:-Infinity};
  for(const multiple of candidates){
   let wins=0,losses=0;
   for(const s of samples){if(s.favorable>=multiple&&s.adverse<1)wins++;else if(s.adverse>=1&&s.favorable<multiple)losses++}
   const score=(wins-losses)/samples.length;
   if(score>best.score)best={multiple,score};
  }
  return {multiple:best.multiple,count:samples.length,optimized:true};
 };
 const extension=optimizeExtension(data,direction,atr);
 let target2=target1+direction*Math.max(atr*extension.multiple,patternFound?height*.25:atr);
 if(direction>0&&!(target2>target1))target2=target1+Math.max(atr,height*.25);
 if(direction<0&&!(target2<target1))target2=target1-Math.max(atr,height*.25);
 let stop;
 if(patternFound&&direction>0&&recentL.length)stop=Math.min(...recentL.slice(-2).map(p=>p.p))-atr*.25;
 else if(patternFound&&direction<0&&recentH.length)stop=Math.max(...recentH.slice(-2).map(p=>p.p))+atr*.25;
 else stop=direction>0?close-atr*1.5:close+atr*1.5;
 reason+=' Hedef 1 '+(patternFound?'formasyonun ölçülü hareketine':'ATR senaryosuna')+' göre hesaplandı. Hedef 2 için geçmişteki '+extension.count+' kırılım benzeri örnek test edildi; uzatma '+extension.multiple+' ATR'+(extension.optimized?' (örneklem içi optimizasyon)':' (yeterli örnek olmadığı için varsayılan)')+'. Bu test bağımsız başarı garantisi değildir.';
 return {direction,name,confidence,reason,neck,target1,target2,stop,hi,lo,atr,volumeRatio,rsi,confirmed,targetMethod:patternFound?'pattern-measured-move':'atr-scenario',extensionMultiple:extension.multiple,extensionSamples:extension.count};
}
root.VCryptoTargetEngine={analyze};
})(typeof globalThis!=='undefined'?globalThis:window);
