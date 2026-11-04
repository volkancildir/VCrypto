'use strict';
const fs=require('fs'),https=require('https'),vm=require('vm');
const STATE_FILE='paper-portfolio.json',START=10000,FEE=.001,MAX_POSITIONS=10,RISK=.01,MAX_ALLOC=.20;
const STRATEGIES=['alSat','formasyon','birlesik'];
const EXCLUDED=new Set(['USDT','USDC','BUSD','FDUSD','TUSD','DAI','USDE','USDS','USD1','PYUSD','EURC','USTC','USDD','FRAX','USDP','USDX','WBTC','STETH','WSTETH']);
function get(url,timeout=15000){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'user-agent':'VCrypto-paper-simulation/2.0','accept':'application/json'}},res=>{let b='';res.setEncoding('utf8');res.on('data',x=>b+=x);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('HTTP '+res.statusCode+' '+url));try{resolve(JSON.parse(b))}catch(e){reject(e)}})});req.setTimeout(timeout,()=>req.destroy(Error('timeout')));req.on('error',reject)})}
function extract(src,name){const marker='function '+name+'(';let i=src.indexOf(marker);if(i<0)throw Error('Missing function '+name);let brace=src.indexOf('{',i),depth=0,quote='',escape=false,lineComment=false,blockComment=false;for(let j=brace;j<src.length;j++){const c=src[j],n=src[j+1];if(lineComment){if(c==='\n')lineComment=false;continue}if(blockComment){if(c==='*'&&n==='/'){blockComment=false;j++}continue}if(quote){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===quote)quote='';continue}if(c==='/'&&n==='/'){lineComment=true;j++;continue}if(c==='/'&&n==='*'){blockComment=true;j++;continue}if(c==='"'||c==="'"||c==='`'){quote=c;continue}if(c==='{')depth++;if(c==='}'&&--depth===0)return src.slice(i,j+1)}throw Error('Unclosed '+name)}
async function engine(){const html=fs.readFileSync('index.html','utf8');const names=['emaArr','rsiArr','smaArr','buildSignalSeries','simulateSignal','optimizeSignal','linearSlope','detectChartPattern'];const code=names.map(n=>extract(html,n)).join('\n');return new Function(code+';return {buildSignalSeries,optimizeSignal,detectChartPattern};')()}
async function universe(){let rows=[];for(let page=1;page<=2;page++){const d=await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+page+'&sparkline=false');if(Array.isArray(d))rows.push(...d)}const seen=new Set(),out=[];for(const c of rows.sort((a,b)=>(a.market_cap_rank||999999)-(b.market_cap_rank||999999))){const s=String(c.symbol||'').toUpperCase();if(!/^[A-Z0-9]{2,15}$/.test(s)||EXCLUDED.has(s)||seen.has(s))continue;seen.add(s);out.push({symbol:s,name:c.name,rank:c.market_cap_rank});if(out.length===500)break}if(out.length<100)throw Error('CoinGecko universe unavailable ('+out.length+')');return out}
async function binance(path){for(const host of ['https://data-api.binance.vision/api/v3/','https://api.binance.com/api/v3/']){try{return await get(host+path)}catch(e){console.log('Binance fallback:',e.message)}}throw Error('Binance API unavailable')}
async function fxRate(){const d=await get('https://open.er-api.com/v6/latest/TRY');const r=Number(d.rates&&d.rates.USD);if(!(r>0))throw Error('FX rate unavailable');return r}
function blankBook(){return {initial:START,cash:START,positions:[],trades:[]}}
function blank(){return {initial:30000,strategies:{alSat:blankBook(),formasyon:blankBook(),birlesik:blankBook()},lastBars:{},scanBars:{},fxRate:0,updatedAt:null,active:true,engine:'GitHub Actions · 5 dakika kontrol'}}
function readState(){try{const old=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));if(old.strategies)return {...blank(),...old,strategies:Object.fromEntries(STRATEGIES.map(k=>[k,{...blankBook(),...(old.strategies[k]||{})}]))}}catch(e){}return blank()}
function equity(b,rate){return b.cash+b.positions.reduce((a,p)=>a+p.qty*p.lastPrice/rate*(1-FEE),0)}
function closePos(b,p,price,reason,rate){const i=b.positions.findIndex(x=>x.id===p.id);if(i<0)return;const proceeds=p.qty*price/rate*(1-FEE),pnl=proceeds-p.costTL;b.cash+=proceeds;b.trades.push({strategy:p.strategy,symbol:p.symbol,timeframe:p.timeframe,entry:p.entry,exit:price,qty:p.qty,costTL:p.costTL,proceedsTL:proceeds,pnl,returnPct:p.costTL?pnl/p.costTL*100:0,reason,openedAt:p.openedAt,closedAt:Date.now()});b.positions.splice(i,1)}
function analyze(candles,E){const series=E.buildSignalSeries(candles),opt=E.optimizeSignal(series),i=series.scores.length-1,score=series.scores[i];if(score==null)return null;const entry=series.c[i],pattern=E.detectChartPattern(candles),trs=[];for(let j=Math.max(1,candles.length-15);j<candles.length;j++){const k=candles[j],pc=series.c[j-1];trs.push(Math.max(k.h-k.l,Math.abs(k.h-pc),Math.abs(k.l-pc)))}const atr=trs.length?trs.reduce((a,b)=>a+b,0)/trs.length:entry*.03,validated=opt.test.trades>=3&&opt.test.net>0;const stop=entry-1.5*atr,target=entry+2*atr,rr=(target-entry)/Math.max(entry-stop,1e-9);const alSignal=score>=opt.threshold&&validated&&rr>=1.2?'AL':score<=-opt.threshold?'SAT':'NÖTR';return {alSignal,pattern,validated,atr,atrTarget:target,atrStop:stop,score}}
function allowed(strategy,a){const bull=!!(a.pattern&&a.pattern.direction===1);if(strategy==='alSat')return a.alSignal==='AL';if(strategy==='formasyon')return bull;if(strategy==='birlesik')return a.alSignal==='AL'&&bull;return false}
function shouldExit(strategy,a){if(strategy==='alSat')return a.alSignal==='SAT';if(strategy==='formasyon')return !!(a.pattern&&a.pattern.direction===-1);return a.alSignal==='SAT'||!!(a.pattern&&a.pattern.direction===-1)}
function levels(strategy,a,entry){let stop=strategy!=='alSat'&&a.pattern?Number(a.pattern.stop):a.atrStop,target=strategy!=='alSat'&&a.pattern&&a.pattern.targets?Number(a.pattern.targets[0]):a.atrTarget;if(!(stop>0&&stop<entry))stop=entry-1.5*a.atr;if(!(target>entry))target=entry+2*a.atr;return {stop,target}}
async function main(){
 const s=readState();
 const reset=process.env.RESET_STRATEGY;
 const resetApplied=STRATEGIES.includes(reset);
 if(resetApplied){s.strategies[reset]=blankBook();console.log('Reset strategy:',reset,'to 10000 TL')}
 const E=await engine();
 const rate=await fxRate();
 s.fxRate=rate;

 // Live target/stop checks are independent for each virtual account.
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
   if(live<=pos.stop)closePos(book,pos,pos.stop,'Zarar-kes (canlı fiyat kontrolü)',rate);
   else if(live>=pos.target)closePos(book,pos,pos.target,'Hedef (canlı fiyat kontrolü)',rate);
  }
 }

 // The former daily timeframe is replaced by 1-hour candles.
 const btc4=await binance('klines?symbol=BTCUSDT&interval=4h&limit=3');
 const btc1=await binance('klines?symbol=BTCUSDT&interval=1h&limit=3');
 const closed4=Number(btc4[btc4.length-2][0]);
 const closed1=Number(btc1[btc1.length-2][0]);
 const due4=closed4>Number(s.scanBars['4h']||0);
 const due1=closed1>Number(s.scanBars['1h']||0);

 if((due4||due1)&&!resetApplied){
  const coins=await universe();
  console.log('Universe',coins.length,'4h',due4,'1h',due1);
  for(const interval of ['4h','1h']){
   if((interval==='4h'&&!due4)||(interval==='1h'&&!due1))continue;
   let next=0,opened=0,closed=0,failed=0;
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
      const isNew=last.t>Number(s.lastBars[key]||0);
      for(const strategy of STRATEGIES){
       const book=s.strategies[strategy];
       let pos=book.positions.find(p=>p.symbol===symbol&&p.timeframe===interval);
       if(pos){
        pos.lastPrice=last.c;
        if(!isNew)continue;
        const hitTarget=last.h>=pos.target;
        const hitStop=last.l<=pos.stop;
        if(hitTarget&&hitStop){closePos(book,pos,pos.stop,'Aynı mumda hedef ve stop: stop varsayıldı',rate);closed++;continue}
        if(hitStop){closePos(book,pos,pos.stop,'Zarar-kes',rate);closed++;continue}
        if(hitTarget){closePos(book,pos,pos.target,'Hedef gerçekleşti',rate);closed++;continue}
        const analysis=analyze(candles,E);
        if(analysis&&shouldExit(strategy,analysis)){
         const reason=strategy==='alSat'?'SAT sinyali':strategy==='formasyon'?'Aşağı yönlü formasyon':'SAT veya aşağı yönlü formasyon';
         closePos(book,pos,last.c,reason,rate);
         closed++;
        }
        continue;
       }
       if(!isNew||book.positions.some(p=>p.symbol===symbol&&p.timeframe===interval))continue;
       const analysis=analyze(candles,E);
       if(!analysis||!allowed(strategy,analysis)||rotationLocks[strategy])continue;
       rotationLocks[strategy]=true;
       try{
        const ticker=await binance('ticker/price?symbol='+symbol+'USDT');
        const entry=Number(ticker.price);
        if(!(entry>0))continue;
        const lv=levels(strategy,analysis,entry);
        const total=equity(book,rate);
        const riskUsd=total*RISK*rate;
        const allocUsd=total*MAX_ALLOC*rate;
        const desiredQty=Math.min(
         riskUsd/Math.max(entry-lv.stop,entry*.0005),
         allocUsd/entry
        );
        const desiredCostTL=desiredQty*entry/rate*(1+FEE);
        // Yeni fırsatı, eldeki pozisyonların hedefe kalan net getirisiyle kıyasla.
        // Yalnızca daha iyi fırsat varsa ve yeterli nakit/pozisyon yeri yoksa rotasyon yap.
        if(book.cash<desiredCostTL*0.90||book.positions.length>=MAX_POSITIONS){
         const newNetPct=((lv.target/entry)*(1-FEE)/(1+FEE)-1)*100;
         const candidates=book.positions.map(p=>{
          const live=livePrices.get(p.symbol)||p.lastPrice||p.entry;
          const remainingNetPct=((p.target/live)*(1-FEE)/(1+FEE)-1)*100;
          const exitValue=p.qty*live/rate*(1-FEE);
          const exitPnl=exitValue-p.costTL;
          return {p,live,remainingNetPct,exitPnl};
         }).filter(x=>x.remainingNetPct+0.75<newNetPct);
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
        target:lv.target,stop:lv.stop,costTL,
        pattern:analysis.pattern&&analysis.pattern.name||(strategy==='alSat'?'Al/Sat sinyali':'Yükseliş formasyonu'),
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
   s.scanBars[interval]=interval==='4h'?closed4:closed1;
   console.log(interval,{opened,closed,failed});
  }
 }

 s.updatedAt=new Date().toISOString();
 s.active=true;
 let totalEquity=0,totalPnl=0,totalOpen=0;
 for(const strategy of STRATEGIES){
  const book=s.strategies[strategy];
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
