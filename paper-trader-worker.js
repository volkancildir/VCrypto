'use strict';
// Fresh portfolio scan trigger: run the current independent strategy engines against the cleared paper books.
const fs=require('fs'),https=require('https'),vm=require('vm');
const STATE_FILE='paper-portfolio.json',START=10000,FEE=.001,MAX_POSITIONS=10,MAX_ALLOC=.20,MAX_RISK_PER_TRADE=.01,MIN_MATCHES=20,EXIT_T1_PROB=35,EXIT_ADVERSE_PROB=65,OUTCOME_HORIZON=24;
const STRATEGIES=['alSat','formasyon','birlesik'];
const EXCLUDED=new Set(['USDT','USDC','BUSD','FDUSD','TUSD','DAI','USDE','USDS','USD1','PYUSD','EURC','USTC','USDD','FRAX','USDP','USDX','WBTC','STETH','WSTETH']);
function get(url,timeout=15000){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'user-agent':'VCrypto-paper-simulation/2.0','accept':'application/json'}},res=>{let b='';res.setEncoding('utf8');res.on('data',x=>b+=x);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('HTTP '+res.statusCode+' '+url));try{resolve(JSON.parse(b))}catch(e){reject(e)}})});req.setTimeout(timeout,()=>req.destroy(Error('timeout')));req.on('error',reject)})}
function extract(src,name){const marker='function '+name+'(';let i=src.indexOf(marker);if(i<0)throw Error('Missing function '+name);let brace=src.indexOf('{',i),depth=0,quote='',escape=false,lineComment=false,blockComment=false;for(let j=brace;j<src.length;j++){const c=src[j],n=src[j+1];if(lineComment){if(c==='\n')lineComment=false;continue}if(blockComment){if(c==='*'&&n==='/'){blockComment=false;j++}continue}if(quote){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===quote)quote='';continue}if(c==='/'&&n==='/'){lineComment=true;j++;continue}if(c==='/'&&n==='*'){blockComment=true;j++;continue}if(c==='"'||c==="'"||c==='`'){quote=c;continue}if(c==='{')depth++;if(c==='}'&&--depth===0)return src.slice(i,j+1)}throw Error('Unclosed '+name)}
async function engine(){const html=fs.readFileSync('index.html','utf8');const names=['emaArr','rsiArr','smaArr','buildSignalSeries','simulateSignal','optimizeSignal','linearSlope','detectChartPattern'];const code=names.map(n=>extract(html,n)).join('\n');return new Function(code+';return {buildSignalSeries,optimizeSignal,detectChartPattern};')()}
async function universe(){let rows=[];for(let page=1;page<=2;page++){const d=await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+page+'&sparkline=false');if(Array.isArray(d))rows.push(...d)}const seen=new Set(),out=[];for(const c of rows.sort((a,b)=>(a.market_cap_rank||999999)-(b.market_cap_rank||999999))){const s=String(c.symbol||'').toUpperCase();if(!/^[A-Z0-9]{2,15}$/.test(s)||EXCLUDED.has(s)||seen.has(s))continue;seen.add(s);out.push({symbol:s,name:c.name,rank:c.market_cap_rank});if(out.length===500)break}if(out.length<100)throw Error('CoinGecko universe unavailable ('+out.length+')');return out}
async function binance(path){for(const host of ['https://data-api.binance.vision/api/v3/','https://api.binance.com/api/v3/']){try{return await get(host+path)}catch(e){console.log('Binance fallback:',e.message)}}throw Error('Binance API unavailable')}
async function fxRate(){const d=await get('https://open.er-api.com/v6/latest/TRY');const r=Number(d.rates&&d.rates.USD);if(!(r>0))throw Error('FX rate unavailable');return r}
function blankBook(){return {initial:START,cash:START,positions:[],trades:[],cooldowns:{}}}
function blank(){return {initial:30000,strategies:{alSat:blankBook(),formasyon:blankBook(),birlesik:blankBook()},lastBars:{},scanBars:{},formasyonBacktest:{},fxRate:0,updatedAt:null,active:true,engine:'GitHub Actions · 5 dakika kontrol'}}
function readState(){try{const old=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));if(old.strategies)return {...blank(),...old,strategies:Object.fromEntries(STRATEGIES.map(k=>[k,{...blankBook(),...(old.strategies[k]||{})}]))}}catch(e){}return blank()}
function equity(b,rate){return b.cash+b.positions.reduce((a,p)=>a+p.qty*p.lastPrice/rate*(1-FEE),0)}
function closePos(b,p,price,reason,rate){const i=b.positions.findIndex(x=>x.id===p.id);if(i<0)return;const proceeds=p.qty*price/rate*(1-FEE),pnl=proceeds-p.costTL;b.cash+=proceeds;b.trades.push({strategy:p.strategy,symbol:p.symbol,timeframe:p.timeframe,entry:p.entry,exit:price,qty:p.qty,costTL:p.costTL,proceedsTL:proceeds,pnl,returnPct:p.costTL?pnl/p.costTL*100:0,reason,openedAt:p.openedAt,closedAt:Date.now()});if(pnl<0){b.cooldowns=b.cooldowns||{};b.cooldowns[p.symbol+'|'+p.timeframe]=Date.now()+(p.timeframe==='1h'?3:12)*60*60*1000;}b.positions.splice(i,1)}
function relativeStrength(candles,btcCandles){
 if(!Array.isArray(btcCandles)||candles.length<51||btcCandles.length<51)return null;
 const btcByTime=new Map(btcCandles.map(x=>[x.t,x.c]));
 const i=candles.length-1,now=candles[i],past20=candles[i-20],past50=candles[i-50];
 const btcNow=btcByTime.get(now.t),btc20=btcByTime.get(past20.t),btc50=btcByTime.get(past50.t);
 if(![now.c,past20.c,past50.c,btcNow,btc20,btc50].every(x=>Number.isFinite(x)&&x>0))return null;
 return {rs20:(now.c/past20.c)/(btcNow/btc20)-1,rs50:(now.c/past50.c)/(btcNow/btc50)-1};
}
function indicatorContext(candles,series,btcCandles){
 const c=candles.map(x=>x.c),h=candles.map(x=>x.h),l=candles.map(x=>x.l),v=candles.map(x=>x.v),n=c.length,i=n-1;
 const ema=(arr,p)=>{if(arr.length<p)return null;let z=arr.slice(0,p).reduce((a,b)=>a+b,0)/p,k=2/(p+1);for(let j=p;j<arr.length;j++)z=arr[j]*k+z*(1-k);return z};
 const e9=ema(c.slice(-100),9),e20=ema(c.slice(-120),20),e50=ema(c.slice(-180),50),e200=ema(c.slice(-260),200);
 const rsi=series.rsi[i],m=series.macd[i],ms=series.macdSignal[i],mp=series.macd[i-1],msp=series.macdSignal[i-1];
 const hist=m!=null&&ms!=null?m-ms:null,prevHist=mp!=null&&msp!=null?mp-msp:null;
 const obv=[];let flow=0;for(let j=1;j<n;j++){flow+=c[j]>c[j-1]?v[j]:c[j]<c[j-1]?-v[j]:0;obv.push(flow)}
 const obvUp=obv.length>6&&obv.at(-1)>obv[obv.length-6];
 let mf=0,vs=0;for(let j=Math.max(0,n-20);j<n;j++){mf+=((2*c[j]-h[j]-l[j])/Math.max(h[j]-l[j],1e-12))*v[j];vs+=v[j]}
 const cmf=vs>0?mf/vs:0,priorHigh=Math.max(...h.slice(Math.max(0,n-21),n-1)),priorLow=Math.min(...l.slice(Math.max(0,n-21),n-1));
 const breakoutUp=c[i]>priorHigh,breakdown=c[i]<priorLow,band=c.slice(-20),mean=band.reduce((x,y)=>x+y,0)/Math.max(1,band.length);
 const sd=Math.sqrt(band.reduce((x,y)=>x+(y-mean)**2,0)/Math.max(1,band.length)),bbWidth=mean>0?4*sd/mean:0,atr=seriesAtr(candles);
 const baseline=v.slice(-21,-1).filter(x=>Number.isFinite(x)&&x>0),avgVolume=baseline.length?baseline.reduce((a,b)=>a+b,0)/baseline.length:0;
 const volumeRatio=avgVolume>0&&Number.isFinite(v[i])?v[i]/avgVolume:0;
 const lastRange=Math.max(h[i]-l[i],1e-12),bodyRatio=Math.abs(c[i]-candles[i].o)/lastRange,closeLocation=(c[i]-l[i])/lastRange,upperWickRatio=(h[i]-Math.max(candles[i].o,c[i]))/lastRange;
 const extensionAtr=e20>0&&atr>0?(c[i]-e20)/atr:Infinity,barMoveAtr=atr>0?(c[i]-candles[i].o)/atr:Infinity;
 const entryQuality=extensionAtr<=1.8&&barMoveAtr<=1.25&&upperWickRatio<=.35&&bodyRatio>=.30&&closeLocation>=.65&&c[i]>candles[i].o;
 const trend=e20!=null&&e50!=null&&e200!=null&&e20>e50&&e50>e200;
 const bearish=e20!=null&&e50!=null&&e200!=null&&e20<e50&&e50<e200;
 const momentum=hist!=null&&prevHist!=null&&hist>prevHist;
 const pullback=c[i]>e20&&c[i-1]<=ema(c.slice(0,-1).slice(-120),20)*1.012;
 const rs=relativeStrength(candles,btcCandles);
 const volumeStrong=volumeRatio>=1.25&&entryQuality&&(obvUp||cmf>.04);
 const indicatorChecks={emaTrend:trend,priceAboveEma20:e20!=null&&c[i]>e20,macdMomentum:hist!=null&&prevHist!=null&&hist>prevHist&&hist>0,rsiHealthy:rsi>=52&&rsi<=68,volume:volumeRatio>=1.10,moneyFlow:cmf>.05,obvTrend:obvUp,donchianBreakout:breakoutUp,relativeStrength20:rs!=null&&rs.rs20>0,relativeStrength50:rs!=null&&rs.rs50>0};
 const indicatorPassCount=Object.values(indicatorChecks).filter(Boolean).length;
 let score=0;
 if(trend)score+=2;if(c[i]>e20)score+=.5;if(momentum)score+=1;
 if(rsi>=52&&rsi<=68)score+=.75;if(volumeRatio>=1.1)score+=.5;
 if(cmf>.05)score+=.5;if(obvUp)score+=.35;if(breakoutUp)score+=1;
 if(rs&&rs.rs20>0)score+=.75;if(rs&&rs.rs50>0)score+=.5;
 return {e9,e20,e50,e200,rsi,hist,prevHist,momentum,obvUp,cmf,breakoutUp,breakdown,bbWidth,atr,volumeRatio,volumeStrong,entryQuality,extensionAtr,barMoveAtr,upperWickRatio,bodyRatio,closeLocation,indicatorChecks,indicatorPassCount,trend,bearish,pullback,rs20:rs?rs.rs20:null,rs50:rs?rs.rs50:null,score};
}
function seriesAtr(candles){const trs=[];for(let j=Math.max(1,candles.length-14);j<candles.length;j++){const k=candles[j],p=candles[j-1];trs.push(Math.max(k.h-k.l,Math.abs(k.h-p.c),Math.abs(k.l-p.c)))}return trs.length?trs.reduce((a,b)=>a+b,0)/trs.length:(candles.at(-1)?.c||0)*.03}
function analyze(candles,E,btcCandles){
 const series=E.buildSignalSeries(candles),i=series.scores.length-1,entry=series.c[i];
 if(entry==null||candles.length<220)return null;
 const pattern=E.detectChartPattern(candles),ctx=indicatorContext(candles,series,btcCandles);
 const last=candles[i],range=Math.max(last.h-last.l,1e-12),body=Math.abs(last.c-last.o)/range,loc=(last.c-last.l)/range;
 const volumeConfirmed=ctx.volumeStrong===true;
 const notLate=ctx.entryQuality===true&&ctx.rsi<=68;
 const patternConfirmed=!!(pattern&&pattern.direction===1&&pattern.qualityScore>=65&&body>=.40&&loc>=.70&&last.c>ctx.e20&&ctx.rsi>=48&&ctx.rsi<=68&&volumeConfirmed&&notLate&&(ctx.rs20==null||ctx.rs20>-.02));
 const formasyonConfirmed=patternConfirmed;
 const trendEntry=ctx.trend&&last.c>ctx.e20&&ctx.rsi>=52&&ctx.rsi<=68&&ctx.momentum&&ctx.hist>0&&ctx.volumeRatio>=1.25&&ctx.rs20!=null&&ctx.rs20>0&&notLate;
 const breakoutEntry=ctx.trend&&ctx.breakoutUp&&ctx.rsi>=54&&ctx.rsi<=68&&ctx.momentum&&ctx.hist>0&&ctx.volumeRatio>=1.25&&ctx.rs20!=null&&ctx.rs20>.015&&notLate;
 const bearishExit=ctx.bearish&&ctx.momentum===false&&ctx.rsi<48;
 const alSignal=trendEntry||breakoutEntry?'AL':bearishExit?'SAT':'NÖTR';
 const score=ctx.score+(patternConfirmed?1.5:0);
 const threshold=3.5;
 const atr=ctx.atr;
 return {alSignal,pattern,patternConfirmed,formasyonConfirmed,validated:false,atr,atrTarget:entry+2.5*atr,score,threshold,
  rs20:ctx.rs20,rs50:ctx.rs50,volumeRatio:ctx.volumeRatio,volumeConfirmed,volumeStrong:ctx.volumeStrong,indicatorChecks:ctx.indicatorChecks,indicatorPassCount:ctx.indicatorPassCount,
  trendEntry,breakoutEntry,bearishExit,indicatorContext:ctx,
  signalConfidence:Math.min(1,Math.max(.25,(score-threshold+2)/4))};
}
function allowed(strategy,a){
 if(strategy==='alSat')return a.alSignal==='AL'&&a.indicatorPassCount>=7&&a.volumeStrong===true&&a.indicatorContext.entryQuality===true;
 if(strategy==='formasyon')return a.formasyonConfirmed===true;
 if(strategy==='birlesik')return a.alSignal==='AL'&&a.patternConfirmed===true;
 return false;
}
function regimeAllows(strategy,a,regime){
 if(regime==='bear'){
  if(strategy==='formasyon')return !!(a.pattern&&a.pattern.qualityScore>=85&&a.patternConfirmed&&a.volumeRatio>=1.5&&a.rs20>.05);
  return a.breakoutEntry===true&&a.score>=a.threshold+2&&a.volumeRatio>=1.5&&a.rs20>.05;
 }
 if(regime==='unknown')return false;
 if(strategy==='formasyon')return a.patternConfirmed===true&&(regime==='bull'||(a.pattern.qualityScore>=75&&a.rs20>0));
 if(strategy==='birlesik')return a.alSignal==='AL'&&a.patternConfirmed===true;
 return a.alSignal==='AL';
}
function levels(strategy,a,entry){
 const atr=Math.max(Number(a.atr)||0,entry*.008);
 return {target1:entry+2.5*atr,target2:entry+3.5*atr};
}
function shouldExit(strategy,a){if(strategy==='alSat')return a.alSignal==='SAT';if(strategy==='formasyon')return !!(a.pattern&&a.pattern.direction===-1);return a.alSignal==='SAT'||!!(a.pattern&&a.pattern.direction===-1)}
function levels(strategy,a,entry){let target1=strategy!=='alSat'&&a.pattern&&a.pattern.targets?Number(a.pattern.targets[0]):a.atrTarget;if(!(target1>entry))target1=entry+2*a.atr;let target2=strategy!=='alSat'&&a.pattern&&a.pattern.targets&&Number(a.pattern.targets[1])>target1?Number(a.pattern.targets[1]):entry+3*a.atr;if(!(target2>target1))target2=target1+Math.max(a.atr,entry*.01);return {target1,target2}}
function classifyBtcRegime(candles){
 const c=candles.map(x=>x.c);
 const emaAt=(values,period,end)=>{if(end+1<period)return null;let v=values.slice(0,period).reduce((a,b)=>a+b,0)/period;const k=2/(period+1);for(let i=period;i<=end;i++)v=values[i]*k+v*(1-k);return v};
 if(c.length<220)return 'unknown';
 const last=c.length-1,close=c[last],e20=emaAt(c,20,last),e50=emaAt(c,50,last),e200=emaAt(c,200,last),e50prev=emaAt(c,50,last-5);
 if(![close,e20,e50,e200,e50prev].every(Number.isFinite))return 'unknown';
 if(close>e200&&e20>e50&&e50>e200&&e50>e50prev)return 'bull';
 if(close<e200&&e20<e50&&e50<e200&&e50<e50prev)return 'bear';
 return 'sideways';
}
function regimeAllows(strategy,a,regime){
 // Al/Sat ve Formasyon motorlarinda kullanicinin belirledigi giris kurallari disinda BTC rejim filtresi uygulanmaz.
 if(strategy==='alSat')return a.alSignal==='AL'&&a.indicatorContext.entryQuality===true;
 if(strategy==='formasyon')return true;
 // Birlesik motorun eski BTC rejim ve giris kosullari aynen korunur.
 if(regime==='bear')return a.score>=a.threshold+1.25&&a.volumeConfirmed===true;
 if(strategy==='birlesik')return a.alSignal==='AL'||!!(a.pattern&&a.pattern.direction===1&&a.patternConfirmed===true);
 return a.alSignal==='AL';
}

function wilsonLowerPct(wins,total){
 if(!(total>0))return 0;
 const z=1.96,p=wins/total,z2=z*z;
 return (p+z2/(2*total)-z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/(1+z2/total)*100;
}
function historicalOdds(candles,btcCandles,E,strategy,analysis,entry,lv,regime){
 const empty={samples:0,target1ProbabilityPct:null,target2ProbabilityPct:null,adverseProbabilityPct:null,expectedNetPct:null,profitFactor:null,wilsonLowerPct:null};
 if(!Array.isArray(candles)||candles.length<260||!(analysis.atr>0&&entry>0&&lv.target1>entry))return empty;
 const btcIndex=new Map(btcCandles.map((x,i)=>[x.t,i]));
 const r1=(lv.target1-entry)/analysis.atr,r2=(lv.target2-entry)/analysis.atr;
 if(!(r1>0&&r2>=r1))return empty;
 const samples=[],last=candles.length-OUTCOME_HORIZON-2;
 for(let i=220;i<=last;i+=2){
  const bi=btcIndex.get(candles[i].t);if(bi==null||bi<220)continue;
  const historicalRegime=classifyBtcRegime(btcCandles.slice(0,bi+1));
  if(regime==='bull'&&historicalRegime==='bear')continue;
  const prefix=candles.slice(0,i+1),pattern=E.detectChartPattern(prefix);
  if(strategy==='alSat'){
   const historicalAnalysis=analyze(prefix,E,btcCandles.slice(0,bi+1));
   if(!historicalAnalysis||!allowed('alSat',historicalAnalysis))continue;
  }else if(analysis.pattern){if(!pattern||pattern.name!==analysis.pattern.name||pattern.direction!==1)continue;if(Math.abs(Number(pattern.qualityScore||0)-Number(analysis.pattern.qualityScore||0))>15)continue}
  else if(pattern&&pattern.direction<0)continue;
  const tr=[];for(let j=Math.max(1,i-13);j<=i;j++){const k=candles[j],p=candles[j-1];tr.push(Math.max(k.h-k.l,Math.abs(k.h-p.c),Math.abs(k.l-p.c)))}
  const atr=tr.reduce((a,b)=>a+b,0)/Math.max(1,tr.length),open=candles[i+1].o;
  if(!(atr>0&&open>0))continue;
  const t1=open+r1*atr,t2=open+r2*atr,adverse=open-1.5*atr;
  let result='horizon',exitPrice=null,target2First=false;
  for(let j=i+1;j<=Math.min(candles.length-1,i+OUTCOME_HORIZON);j++){
   const k=candles[j],bad=k.l<=adverse,hit1=k.h>=t1,hit2=k.h>=t2;
   // Mum içi sıra bilinemez: hedef ve olumsuz seviye aynı mumdaysa zarar önce kabul edilir.
   if(bad&&(hit1||hit2)){result='adverse';exitPrice=adverse;break}
   if(bad){result='adverse';exitPrice=adverse;break}
   if(hit1){result='target1';exitPrice=t1;if(hit2)target2First=true;break}
  }
  if(exitPrice===null)exitPrice=candles[Math.min(candles.length-1,i+OUTCOME_HORIZON)].c;
  const netPct=(exitPrice/open*(1-FEE)/(1+FEE)-1)*100;
  samples.push({target1:result==='target1',target2:result==='target1'&&target2First,adverse:result==='adverse',netPct});
 }
 if(!samples.length)return empty;
 const n=samples.length,wins=samples.filter(x=>x.target1).length,positive=samples.filter(x=>x.netPct>0).reduce((a,x)=>a+x.netPct,0),negative=-samples.filter(x=>x.netPct<0).reduce((a,x)=>a+x.netPct,0);
 return {
  samples:n,
  target1ProbabilityPct:wins/n*100,
  target2ProbabilityPct:samples.filter(x=>x.target2).length/n*100,
  adverseProbabilityPct:samples.filter(x=>x.adverse).length/n*100,
  expectedNetPct:samples.reduce((a,x)=>a+x.netPct,0)/n,
  profitFactor:negative>0?positive/negative:positive>0?null:0,
  wilsonLowerPct:wilsonLowerPct(wins,n)
 };
}
function entryAllowedByOdds(o,a){
 if(!o||o.samples<MIN_MATCHES)return false;
 return Number.isFinite(o.expectedNetPct)&&o.expectedNetPct>=.15&&Number(o.target1ProbabilityPct)>=45&&Number(o.adverseProbabilityPct)<=55&&(o.profitFactor===null||o.profitFactor>=1.05);
}
function exitAllowedByOdds(o){
 return o.samples>=MIN_MATCHES&&o.target1ProbabilityPct<EXIT_T1_PROB&&
  o.adverseProbabilityPct>=EXIT_ADVERSE_PROB;
}

async function fetchOneYearCandles(symbol,interval){
 const startYear=Date.now()-365*24*60*60*1000;
 let startTime=startYear,rows=[];
 for(let page=0;page<12;page++){
  const raw=await binance('klines?symbol='+symbol+'USDT&interval='+interval+'&startTime='+startTime+'&limit=1000');
  if(!Array.isArray(raw)||!raw.length)break;
  rows.push(...raw);
  const lastOpen=Number(raw[raw.length-1][0]);
  if(!Number.isFinite(lastOpen)||raw.length<1000)break;
  startTime=lastOpen+1;
 }
 const now=Date.now(),seen=new Set();
 return rows.filter(k=>Number(k[6])<now&&!seen.has(Number(k[0]))&&seen.add(Number(k[0])))
  .map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}))
  .filter(k=>k.t>=startYear)
  .sort((a,b)=>a.t-b.t);
}
function scoreHistoricalPattern(candles,E,patternName){
 const yearStart=Date.now()-365*24*60*60*1000,recentStart=Date.now()-182.5*24*60*60*1000;
 const old={wins:0,total:0},recent={wins:0,total:0};
 if(!Array.isArray(candles)||candles.length<100)return {score:0,year:old,lastSixMonths:recent,weightedScore:0,method:'Insufficient one-year candle history'};
 const horizon=24,cooldown=24;
 let lastAccepted=-cooldown;
 for(let i=45;i<candles.length-horizon-1;i++){
  const candle=candles[i];
  if(candle.t<yearStart||i-lastAccepted<cooldown)continue;
  const pattern=E.detectChartPattern(candles.slice(0,i+1));
  if(!pattern||pattern.direction!==1||pattern.name!==patternName)continue;
  const entry=Number(candles[i+1].o),target=Number(pattern.targets&&pattern.targets[0]);
  if(!(entry>0&&target>entry))continue;
  let stop=Number(pattern.stop);
  if(!(stop>0&&stop<entry)){
   const trs=[];
   for(let j=Math.max(1,i-13);j<=i;j++){const k=candles[j],p=candles[j-1];trs.push(Math.max(k.h-k.l,Math.abs(k.h-p.c),Math.abs(k.l-p.c)))}
   const atr=trs.length?trs.reduce((a,b)=>a+b,0)/trs.length:entry*.02;
   stop=entry-Math.max(atr*1.5,entry*.008);
  }
  let won=false;
  for(let j=i+1;j<=Math.min(candles.length-1,i+horizon);j++){
   const k=candles[j],hitStop=k.l<=stop,hitTarget=k.h>=target;
   if(hitStop){won=false;break}
   if(hitTarget){won=true;break}
  }
  const bucket=candle.t>=recentStart?recent:old;
  bucket.total++;
  if(won)bucket.wins++;
  lastAccepted=i;
 }
 const pct=x=>x.total?x.wins/x.total*100:0;
 const oldPct=pct(old),recentPct=pct(recent);
 const weightedScore=old.total>=5&&recent.total>=5?oldPct*.40+recentPct*.60:0;
 return {score:weightedScore,weightedScore,year:old,lastSixMonths:recent,yearWinRatePct:oldPct,lastSixMonthsWinRatePct:recentPct,patternName,method:'Same bullish pattern type; next-candle-open entry; first target before pattern stop within 24 candles; unresolved outcomes count as failures; first 6 months 40%, latest 6 months 60%'};
}
function formasyonBacktest(candles,btcCandles,E,symbol){
 const n=candles.length,start=220;
 if(n<=start+2||btcCandles.length<=start)return [];
 const btcIndex=new Map(btcCandles.map((x,i)=>[x.t,i]));
 const trades=[];let pos=null;
 function finish(exit,exitIndex,reason){
  const ret=(exit/pos.entry)*(1-FEE)/(1+FEE)-1;
  const fold=Math.min(2,Math.max(0,Math.floor((exitIndex-start)/Math.max(1,n-start)*3)));
  trades.push({symbol,entryTime:pos.entryTime,exitTime:candles[exitIndex].t,ret,reason,fold,quality:pos.quality});
  pos=null;
 }
 for(let i=start;i<n;i++){
  const candle=candles[i],prefix=candles.slice(0,i+1);
  if(pos){
   const hitStop=candle.l<=pos.stop,hitTarget=candle.h>=pos.target1;
   if(hitStop){finish(candle.o<pos.stop?candle.o:pos.stop,i,'Stop-loss');continue}
   if(hitTarget){finish(candle.o>pos.target1?candle.o:pos.target1,i,'Target 1');continue}
   const exitPattern=E.detectChartPattern(prefix);
   if(exitPattern&&exitPattern.direction===-1){finish(candle.c,i,'bearish pattern');continue}
   continue;
  }
  if(i+1>=n)continue;
  const pattern=E.detectChartPattern(prefix);
  if(!pattern||pattern.direction!==1||pattern.qualityScore<65)continue;
  const range=Math.max(candle.h-candle.l,1e-12);
  const bodyRatio=Math.abs(candle.c-candle.o)/range;
  const closeLocation=(candle.c-candle.l)/range;
  if(bodyRatio<.4||closeLocation<.7||candle.c<=candles[i-1].c)continue;
  const baseline=prefix.slice(Math.max(0,i-25),i-5).map(x=>x.v).filter(x=>Number.isFinite(x)&&x>0);
  const recent=prefix.slice(Math.max(0,i-4),i+1);
  if(baseline.length!==20||recent.length!==5)continue;
  const avgVolume=baseline.reduce((a,b)=>a+b,0)/20;
  const recentAvg=recent.reduce((a,x)=>a+(Number.isFinite(x.v)&&x.v>0?x.v:0),0)/5;
  const volumeConfirmed=avgVolume>0&&recentAvg/avgVolume>=1.2&&recent.filter(x=>x.c>x.o).length>=3&&candle.c>candles[i-1].c;
  const bi=btcIndex.get(candle.t);
  if(bi==null)continue;
  const btcPrefix=btcCandles.slice(0,bi+1);
  const regime=classifyBtcRegime(btcPrefix);
  const rs=relativeStrength(prefix,btcPrefix);
  const bullAllowed=regime==='bull';
  const sidewaysAllowed=regime==='sideways'&&volumeConfirmed&&pattern.qualityScore>=75&&!!rs&&rs.rs20>0&&rs.rs50>0;
  if(!bullAllowed&&!sidewaysAllowed)continue;
  const entry=candles[i+1].o;
  if(!(entry>0))continue;
  const trs=[];
  for(let j=Math.max(1,i-14);j<=i;j++){
   const k=candles[j],pc=candles[j-1];
   trs.push(Math.max(k.h-k.l,Math.abs(k.h-pc.c),Math.abs(k.l-pc.c)));
  }
  const atr=trs.length?trs.reduce((a,b)=>a+b,0)/trs.length:candle.c*.03;
  const lv=levels('formasyon',{pattern,atr,atrTarget:candle.c+2*atr},entry);
  if(!(lv.target1>entry&&lv.target2>lv.target1))continue;
  pos={entry,target1:lv.target1,target2:lv.target2,stop:entry-Math.max(atr*1.5,entry*.008),entryTime:candles[i+1].t,quality:pattern.qualityScore};
 }
 if(pos)finish(candles[n-1].c,n-1,'end of sample');
 return trades;
}
function formasyonBacktestMetrics(trades){
 const wins=trades.filter(t=>t.ret>0),losses=trades.filter(t=>t.ret<0);
 const grossWin=wins.reduce((a,t)=>a+t.ret,0),grossLoss=-losses.reduce((a,t)=>a+t.ret,0);
 return {
  trades:trades.length,
  winRatePct:trades.length?wins.length/trades.length*100:0,
  avgReturnPct:trades.length?trades.reduce((a,t)=>a+t.ret,0)/trades.length*100:0,
  avgWinPct:wins.length?grossWin/wins.length*100:0,
  avgLossPct:losses.length?grossLoss/losses.length*100:0,
  profitFactor:grossLoss>0?grossWin/grossLoss:null,
  grossProfitPct:grossWin*100,
  grossLossPct:grossLoss*100
 };
}
function summarizeFormasyonWalkForward(trades,interval,coinsTested,bars){
 return {
  interval,coinsTested,bars,method:'Chronological 3-fold exit test; next-candle-open entries; Target 1 or confirmed bearish pattern exits; ATR-based stop-loss; 0.1% fee each side; historical analogs influence sizing rather than vetoing low-sample signals',
  overall:formasyonBacktestMetrics(trades),
  folds:[0,1,2].map(fold=>({fold:fold+1,...formasyonBacktestMetrics(trades.filter(t=>t.fold===fold))})),
  sampleWarning:trades.length<30?'Fewer than 30 closed trades: results are preliminary and statistically weak.':null,
  survivorshipWarning:'Universe is the current top 100 by market cap, not historical point-in-time membership.'
 };
}

async function main(){
 const s=readState();
 const reset=process.env.RESET_STRATEGY;
 const resetApplied=STRATEGIES.includes(reset);
 if(resetApplied){s.strategies[reset]=blankBook();console.log('Reset strategy:',reset,'to 10000 TL')}
 const E=await engine();
 const rate=await fxRate();
 s.fxRate=rate;

 // Live Target 1 checks are independent for each virtual account; stop-loss is disabled.
 const tickers=await binance('ticker/price');
 const livePrices=new Map(tickers.filter(t=>t.symbol.endsWith('USDT')).map(t=>[t.symbol.slice(0,-4),Number(t.price)]));
 for(const strategy of STRATEGIES){
  const book=s.strategies[strategy];
  for(const pos of [...book.positions]){
   const live=livePrices.get(pos.symbol);
   if(!(live>0))continue;
   pos.lastPrice=live;
   if(!pos.target1)pos.target1=Number(pos.target)||Number(live);
   if(!pos.target2)pos.target2=pos.target1;
   if(!(Number(pos.stop)>0))pos.stop=Number(pos.entry||live)*.97;
   if(live<=pos.stop)closePos(book,pos,live,'Stop-loss: canlı fiyat stop seviyesinin altına indi',rate);
   else if(live>=pos.target1)closePos(book,pos,pos.target1,'Hedef 1 gerçekleşti (canlı fiyat kontrolü)',rate);
  }
 }

 // The former daily timeframe is replaced by 1-hour candles.
 const btc4=await binance('klines?symbol=BTCUSDT&interval=4h&limit=3');
 const btc1=await binance('klines?symbol=BTCUSDT&interval=1h&limit=3');
 const closed4=Number(btc4[btc4.length-2][0]);
 const closed1=Number(btc1[btc1.length-2][0]);
 const forceScan=process.env.GITHUB_EVENT_NAME==='push';
 const due4=forceScan||closed4>Number(s.scanBars['4h']||0);
 const due1=forceScan||closed1>Number(s.scanBars['1h']||0);

 if((due4||due1)&&!resetApplied){
  const coins=await universe();
  console.log('Universe',coins.length,'4h',due4,'1h',due1);
  for(const interval of ['4h','1h']){
   if((interval==='4h'&&!due4)||(interval==='1h'&&!due1))continue;
   const btcRaw=await binance('klines?symbol=BTCUSDT&interval='+interval+'&limit=500');
   const btcCandles=Array.isArray(btcRaw)?btcRaw.slice(0,-1).map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})):[];
   const btcMarketRegime=classifyBtcRegime(btcCandles);
   console.log('BTC regime',interval,btcMarketRegime);
   let next=0,opened=0,closed=0,failed=0;const rejections={noSignal:0,signal:0,lateEntry:0,regime:0,odds:0,historyScore:0,cooldown:0,positionCap:0,cash:0};const backtestTrades=[];let backtestCoins=0,backtestBars=0;
   // Her sanal portföy için eşzamanlı taramalarda çift satış/alımı önle.
   const rotationLocks=Object.fromEntries(STRATEGIES.map(k=>[k,false]));
   async function worker(){
    while(next<coins.length){
     const coin=coins[next++];
     const symbol=coin.symbol;
     if(!livePrices.has(symbol))continue;
     const key=interval+'|'+symbol;
     try{
      const raw=await binance('klines?symbol='+symbol+'USDT&interval='+interval+'&limit=500');
      if(!Array.isArray(raw)||raw.length<110){failed++;continue}
      const candles=raw.slice(0,-1).map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
      const last=candles[candles.length-1];
      let analysisCache=null,formHistoryCache=null,formHistoryLoaded=false;
      if((coin.rank||999)<=100&&candles.length>=240){
       backtestTrades.push(...formasyonBacktest(candles,btcCandles,E,symbol));
       backtestCoins++;
       backtestBars=Math.max(backtestBars,candles.length);
      }
      const isNew=last.t>Number(s.lastBars[key]||0);
      for(const strategy of STRATEGIES){
       const book=s.strategies[strategy];
       let pos=book.positions.find(p=>p.symbol===symbol&&p.timeframe===interval);
       if(pos){
        pos.lastPrice=last.c;
        if(!isNew)continue;
        const stop=Number(pos.stop||Number(pos.entry)*.97),hitStop=last.l<=stop,hitTarget=last.h>=Number(pos.target1||pos.target);
        if(hitStop){const exit=last.o<stop?last.o:stop;closePos(book,pos,exit,'Stop-loss gerçekleşti',rate);closed++;continue}
        if(hitTarget){closePos(book,pos,Number(pos.target1||pos.target),'Hedef 1 gerçekleşti',rate);closed++;continue}
        const analysis=analyze(candles,E,btcCandles);
        if(analysis&&shouldExit(strategy,analysis)){const reason=strategy==='alSat'?'Trend/momentum çıkış sinyali':strategy==='formasyon'?'Ters formasyon çıkış sinyali':'Birleşik ters sinyal';closePos(book,pos,last.c,reason,rate);closed++;}
        continue;
       }
       if(!isNew||book.positions.some(p=>p.symbol===symbol))continue;
       const cooldownKey=symbol+'|'+interval;
       if(Number(book.cooldowns&&book.cooldowns[cooldownKey]||0)>Date.now()){rejections.cooldown++;continue;}
       const analysis=analysisCache||(analysisCache=analyze(candles,E,btcCandles));
       if(!analysis){rejections.noSignal++;continue}
        if(!allowed(strategy,analysis)){if(analysis.indicatorContext&&!analysis.indicatorContext.entryQuality)rejections.lateEntry++;else rejections.signal++;continue}
        let historyScore=null;
        if(strategy==='formasyon'){
         if(!formHistoryLoaded){
          formHistoryLoaded=true;
          const yearCandles=await fetchOneYearCandles(symbol,interval);
          formHistoryCache=scoreHistoricalPattern(yearCandles,E,analysis.pattern.name);
          console.log('Formasyon history',symbol,interval,formHistoryCache.weightedScore,formHistoryCache.year,formHistoryCache.lastSixMonths);
         }
         historyScore=formHistoryCache;
         if(!historyScore||!(historyScore.weightedScore>60)){rejections.historyScore++;continue}
        }
        if(!regimeAllows(strategy,analysis,btcMarketRegime)){rejections.regime++;continue}
        if(rotationLocks[strategy])continue;
       rotationLocks[strategy]=true;
       try{
        const ticker=await binance('ticker/price?symbol='+symbol+'USDT');
        const entry=Number(ticker.price);
        if(!(entry>0))continue;
        const liveLv=levels(strategy,analysis,entry),total=equity(book,rate);
        const target1NetPct=((liveLv.target1/entry)*(1-FEE)/(1+FEE)-1)*100;
        const stopDistance=Math.max(analysis.atr*1.5,entry*.008),stopPct=stopDistance/entry;
        const odds=strategy==='alSat'?historicalOdds(candles,btcCandles,E,strategy,analysis,entry,liveLv,btcMarketRegime):{samples:0,target1ProbabilityPct:null,target2ProbabilityPct:null,adverseProbabilityPct:null,expectedNetPct:null,profitFactor:null,wilsonLowerPct:null};
        if(strategy==='alSat'&&!entryAllowedByOdds(odds,analysis)){rejections.odds++;continue;}
        if(!(target1NetPct>=stopPct*1.35)){rejections.odds++;continue;}
        const riskBudgetTL=total*.0075,allocationTL=Math.min(total*MAX_ALLOC,riskBudgetTL/Math.max(stopPct,.005));
        const allocUsd=allocationTL*rate,desiredQty=allocUsd/entry;
        const desiredCostTL=desiredQty*entry/rate*(1+FEE);
        // Yeni sinyal, açık pozisyonu sırf nakit yaratmak için kapatmaz.
        // Mevcut işlemler yalnızca hedef, stop veya çıkış kuralıyla kapanır.
        if(book.positions.length>=MAX_POSITIONS){rejections.positionCap++;continue}
        if(book.cash<desiredCostTL*0.90){rejections.cash++;continue}
        const cashUsd=book.cash*rate;
        const qty=Math.min(desiredQty,cashUsd/(entry*(1+FEE)));
        const costTL=qty*entry/rate*(1+FEE);
        if(!(qty>0)||!Number.isFinite(costTL)||costTL>book.cash)continue;
        book.cash-=costTL;
        book.positions.push({
        id:strategy+'-'+interval+'-'+symbol+'-'+last.t,
        strategy,symbol,name:coin.name,timeframe:interval,qty,entry,lastPrice:entry,
        target:liveLv.target1,target1:liveLv.target1,target2:liveLv.target2,stop:entry-stopDistance,costTL,
        target1ProbabilityPct:odds.target1ProbabilityPct,target2ProbabilityPct:odds.target2ProbabilityPct,adverseProbabilityPct:odds.adverseProbabilityPct,expectedNetPct:odds.expectedNetPct,profitFactor:odds.profitFactor,probabilitySamples:odds.samples,entryQuality:analysis.indicatorContext.entryQuality,extensionAtr:analysis.indicatorContext.extensionAtr,
        pattern:analysis.pattern&&analysis.pattern.name||(strategy==='alSat'?'Al/Sat sinyali':'Yükseliş formasyonu'),btcRegime:btcMarketRegime,
        indicatorPassCount:analysis.indicatorPassCount,indicatorChecks:analysis.indicatorChecks,volumeRatio:analysis.volumeRatio,volumeStrong:analysis.volumeStrong,
        formasyonScore:historyScore?historyScore.weightedScore:null,formasyonHistory:historyScore?{year:historyScore.year,lastSixMonths:historyScore.lastSixMonths,yearWinRatePct:historyScore.yearWinRatePct,lastSixMonthsWinRatePct:historyScore.lastSixMonthsWinRatePct}:null,
        openedAt:Date.now(),entryBar:last.t
       });
        opened++;
       }finally{
        rotationLocks[strategy]=false;
       }
      }
      if(isNew)s.lastBars[key]=last.t;
     }catch(e){
      failed++;
      if(failed<5)console.log(symbol,e.message);
     }
    }
   }
   await Promise.all(Array.from({length:6},worker));
   s.formasyonBacktest=s.formasyonBacktest||{};
   s.formasyonBacktest[interval]={...summarizeFormasyonWalkForward(backtestTrades,interval,backtestCoins,backtestBars),updatedAt:new Date().toISOString()};
   s.scanBars[interval]=interval==='4h'?closed4:closed1;
   console.log(interval,{opened,closed,failed,rejections});
  }
 }

 s.updatedAt=new Date().toISOString();
 s.active=true;
 let totalEquity=0,totalPnl=0,totalOpen=0;
 for(const strategy of STRATEGIES){
  const book=s.strategies[strategy];
  for(const pos of book.positions){if(!pos.target1)pos.target1=Number(pos.target)||Number(pos.entry);if(!pos.target2)pos.target2=pos.target1;if(!(Number(pos.stop)>0))pos.stop=Number(pos.entry)*.97;}
  const value=equity(book,rate);
  const pnl=value-START;
  totalEquity+=value;
  totalPnl+=pnl;
  totalOpen+=book.positions.length;
  book.summary={
   equityTL:value,pnlTL:pnl,returnPct:(value/START-1)*100,
   realizedTL:book.trades.reduce((sum,t)=>sum+t.pnl,0),
   openPositions:book.positions.length,cashTL:book.cash,
   exposureTL:book.positions.reduce((sum,p)=>sum+p.qty*p.lastPrice/rate*(1-FEE),0)
  };
 }
 s.summary={equityTL:totalEquity,pnlTL:totalPnl,returnPct:(totalEquity/30000-1)*100,openPositions:totalOpen};
 fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2)+'\n');
 console.log('Saved state',s.summary);
}
main().catch(e=>{console.error(e);process.exit(1)});
