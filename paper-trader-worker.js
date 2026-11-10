'use strict';
const fs=require('fs'),https=require('https'),vm=require('vm');
const STATE_FILE='paper-portfolio.json',START=10000,FEE=.001,MAX_POSITIONS=10,MAX_ALLOC=.20,MIN_MATCHES=30,ENTRY_T1_PROB=60,EXIT_T1_PROB=35,EXIT_ADVERSE_PROB=65,OUTCOME_HORIZON=24;
const STRATEGIES=['alSat','formasyon','birlesik'];
const EXCLUDED=new Set(['USDT','USDC','BUSD','FDUSD','TUSD','DAI','USDE','USDS','USD1','PYUSD','EURC','USTC','USDD','FRAX','USDP','USDX','WBTC','STETH','WSTETH']);
function get(url,timeout=15000){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'user-agent':'VCrypto-paper-simulation/2.0','accept':'application/json'}},res=>{let b='';res.setEncoding('utf8');res.on('data',x=>b+=x);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('HTTP '+res.statusCode+' '+url));try{resolve(JSON.parse(b))}catch(e){reject(e)}})});req.setTimeout(timeout,()=>req.destroy(Error('timeout')));req.on('error',reject)})}
function extract(src,name){const marker='function '+name+'(';let i=src.indexOf(marker);if(i<0)throw Error('Missing function '+name);let brace=src.indexOf('{',i),depth=0,quote='',escape=false,lineComment=false,blockComment=false;for(let j=brace;j<src.length;j++){const c=src[j],n=src[j+1];if(lineComment){if(c==='\n')lineComment=false;continue}if(blockComment){if(c==='*'&&n==='/'){blockComment=false;j++}continue}if(quote){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===quote)quote='';continue}if(c==='/'&&n==='/'){lineComment=true;j++;continue}if(c==='/'&&n==='*'){blockComment=true;j++;continue}if(c==='"'||c==="'"||c==='`'){quote=c;continue}if(c==='{')depth++;if(c==='}'&&--depth===0)return src.slice(i,j+1)}throw Error('Unclosed '+name)}
async function engine(){const html=fs.readFileSync('index.html','utf8');const names=['emaArr','rsiArr','smaArr','buildSignalSeries','simulateSignal','optimizeSignal','linearSlope','detectChartPattern'];const code=names.map(n=>extract(html,n)).join('\n');return new Function(code+';return {buildSignalSeries,optimizeSignal,detectChartPattern};')()}
async function universe(){let rows=[];for(let page=1;page<=2;page++){const d=await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+page+'&sparkline=false');if(Array.isArray(d))rows.push(...d)}const seen=new Set(),out=[];for(const c of rows.sort((a,b)=>(a.market_cap_rank||999999)-(b.market_cap_rank||999999))){const s=String(c.symbol||'').toUpperCase();if(!/^[A-Z0-9]{2,15}$/.test(s)||EXCLUDED.has(s)||seen.has(s))continue;seen.add(s);out.push({symbol:s,name:c.name,rank:c.market_cap_rank});if(out.length===500)break}if(out.length<100)throw Error('CoinGecko universe unavailable ('+out.length+')');return out}
async function binance(path){for(const host of ['https://data-api.binance.vision/api/v3/','https://api.binance.com/api/v3/']){try{return await get(host+path)}catch(e){console.log('Binance fallback:',e.message)}}throw Error('Binance API unavailable')}
async function fxRate(){const d=await get('https://open.er-api.com/v6/latest/TRY');const r=Number(d.rates&&d.rates.USD);if(!(r>0))throw Error('FX rate unavailable');return r}
function blankBook(){return {initial:START,cash:START,positions:[],trades:[]}}
function blank(){return {initial:30000,strategies:{alSat:blankBook(),formasyon:blankBook(),birlesik:blankBook()},lastBars:{},scanBars:{},formasyonBacktest:{},fxRate:0,updatedAt:null,active:true,engine:'GitHub Actions · 5 dakika kontrol'}}
function readState(){try{const old=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));if(old.strategies)return {...blank(),...old,strategies:Object.fromEntries(STRATEGIES.map(k=>[k,{...blankBook(),...(old.strategies[k]||{})}]))}}catch(e){}return blank()}
function equity(b,rate){return b.cash+b.positions.reduce((a,p)=>a+p.qty*p.lastPrice/rate*(1-FEE),0)}
function closePos(b,p,price,reason,rate){const i=b.positions.findIndex(x=>x.id===p.id);if(i<0)return;const proceeds=p.qty*price/rate*(1-FEE),pnl=proceeds-p.costTL;b.cash+=proceeds;b.trades.push({strategy:p.strategy,symbol:p.symbol,timeframe:p.timeframe,entry:p.entry,exit:price,qty:p.qty,costTL:p.costTL,proceedsTL:proceeds,pnl,returnPct:p.costTL?pnl/p.costTL*100:0,reason,openedAt:p.openedAt,closedAt:Date.now()});b.positions.splice(i,1)}
function relativeStrength(candles,btcCandles){
 if(!Array.isArray(btcCandles)||candles.length<51||btcCandles.length<51)return null;
 const btcByTime=new Map(btcCandles.map(x=>[x.t,x.c]));
 const i=candles.length-1,now=candles[i],past20=candles[i-20],past50=candles[i-50];
 const btcNow=btcByTime.get(now.t),btc20=btcByTime.get(past20.t),btc50=btcByTime.get(past50.t);
 if(![now.c,past20.c,past50.c,btcNow,btc20,btc50].every(x=>Number.isFinite(x)&&x>0))return null;
 return {rs20:(now.c/past20.c)/(btcNow/btc20)-1,rs50:(now.c/past50.c)/(btcNow/btc50)-1};
}
function analyze(candles,E,btcCandles){const series=E.buildSignalSeries(candles),opt=E.optimizeSignal(series),i=series.scores.length-1,score=series.scores[i];if(score==null)return null;const entry=series.c[i],pattern=E.detectChartPattern(candles),trs=[];for(let j=Math.max(1,candles.length-15);j<candles.length;j++){const k=candles[j],pc=series.c[j-1];trs.push(Math.max(k.h-k.l,Math.abs(k.h-pc),Math.abs(k.l-pc)))}const atr=trs.length?trs.reduce((a,b)=>a+b,0)/trs.length:entry*.03,validated=opt.trainTrades>=3&&!!(opt.train&&opt.train.net>0)&&opt.test.trades>=3&&opt.test.net>0;const target=entry+2*atr;const alSignal=score>=opt.threshold&&validated&&target>entry?'AL':score<=-opt.threshold?'SAT':'NÖTR';const rs=relativeStrength(candles,btcCandles);const baselineVolumes=candles.slice(Math.max(0,i-25),i-5).map(x=>x.v).filter(x=>Number.isFinite(x)&&x>0);const recent=candles.slice(Math.max(0,i-4),i+1);const avgVolume=baselineVolumes.length===20?baselineVolumes.reduce((a,b)=>a+b,0)/20:null;const recentAvgVolume=recent.length===5?recent.reduce((a,x)=>a+(Number.isFinite(x.v)&&x.v>0?x.v:0),0)/5:null;const volumeRatio=avgVolume&&avgVolume>0&&recentAvgVolume!=null?recentAvgVolume/avgVolume:null;const bullishVolumeBars=recent.filter(x=>x.c>x.o).length;const volumeConfirmed=Number.isFinite(volumeRatio)&&volumeRatio>=1.2&&bullishVolumeBars>=3&&candles[i].c>candles[i-1].c;const last=candles[i],candleRange=Math.max(last.h-last.l,1e-12),bodyRatio=Math.abs(last.c-last.o)/candleRange,closeLocation=(last.c-last.l)/candleRange;const patternConfirmed=!!(pattern&&pattern.direction===1&&bodyRatio>=.4&&closeLocation>=.7&&last.c>candles[i-1].c&&pattern.qualityScore>=65);return {alSignal,pattern,patternConfirmed,validated,atr,atrTarget:target,score,threshold:opt.threshold,rs20:rs?rs.rs20:null,rs50:rs?rs.rs50:null,volumeRatio,volumeConfirmed}}
function allowed(strategy,a){const bull=!!(a.pattern&&a.pattern.direction===1);if(strategy==='alSat')return a.alSignal==='AL';if(strategy==='formasyon')return bull&&a.patternConfirmed===true;if(strategy==='birlesik')return a.alSignal==='AL'&&bull&&a.patternConfirmed===true;return false}
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
 if(strategy==='formasyon'){
  if(regime==='bull')return true;
  if(regime==='bear'||regime==='unknown')return false;
  return a.patternConfirmed===true&&a.volumeConfirmed===true&&
   Number.isFinite(a.pattern&&a.pattern.qualityScore)&&a.pattern.qualityScore>=75&&
   Number.isFinite(a.rs20)&&Number.isFinite(a.rs50)&&a.rs20>0&&a.rs50>0;
 }
 if(strategy!=='alSat'&&strategy!=='birlesik')return false;
 if(!(Number.isFinite(a.rs20)&&Number.isFinite(a.rs50)&&a.rs20>0&&a.rs50>0))return false;
 if(a.volumeConfirmed!==true)return false;
 if(regime==='bull')return true;
 if(regime==='bear'||regime==='unknown')return false;
 return a.score>=a.threshold+0.75;
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
  if(regime!=='unknown'&&historicalRegime!==regime)continue;
  const prefix=candles.slice(0,i+1),pattern=E.detectChartPattern(prefix);
  if(analysis.pattern){if(!pattern||pattern.name!==analysis.pattern.name||pattern.direction!==1)continue;if(Math.abs(Number(pattern.qualityScore||0)-Number(analysis.pattern.qualityScore||0))>15)continue}
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
function entryAllowedByOdds(o){
 // Ekrandaki strateji kurallarıyla aynı eşik: en az 30 benzer örnek,
 // Hedef 1 olasılığı en az %60 ve komisyon sonrası beklenen net getiri pozitif.
 // Ek olarak geçmiş örneklerde kâr faktörü 1.2 altındaysa işlem açma.
 return o.samples>=MIN_MATCHES&&o.target1ProbabilityPct>=ENTRY_T1_PROB&&
  o.expectedNetPct>0&&(o.profitFactor===null||o.profitFactor>=1.2);
}
function exitAllowedByOdds(o){
 return o.samples>=MIN_MATCHES&&o.target1ProbabilityPct<EXIT_T1_PROB&&
  o.adverseProbabilityPct>=EXIT_ADVERSE_PROB;
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
   if(candle.h>=pos.target1){finish(candle.o>pos.target1?candle.o:pos.target1,i,'Target 1');continue}
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
  pos={entry,target1:lv.target1,target2:lv.target2,entryTime:candles[i+1].t,quality:pattern.qualityScore};
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
  interval,coinsTested,bars,method:'Chronological 3-fold exit test; next-candle-open entries; Target 1 or confirmed bearish pattern exits; no stop-loss; 0.1% fee each side; live entries additionally require 30+ historical analogs and probability thresholds',
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
   // Close legacy daily positions at the live quote when migrating the test to 1h.
   if(pos.timeframe==='1d'){
    closePos(book,pos,live,'Zaman dilimi değişimi: 1 günlük testten 1 saatliğe geçiş',rate);
    continue;
   }
   if(!pos.target1)pos.target1=Number(pos.target)||Number(live);
   if(!pos.target2)pos.target2=pos.target1;
   delete pos.stop;
   if(live>=pos.target1)closePos(book,pos,pos.target1,'Hedef 1 gerçekleşti (canlı fiyat kontrolü)',rate);
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
   let next=0,opened=0,closed=0,failed=0;const backtestTrades=[];let backtestCoins=0,backtestBars=0;
   // Her sanal portföy için eşzamanlı taramalarda çift satış/alımı önle.
   const rotationLocks=Object.fromEntries(STRATEGIES.map(k=>[k,false]));
   async function worker(){
    while(next<coins.length){
     const coin=coins[next++];
     const symbol=coin.symbol;
     const key=interval+'|'+symbol;
     try{
      const raw=await binance('klines?symbol='+symbol+'USDT&interval='+interval+'&limit=500');
      if(!Array.isArray(raw)||raw.length<110){failed++;continue}
      const candles=raw.slice(0,-1).map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
      const last=candles[candles.length-1];
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
        if(last.h>=Number(pos.target1||pos.target)){closePos(book,pos,Number(pos.target1||pos.target),'Hedef 1 gerçekleşti',rate);closed++;continue}
        const analysis=analyze(candles,E,btcCandles);
        if(analysis&&shouldExit(strategy,analysis)){
         const odds=historicalOdds(candles,btcCandles,E,strategy,analysis,last.c,{target1:Number(pos.target1||pos.target),target2:Number(pos.target2||pos.target1||pos.target)},btcMarketRegime);
         pos.lastOdds=odds;
         if(exitAllowedByOdds(odds)){const reason=strategy==='alSat'?'SAT sinyali + olasılık teyitli düşüş riski':strategy==='formasyon'?'Aşağı yönlü formasyon + olasılık teyitli düşüş riski':'Ters sinyal + olasılık teyitli düşüş riski';closePos(book,pos,last.c,reason,rate);closed++}
        }
        continue;
       }
       if(!isNew||book.positions.some(p=>p.symbol===symbol&&p.timeframe===interval))continue;
       const analysis=analyze(candles,E,btcCandles);
       if(!analysis||!allowed(strategy,analysis)||!regimeAllows(strategy,analysis,btcMarketRegime)||rotationLocks[strategy])continue;
       const oddsLevels=levels(strategy,analysis,last.c),odds=historicalOdds(candles,btcCandles,E,strategy,analysis,last.c,oddsLevels,btcMarketRegime);
       if(!entryAllowedByOdds(odds))continue;
       rotationLocks[strategy]=true;
       try{
        const ticker=await binance('ticker/price?symbol='+symbol+'USDT');
        const entry=Number(ticker.price);
        if(!(entry>0))continue;
        const liveLv=levels(strategy,analysis,entry),total=equity(book,rate);
        const target1NetPct=((liveLv.target1/entry)*(1-FEE)/(1+FEE)-1)*100;
        const edgeFactor=Math.max(.25,Math.min(1,(odds.target1ProbabilityPct/100)*(odds.expectedNetPct/Math.max(target1NetPct,.1))));
        const allocUsd=total*MAX_ALLOC*edgeFactor*rate,desiredQty=allocUsd/entry;
        const desiredCostTL=desiredQty*entry/rate*(1+FEE);
        // Yeni fırsatı, eldeki pozisyonların hedefe kalan net getirisiyle kıyasla.
        // Yalnızca daha iyi fırsat varsa ve yeterli nakit/pozisyon yeri yoksa rotasyon yap.
        if(book.cash<desiredCostTL*0.90||book.positions.length>=MAX_POSITIONS){
         const newNetPct=odds.expectedNetPct;
         const candidates=book.positions.map(p=>{const live=livePrices.get(p.symbol)||p.lastPrice||p.entry,remainingNetPct=Number(p.expectedNetPct)||-Infinity,exitValue=p.qty*live/rate*(1-FEE),exitPnl=exitValue-p.costTL;return {p,live,remainingNetPct,exitPnl}}).filter(x=>x.remainingNetPct+0.75<newNetPct);
         // Uygun pozisyonlar arasından satış anındaki zararı en az olanı seç.
         candidates.sort((a,b)=>b.exitPnl-a.exitPnl);
         const chosen=candidates[0];
         if(chosen){
          chosen.p.lastPrice=chosen.live;
          closePos(book,chosen.p,chosen.live,'Daha güçlü yeni fırsat için pozisyon rotasyonu',rate);
          closed++;
         }
        }
        if(book.positions.length>=MAX_POSITIONS||book.cash<desiredCostTL*0.90)continue;
        const cashUsd=book.cash*rate;
        const qty=Math.min(desiredQty,cashUsd/(entry*(1+FEE)));
        const costTL=qty*entry/rate*(1+FEE);
        if(!(qty>0)||!Number.isFinite(costTL)||costTL>book.cash)continue;
        book.cash-=costTL;
        book.positions.push({
        id:strategy+'-'+interval+'-'+symbol+'-'+last.t,
        strategy,symbol,name:coin.name,timeframe:interval,qty,entry,lastPrice:entry,
        target:liveLv.target1,target1:liveLv.target1,target2:liveLv.target2,costTL,
        target1ProbabilityPct:odds.target1ProbabilityPct,target2ProbabilityPct:odds.target2ProbabilityPct,adverseProbabilityPct:odds.adverseProbabilityPct,expectedNetPct:odds.expectedNetPct,probabilitySamples:odds.samples,
        pattern:analysis.pattern&&analysis.pattern.name||(strategy==='alSat'?'Al/Sat sinyali':'Yükseliş formasyonu'),btcRegime:btcMarketRegime,
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
   console.log(interval,{opened,closed,failed});
  }
 }

 s.updatedAt=new Date().toISOString();
 s.active=true;
 let totalEquity=0,totalPnl=0,totalOpen=0;
 for(const strategy of STRATEGIES){
  const book=s.strategies[strategy];
  for(const pos of book.positions){if(!pos.target1)pos.target1=Number(pos.target)||Number(pos.entry);if(!pos.target2)pos.target2=pos.target1;delete pos.stop;}
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
