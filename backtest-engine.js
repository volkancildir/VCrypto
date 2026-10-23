/* VCrypto walk-forward backtest v1
 * Uses confirmed library events only; entry next candle open; fixed 2 ATR target / 1 ATR stop.
 * No in-sample parameter optimization. Same-candle target/stop is conservatively booked as a stop.
 */
(function(){
'use strict';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const median=a=>{if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
function atrAt(data,i,period=14){const trs=[];for(let j=Math.max(1,i-period+1);j<=i;j++)trs.push(Math.max(data[j].h-data[j].l,Math.abs(data[j].h-data[j-1].c),Math.abs(data[j].l-data[j-1].c)));return mean(trs)}
function canonical(name){return String(name).replace(/\s*[·•].*$/,'').replace(/\s+adayı$/i,'').replace(/\s+teyitli$/i,'').replace(/\s+teyit bekliyor$/i,'').replace(/\s+kırılım.*$/i,'').trim()}
function run(data,{costBps=20,horizon=24,targetR=2,stopR=1,progress}={}){
 if(!window.VCryptoPatternEngine||!Array.isArray(data)||data.length<100)throw Error('Güvenilir ilk tarama için en az 100 mum gerekiyor.');
 const signals=[],minBars=60,lastSignal=data.length-horizon-2;
 if(lastSignal<minBars+5)throw Error('Seçilen maksimum işlem süresi için yeterli mum yok. Daha kısa işlem süresi veya daha uzun geçmiş sağlayan bir zaman dilimi seç.');
 for(let i=minBars;i<=lastSignal;i++){
  if(progress&&i%50===0)progress(i,lastSignal);
  const history=data.slice(0,i+1),found=window.VCryptoPatternEngine.scan(history);
  const atr=atrAt(data,i);if(!(atr>0))continue;
  for(const p of found){if(!p.confirmed||!p.direction)continue;signals.push({index:i,barTime:data[i].t,name:canonical(p.name)||p.name,rawName:p.name,group:p.group,direction:p.direction,atr,score:p.score})}
 }
 const byPattern=new Map();
 for(const s of signals){const key=s.group+'::'+s.name;if(!byPattern.has(key))byPattern.set(key,[]);byPattern.get(key).push(s)}
 const trades=[];
 for(const [key,list] of byPattern){
  list.sort((a,b)=>a.index-b.index);let blockedUntil=-1;
  for(const s of list){
   if(s.index<=blockedUntil)continue;
   const entryBar=data[s.index+1];if(!entryBar)continue;
   const entry=entryBar.o,dir=s.direction,target=entry+dir*targetR*s.atr,stop=entry-dir*stopR*s.atr;
   let exitPrice=null,exitIndex=null,outcome='Horizon',grossR=0;
   const end=Math.min(data.length-1,s.index+1+horizon);
   for(let j=s.index+1;j<=end;j++){
    const k=data[j],targetHit=dir>0?k.h>=target:k.l<=target,stopHit=dir>0?k.l<=stop:k.h>=stop;
    if(targetHit&&stopHit){exitPrice=stop;exitIndex=j;outcome='Stop (aynı mum belirsiz; temkinli)';grossR=-stopR;break}
    if(stopHit){exitPrice=stop;exitIndex=j;outcome='Stop';grossR=-stopR;break}
    if(targetHit){exitPrice=target;exitIndex=j;outcome='Hedef';grossR=targetR;break}
   }
   if(exitPrice===null){exitIndex=end;exitPrice=data[end].c;grossR=dir*(exitPrice-entry)/s.atr}
   const costPct=costBps/10000,netReturn=dir*(exitPrice-entry)/entry-costPct,netR=netReturn*entry/s.atr;
   trades.push({key,group:s.group,pattern:s.name,signalIndex:s.index,entryIndex:s.index+1,exitIndex,entryTime:entryBar.t,exitTime:data[exitIndex].t,entry,exit:exitPrice,target,stop,outcome,grossR,netR,netReturn,costBps,split:s.index<Math.floor(data.length*.6)?'İlk %60':'Son %40 test',direction:dir});
   blockedUntil=exitIndex;
  }
 }
 const calc=list=>{
  const n=list.length,net=list.map(t=>t.netR),wins=list.filter(t=>t.netR>0),losses=list.filter(t=>t.netR<=0),sumWin=wins.reduce((a,t)=>a+t.netR,0),sumLoss=Math.abs(losses.reduce((a,t)=>a+t.netR,0));
  let equity=0,peak=0,maxDD=0;for(const t of list){equity+=t.netR;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity)}
  return {trades:n,wins:wins.length,winRate:n?wins.length/n*100:0,expectancyR:mean(net),profitFactor:sumLoss?sumWin/sumLoss:sumWin>0?null:0,netR:net.reduce((a,b)=>a+b,0),avgReturnPct:mean(list.map(t=>t.netReturn))*100,maxDrawdownR:maxDD,medianR:median(net)};
 };
 const summaries=[...byPattern.keys()].map(key=>{
  const list=trades.filter(t=>t.key===key),train=list.filter(t=>t.split==='İlk %60'),test=list.filter(t=>t.split==='Son %40 test');
  const sample=calc(list),oos=calc(test);return {key,group:list[0]?.group||key.split('::')[0],pattern:list[0]?.pattern||key.split('::')[1],...sample,oosTrades:oos.trades,oosWinRate:oos.winRate,oosExpectancyR:oos.expectancyR,oosProfitFactor:oos.profitFactor,oosNetR:oos.netR,trainTrades:train.length,quality:sample.trades<20?'Düşük örneklem':oos.trades<10?'Test örneklemi az':oos.expectancyR>0?'Test dönemi pozitif':'Test dönemi negatif'};
 }).sort((a,b)=>b.oosExpectancyR-a.oosExpectancyR);
 const overall=calc(trades),oosTrades=trades.filter(t=>t.split==='Son %40 test'),oos=calc(oosTrades);
 return {bars:data.length,from:data[0].t,to:data[data.length-1].t,costBps,horizon,targetR,stopR,splitIndex:Math.floor(data.length*.6),signals:signals.length,trades:trades.length,overall,oos:{...oos},summaries,tradeLog:trades.slice(-300).reverse(),warning:'Bu, kütüphanenin teyitli olayları için sabit ATR hedef/stop kullanan geçmiş simülasyondur; canlı emir, tüm piyasa rejimlerinde başarı veya istatistiksel anlamlılık garantisi değildir. Kapanışta oluşan sinyal bir sonraki mum açılışından işleme girer. Aynı mumda hedef ve stop görülürse stop varsayılır. Son %40 kronolojik test dönemi ayrı raporlanır.'};
}
function fmt(n,d=2){return Number.isFinite(n)?n.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—'}
function render(report){
 const root=document.getElementById('backtestResults');if(!root)return;
 const o=report.overall,t=report.oos;
 const pf=x=>x===null||x===Infinity?'∞':fmt(x);
 const cards='<div class="bt-metrics">'+[
 ['Mum sayısı',report.bars],['İşlem sayısı',report.trades],['Hedef oranı',fmt(o.winRate)+'%'],['Ortalama net R',fmt(o.expectancyR)],['Kâr faktörü',pf(o.profitFactor)],['Maks. düşüş',fmt(o.maxDrawdownR)+' R'],
 ['Test dönemi işlem',t.trades],['Test hedef oranı',fmt(t.winRate)+'%'],['Test ort. net R',fmt(t.expectancyR)],['Test kâr faktörü',pf(t.profitFactor)],['Test net R',fmt(t.netR)],['Maliyet',report.costBps+' bps']
 ].map(x=>'<div class="bt-metric"><span>'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join('')+'</div>';
 const rows=report.summaries.map(s=>'<tr><td>'+esc(s.pattern)+'<small>'+esc(s.group)+'</small></td><td>'+s.trades+'</td><td>'+fmt(s.winRate)+'%</td><td>'+fmt(s.expectancyR)+' R</td><td>'+pf(s.profitFactor)+'</td><td>'+s.oosTrades+'</td><td>'+fmt(s.oosWinRate)+'%</td><td>'+fmt(s.oosExpectancyR)+' R</td><td>'+pf(s.oosProfitFactor)+'</td><td><span class="bt-quality">'+esc(s.quality)+'</span></td></tr>').join('');
 root.innerHTML='<div class="bt-metrics-wrap">'+cards+'</div><div class="bt-split-note">İlk %60: geçmiş dönem · Son %40: kronolojik test dönemi. Parametreler test dönemine göre optimize edilmedi. Kâr faktörü yalnızca işlem kâr/zararlarının toplamından hesaplanır. Genel metrikler formasyon başına işlemleri havuzlar; farklı formasyon işlemleri örtüşebilir ve bu değerler canlı portföy getirisi değildir.</div><div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>Formasyon</th><th>İşlem</th><th>Hedef %</th><th>Ort. R</th><th>PF</th><th>Test N</th><th>Test hedef %</th><th>Test ort. R</th><th>Test PF</th><th>Örneklem durumu</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="10">Bu geçmiş aralığında teyitli sinyal bulunmadı.</td></tr>')+'</tbody></table></div><details class="bt-log"><summary>Son işlemleri gör ('+report.tradeLog.length+')</summary><div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>Formasyon</th><th>Giriş zamanı</th><th>Çıkış zamanı</th><th>Giriş</th><th>Çıkış</th><th>Sonuç</th><th>Net R</th></tr></thead><tbody>'+report.tradeLog.map(x=>'<tr><td>'+esc(x.pattern)+'</td><td>'+new Date(x.entryTime).toLocaleString('tr-TR')+'</td><td>'+new Date(x.exitTime).toLocaleString('tr-TR')+'</td><td>'+fmt(x.entry,6)+'</td><td>'+fmt(x.exit,6)+'</td><td>'+esc(x.outcome)+'</td><td>'+fmt(x.netR)+'</td></tr>').join('')+'</tbody></table></div></details><p class="warning">'+esc(report.warning)+'</p>';
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
window.VCryptoBacktest={run,render};
})();