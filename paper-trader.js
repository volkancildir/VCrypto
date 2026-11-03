/* VCrypto paper portfolio: local, spot-only simulation using the existing signal and pattern engines. */
(function(){
'use strict';
const KEY='vcrypto-paper-portfolio-v1',START=10000,FEE=.001,MAX_POSITIONS=5,RISK_PER_TRADE=.01,MAX_ALLOCATION=.20;
const $=id=>document.getElementById(id);
const fmt=n=>'₺'+(Number(n)||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
const usd=n=>'$'+(Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:6});
const pct=n=>(n>0?'+':'')+(Number(n)||0).toFixed(2)+'%';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=()=>({cash:START,initial:START,positions:[],trades:[],lastBars:{},scanBars:{},active:false,startedAt:null,lastUpdate:null,fxRate:0});
function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(!x||typeof x!=='object')return fresh();return {...fresh(),...x,positions:Array.isArray(x.positions)?x.positions:[],trades:Array.isArray(x.trades)?x.trades:[],lastBars:x.lastBars||{},scanBars:x.scanBars||{}}}catch(e){return fresh()}}
let state=read(),fx=Number(state.fxRate)||0,busy=false,scanTimer=null,autoTimer=null;
function save(){state.fxRate=fx;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){status('Cihaz depolamasına kaydedilemedi.');}}
function status(s){const el=$('paperStatus');if(el)el.textContent=s}
function injectStyles(){
 if($('paperStyles'))return;
 const st=document.createElement('style');st.id='paperStyles';st.textContent=
 '#paperPortfolio{margin-top:16px;background:linear-gradient(145deg,#10243a,#0c1728);border:1px solid #1c695f;border-radius:17px;padding:16px;box-shadow:0 10px 28px #0003}'+
 '#paperPortfolio .paper-title{font-size:23px;font-weight:900;color:#f0f7ff}'+
 '#paperPortfolio .paper-sub{font-size:14px;color:#9db1c6;line-height:1.55;margin-top:4px}'+
 '#paperPortfolio .paper-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:14px 0}'+
 '#paperPortfolio .paper-metric{background:#081522;border:1px solid #21364d;border-radius:12px;padding:12px;min-width:0}'+
 '#paperPortfolio .paper-metric span{display:block;font-size:13px;color:#9db1c6}'+
 '#paperPortfolio .paper-metric strong{display:block;font-size:22px;margin-top:5px;overflow-wrap:anywhere}'+
 '#paperPortfolio .paper-positive{color:#35d98b!important}#paperPortfolio .paper-negative{color:#ff6579!important}'+
 '#paperPortfolio .paper-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}'+
 '#paperPortfolio button{border:1px solid #1c8b78;background:#123b3a;color:#8af4df;border-radius:10px;padding:12px 13px;font-size:14px;font-weight:850}'+
 '#paperPortfolio button.secondary{background:#0c1728;border-color:#21364d;color:#d9e7f5}'+
 '#paperPortfolio button:disabled{opacity:.5}'+
 '#paperPortfolio .paper-status{font-size:13px;color:#8af4df;line-height:1.6;margin:8px 0}'+
 '#paperPortfolio .paper-section{font-size:17px;font-weight:900;margin:17px 0 8px}'+
 '#paperPortfolio .paper-position,#paperPortfolio .paper-trade{background:#081522;border:1px solid #21364d;border-radius:11px;padding:11px;margin:7px 0}'+
 '#paperPortfolio .paper-rowtop{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}'+
 '#paperPortfolio .paper-symbol{font-size:16px;font-weight:900}'+
 '#paperPortfolio .paper-meta{font-size:12px;color:#9db1c6;line-height:1.6;margin-top:5px}'+
 '#paperPortfolio .paper-empty{font-size:14px;color:#8ca1b7;padding:12px 2px}'+
 '#paperPortfolio .paper-note{font-size:12px;color:#8ca1b7;line-height:1.65;margin-top:13px}'+
 '@media(max-width:420px){#paperPortfolio{padding:13px}#paperPortfolio .paper-title{font-size:21px}#paperPortfolio .paper-metric strong{font-size:19px}#paperPortfolio button{font-size:13px;padding:11px 10px}}';
 document.head.appendChild(st);
}
function mount(){
 if($('paperPortfolio'))return;
 const signalRows=$('signalRows'),anchor=signalRows&&signalRows.closest('.panel');
 if(!anchor)return;
 const box=document.createElement('section');box.id='paperPortfolio';
 box.innerHTML=
 '<div class="paper-rowtop"><div><div class="paper-title">Sanal portföy</div><div class="paper-sub">Başlangıç sermayesi: 10.000 TL · 4 saatlik + günlük · gerçek emir gönderilmez</div></div><span class="tag" id="paperStatus">Hazır</span></div>'+
 '<div class="paper-metrics">'+
 '<div class="paper-metric"><span>Toplam portföy</span><strong id="paperEquity">₺10.000,00</strong></div>'+
 '<div class="paper-metric"><span>Toplam kâr / zarar</span><strong id="paperPnl">₺0,00</strong></div>'+
 '<div class="paper-metric"><span>Kullanılabilir bakiye</span><strong id="paperCash">₺10.000,00</strong></div>'+
 '<div class="paper-metric"><span>Açık pozisyon değeri</span><strong id="paperExposure">₺0,00</strong></div>'+
 '</div>'+
 '<div class="paper-rowtop"><div class="paper-sub" id="paperReturn">Getiri: %0,00 · Gerçekleşen: ₺0,00 · Açık kâr/zarar: ₺0,00</div></div>'+
 '<div class="paper-actions"><button type="button" id="paperToggle">▶ Simülasyonu başlat</button><button type="button" class="secondary" id="paperScan">↻ Şimdi tara</button><button type="button" class="secondary" id="paperReset">Sıfırla</button></div>'+
 '<div class="paper-status" id="paperProgress">İlk tarama başlatıldığında ilk 500 coin 4 saatlik ve günlük mumlarda incelenecek.</div>'+
 '<div class="paper-section">Açık işlemler <span id="paperPositionCount" style="color:#8ca1b7"></span></div><div id="paperPositions"><div class="paper-empty">Henüz açık sanal işlem yok.</div></div>'+
 '<div class="paper-section">Son kapanan işlemler</div><div id="paperHistory"><div class="paper-empty">Henüz işlem geçmişi yok.</div></div>'+
 '<p class="paper-note">Kurallar: yalnızca AL sinyali + yukarı yönlü formasyon birlikteyse alım; SAT sinyali, aşağı yönlü formasyon, hedef veya zarar-kes seviyesinde çıkış. Açığa satış yok. İşlem başına portföyün en fazla %1’i riske edilir; tek pozisyon portföyün %20’sini, toplam açık pozisyon sayısı 5’i aşmaz. Alış ve satışta ayrı ayrı %0,10 varsayımsal maliyet düşülür. Mum kapanışları esas alınır. Simülasyon bu cihazın tarayıcı hafızasında saklanır; uygulama kapalıyken arka planda çalışmaz, tekrar açıldığında yeni kapanmış mumları tarar.</p>';
 anchor.insertAdjacentElement('afterend',box);
 $('paperToggle').addEventListener('click',toggle);
 $('paperScan').addEventListener('click',()=>scanAll(true));
 $('paperReset').addEventListener('click',reset);
 render();
}
async function getFx(){
 let rate=0;
 try{const r=await fetch('https://open.er-api.com/v6/latest/TRY',{cache:'no-store'});if(r.ok){const d=await r.json();if(d.result==='success')rate=Number(d.rates&&d.rates.USD)}}catch(e){}
 if(!(rate>0)){try{const r=await fetch('https://api.frankfurter.app/latest?from=USD&to=TRY',{cache:'no-store'});if(r.ok){const d=await r.json();const usdTry=Number(d.rates&&d.rates.TRY);if(usdTry>0)rate=1/usdTry}}catch(e){}}
 if(rate>0){fx=rate;state.fxRate=rate;save()}
 if(!(fx>0))throw Error('TL/USD kuru alınamadı; sanal işlem açılmadı.');
 return fx;
}
function equity(){
 const exposure=state.positions.reduce((s,p)=>s+(Number(p.qty)||0)*(Number(p.lastPrice)||Number(p.entry)||0)/Math.max(fx,1e-12),0);
 return {exposure,equity:state.cash+exposure};
}
function render(){
 if(!$('paperPortfolio'))return;
 const {exposure,equity:total}=equity(),pnl=total-state.initial,realized=state.trades.reduce((s,t)=>s+(Number(t.pnl)||0),0);
 const unrealized=state.positions.reduce((s,p)=>s+((Number(p.qty)||0)*(Number(p.lastPrice)||Number(p.entry)||0)/Math.max(fx,1e-12)-(Number(p.costTL)||0)),0);
 $('paperEquity').textContent=fmt(total);$('paperPnl').textContent=fmt(pnl);$('paperCash').textContent=fmt(state.cash);$('paperExposure').textContent=fmt(exposure);
 $('paperPnl').classList.toggle('paper-positive',pnl>=0);$('paperPnl').classList.toggle('paper-negative',pnl<0);
 $('paperReturn').textContent='Getiri: '+pct(state.initial>0?pnl/state.initial*100:0)+' · Gerçekleşen: '+fmt(realized)+' · Açık kâr/zarar: '+fmt(unrealized);
 $('paperPositionCount').textContent='('+state.positions.length+')';
 $('paperPositions').innerHTML=state.positions.length?state.positions.map(p=>{
  const value=p.qty*p.lastPrice/Math.max(fx,1e-12),u=value-p.costTL,ret=p.costTL>0?u/p.costTL*100:0;
  return '<article class="paper-position"><div class="paper-rowtop"><span class="paper-symbol">'+esc(p.symbol)+'</span><strong class="'+(u>=0?'paper-positive':'paper-negative')+'">'+fmt(u)+' ('+pct(ret)+')</strong></div><div class="paper-meta">'+(p.timeframe==='4h'?'4 saatlik':'Günlük')+' · '+esc(p.pattern||'Formasyon')+'<br>Giriş '+usd(p.entry)+' · Son '+usd(p.lastPrice)+'<br>Hedef '+usd(p.target)+' · Stop '+usd(p.stop)+' · Pozisyon '+fmt(value)+'</div></article>'
 }).join(''):'<div class="paper-empty">Henüz açık sanal işlem yok.</div>';
 $('paperHistory').innerHTML=state.trades.length?state.trades.slice(-12).reverse().map(t=>'<article class="paper-trade"><div class="paper-rowtop"><span class="paper-symbol">'+esc(t.symbol)+' · '+(t.timeframe==='4h'?'4 saat':'1 gün')+'</span><strong class="'+(t.pnl>=0?'paper-positive':'paper-negative')+'">'+fmt(t.pnl)+' ('+pct(t.returnPct)+')</strong></div><div class="paper-meta">'+esc(t.reason)+' · Giriş '+usd(t.entry)+' → Çıkış '+usd(t.exit)+'<br>'+new Date(t.closedAt).toLocaleString('tr-TR')+'</div></article>').join(''):'<div class="paper-empty">Henüz işlem geçmişi yok.</div>';
 $('paperToggle').textContent=state.active?'Ⅱ Simülasyonu durdur':'▶ Simülasyonu başlat';
 $('paperToggle').disabled=busy;$('paperScan').disabled=busy;$('paperReset').disabled=busy;
 if(state.lastUpdate)$('paperProgress').textContent='Son tarama: '+new Date(state.lastUpdate).toLocaleString('tr-TR')+' · Kur: 1 TL = '+(fx||0).toFixed(5)+' USD';
}
function markPosition(p,price){if(Number(price)>0)p.lastPrice=Number(price)}
function closePosition(pos,price,reason,time){
 const idx=state.positions.findIndex(p=>p.id===pos.id);if(idx<0)return;
 const proceeds=pos.qty*price/Math.max(fx,1e-12)*(1-FEE),pnl=proceeds-pos.costTL;
 state.cash+=proceeds;
 state.trades.push({symbol:pos.symbol,timeframe:pos.timeframe,entry:pos.entry,exit:price,qty:pos.qty,costTL:pos.costTL,proceedsTL:proceeds,pnl,returnPct:pos.costTL>0?pnl/pos.costTL*100:0,reason,openedAt:pos.openedAt,closedAt:time||Date.now()});
 state.positions.splice(idx,1);
}
function calcSignal(candles){
 const series=buildSignalSeries(candles),opt=optimizeSignal(series),i=series.scores.length-1,score=series.scores[i];
 if(score==null)return null;
 const entry=series.c[i],pattern=detectChartPattern(candles);
 const atrs=[];for(let j=Math.max(1,candles.length-15);j<candles.length;j++){const k=candles[j],pc=series.c[j-1];atrs.push(Math.max(k.h-k.l,Math.abs(k.h-pc),Math.abs(k.l-pc)))}
 const atr=atrs.length?atrs.reduce((a,b)=>a+b,0)/atrs.length:entry*.03;
 const validated=opt.test.trades>=3&&opt.test.net>0;
 const preliminary=score<=-opt.threshold?'SAT':'NÖTR',dir=preliminary==='SAT'?-1:1;
 let target=entry+dir*2*atr,stop=entry-dir*1.5*atr;
 if(pattern&&pattern.direction===dir){target=pattern.targets[0];stop=pattern.stop}
 const targetReturn=target/entry-1,stopReturn=stop/entry-1,rr=Math.abs(targetReturn)/Math.max(Math.abs(stopReturn),1e-9);
 let signal=score>=opt.threshold&&validated&&targetReturn>0&&rr>=1.2?'AL':preliminary==='SAT'?'SAT':'NÖTR';
 if(pattern&&pattern.direction===1&&score>=0&&validated)signal='AL';
 if(pattern&&pattern.direction===-1&&score<=0)signal='SAT';
 return {signal,pattern,score,validated,atr,target,stop,entry,rr};
}
async function scanInterval(interval,universe,rate){
 const label=interval==='4h'?'4 saatlik':'günlük';
 let btcTime=0;try{const raw=await getBinanceKlines('BTCUSDT',interval,120);if(raw.length>=2)btcTime=Number(raw[raw.length-2][0])}catch(e){}
 if(btcTime&&Number(state.scanBars[interval]||0)>=btcTime){status(label+' mumunda yeni kapanış yok; kayıtlı işlemler korunuyor.');return {skipped:true,done:universe.length}}
 let next=0,done=0,opened=0,closed=0,skipped=0;const errors=[];
 async function worker(){
  while(next<universe.length){
   const coin=universe[next++],symbol=String(coin.symbol||'').toUpperCase(),key=interval+'|'+symbol;
   try{
    const raw=await getBinanceKlines(symbol+'USDT',interval,500);
    if(raw.length<110){skipped++;done++;continue}
    const candles=raw.slice(0,-1).map(k=>({t:Number(k[0]),o:Number(k[1]),h:Number(k[2]),l:Number(k[3]),c:Number(k[4]),v:Number(k[5])})).filter(k=>[k.t,k.o,k.h,k.l,k.c,k.v].every(Number.isFinite));
    if(candles.length<100){skipped++;done++;continue}
    const last=candles[candles.length-1],previous=Number(state.lastBars[key]||0),newBar=last.t>previous;
    const currentPosition=state.positions.find(p=>p.symbol===symbol&&p.timeframe===interval);
    if(currentPosition){
     markPosition(currentPosition,last.c);
     if(newBar){
      const hi=last.h,lo=last.l,hitTarget=hi>=currentPosition.target,hitStop=lo<=currentPosition.stop;
      if(hitTarget&&hitStop){closePosition(currentPosition,currentPosition.stop,'Aynı mumda hedef ve stop: temkinli olarak stop',last.t);closed++}
      else if(hitStop){closePosition(currentPosition,currentPosition.stop,'Zarar-kes',last.t);closed++}
      else if(hitTarget){closePosition(currentPosition,currentPosition.target,'Hedef gerçekleşti',last.t);closed++}
      else{
       const sig=calcSignal(candles);
       if(sig&&(sig.signal==='SAT'||(sig.pattern&&sig.pattern.direction===-1))){closePosition(currentPosition,last.c,sig.signal==='SAT'?'SAT sinyali':'Aşağı yönlü formasyon',last.t);closed++}
      }
     }
    }else if(newBar&&state.positions.length<MAX_POSITIONS&&!state.positions.some(p=>p.symbol===symbol)){
     const sig=calcSignal(candles);
     if(sig&&sig.signal==='AL'&&sig.validated&&sig.pattern&&sig.pattern.direction===1){
      const entry=Number(raw[raw.length-1][1])||last.c;
      let stop=Number(sig.stop),target=Number(sig.target);
      if(!(stop>0&&stop<entry))stop=entry-1.5*sig.atr;
      if(!(target>entry))target=entry+2*sig.atr;
      const {equity:total}=equity(),riskTL=total*RISK_PER_TRADE,maxCostTL=total*MAX_ALLOCATION;
      const riskUsd=riskTL*rate,allocationUsd=maxCostTL*rate,cashUsd=state.cash*rate;
      const qty=Math.min(riskUsd/Math.max(entry-stop,entry*.0005),allocationUsd/entry,cashUsd/(entry*(1+FEE)));
      const costTL=qty*entry/rate*(1+FEE);
      if(qty>0&&Number.isFinite(costTL)&&costTL<=state.cash){
       state.cash-=costTL;
       state.positions.push({id:interval+'-'+symbol+'-'+last.t,symbol,name:coin.name||symbol,timeframe:interval,qty,entry,lastPrice:entry,target,stop,costTL,pattern:sig.pattern.name||'Yukarı yönlü formasyon',openedAt:Date.now(),entryBar:last.t});
       opened++;
      }
     }
    }
    if(newBar)state.lastBars[key]=last.t;
    if(currentPosition&&!state.positions.some(p=>p.id===currentPosition.id)){} 
   }catch(e){skipped++;if(errors.length<3)errors.push(symbol+': '+String(e.message||e).slice(0,90))}
   done++;
   if(done%20===0||done===universe.length){status(label+' tarama: '+done+'/'+universe.length+' · açılan '+opened+' · kapanan '+closed+' · atlanan '+skipped);render()}
  }
 }
 await Promise.all(Array.from({length:4},worker));
 if(btcTime)state.scanBars[interval]=btcTime;
 save();
 return {done,opened,closed,skipped,errors};
}
async function scanAll(force){
 if(busy)return;
 if(typeof signalBusy!=='undefined'&&signalBusy){status('Al/Sat taraması sürüyor; sanal tarama biraz sonra başlayacak.');setTimeout(()=>scanAll(force),10000);return;}
 if(!force&&!state.active)return;
 busy=true;render();status('Kur ve piyasa verileri hazırlanıyor…');
 try{
  if(typeof loadSignalUniverse!=='function'||typeof buildSignalSeries!=='function'||typeof optimizeSignal!=='function'||typeof detectChartPattern!=='function')throw Error('Sinyal motoru yüklenemedi.');
  const rate=await getFx();
  let tries=0;while((!Array.isArray(coins)||!coins.length)&&tries<30){await new Promise(r=>setTimeout(r,1000));tries++}
  const universe=await loadSignalUniverse();
  if(!universe.length)throw Error('Piyasa coin listesi boş.');
  const a=await scanInterval('4h',universe,rate);
  const b=await scanInterval('1d',universe,rate);
  state.lastUpdate=Date.now();save();
  const opened=(a.opened||0)+(b.opened||0),closed=(a.closed||0)+(b.closed||0);
  status('Tamamlandı · '+universe.length+' coin · 4 saatlik + günlük · '+opened+' yeni alım · '+closed+' kapanış');
  const p=$('paperProgress');if(p)p.textContent='Son tarama: '+new Date(state.lastUpdate).toLocaleString('tr-TR')+' · 4 saatlik ve günlük kapanmış mumlar işlendi. '+(a.skipped||0)+(b.skipped||0)+' coin verisi atlandı.';
 }catch(e){status('Hata: '+String(e.message||e));const p=$('paperProgress');if(p)p.textContent='Tarama tamamlanamadı. İnternet bağlantısını kontrol edip yeniden dene.'}
 finally{busy=false;render()}
}
async function toggle(){
 if(busy)return;
 state.active=!state.active;
 if(state.active){if(!state.startedAt)state.startedAt=Date.now();save();render();await scanAll(true)}
 else{save();status('Simülasyon duraklatıldı.');render()}
}
async function reset(){
 if(busy)return;
 if(!confirm('Sanal portföy sıfırlansın mı? Bakiye yeniden 10.000 TL olacak; açık pozisyonlar ve işlem geçmişi silinecek.'))return;
 state=fresh();fx=0;save();render();status('Portföy sıfırlandı; başlangıç bakiyesi 10.000 TL.');
}
async function latestClosedTime(interval){
 for(const host of ['https://data-api.binance.vision/api/v3/','https://api.binance.com/api/v3/']){
  try{const r=await fetch(host+'klines?symbol=BTCUSDT&interval='+interval+'&limit=3',{cache:'no-store'});if(!r.ok)continue;const d=await r.json();if(Array.isArray(d)&&d.length>=2)return Number(d[d.length-2][0])}catch(e){}
 }
 return 0;
}
async function autoCheck(){
 if(!state.active||busy||(typeof signalBusy!=='undefined'&&signalBusy))return;
 try{
  const [t4,td]=await Promise.all([latestClosedTime('4h'),latestClosedTime('1d')]);
  const due=(t4>0&&t4>Number(state.scanBars['4h']||0))||(td>0&&td>Number(state.scanBars['1d']||0));
  if(due)await scanAll(true);
 }catch(e){}
}
function startAuto(){
 clearInterval(autoTimer);
 autoTimer=setInterval(autoCheck,60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoCheck()});
 window.addEventListener('focus',autoCheck);
}
function init(){
 injectStyles();mount();startAuto();
 if(state.active){status('Simülasyon aktif; son kapanan mumlar kontrol ediliyor.');setTimeout(autoCheck,1800)}
 document.querySelectorAll('.nav-item[data-screen="signal"]').forEach(b=>b.addEventListener('click',()=>{if(state.active)setTimeout(autoCheck,1800)}));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();