'use strict';
const fs=require('node:fs');
global.window={};
global.localStorage={getItem:()=>null,setItem:()=>{}};
require('./pattern-engine.js');
const engine=global.window.VCryptoPatternEngine;
if(!engine||typeof engine.scan!=='function')throw new Error('Pattern engine yüklenemedi');
const OUTPUT='pattern-results.json';
const TFS={
 '1h':{interval:'1h',limit:120,label:'1 saatlik'},
 '4h':{interval:'4h',limit:120,label:'4 saatlik'},
 '1d':{interval:'1d',limit:120,label:'1 günlük'},
 '1w':{interval:'1w',limit:120,label:'1 haftalık'},
 '1M':{interval:'1M',limit:100,label:'1 aylık'},
 '1y':{interval:'1w',limit:100,label:'1 yıllık · haftalık mumlar'}
};
const excluded=c=>{const s=String(c.symbol||'').toUpperCase(),id=String(c.id||'').toLowerCase(),n=String(c.name||'').toLowerCase();return s==='FIGR_HELOC'||id==='figure-heloc'||s==='SSTN'||s==='PC0000031'||id.includes('rent-financing')||n.includes('rent financing platform')||n.includes('tradable na')};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url,tries=3){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok){const e=new Error('HTTP '+r.status);e.status=r.status;throw e}return await r.json()}catch(e){last=e;if(e.status&&e.status!==429&&e.status<500)throw e;if(i+1<tries)await sleep(e.status===429?Math.min(12000,2500*(i+1)):500*(i+1))}}throw last||Error('Veri alınamadı')}
function normIdentity(v){return String(v||'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
function normTicker(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
async function getUniverse(){
 let cg=[],cp=[];
 try{
  const pages=await Promise.all([1,2,3].map(p=>json('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+p+'&sparkline=false')));
  const m=new Map();pages.flat().filter(c=>c&&c.id&&!excluded(c)).forEach(c=>{if(!m.has(c.id))m.set(c.id,c)});
  cg=[...m.values()].sort((x,y)=>(Number(x.market_cap_rank)||999999)-(Number(y.market_cap_rank)||999999)).slice(0,500);
  if(cg.length<450)throw Error('CoinGecko listesi eksik: '+cg.length);
 }catch(e){console.log('CoinGecko evreni alınamadı:',e.message)}
 try{
  const raw=await json('https://api.coinpaprika.com/v1/tickers?quotes=USD');
  cp=raw.filter(c=>c&&c.id&&!excluded({id:c.id,name:c.name,symbol:c.symbol})&&Number(c.quotes?.USD?.price)>0)
   .sort((x,y)=>(Number(x.rank)||999999)-(Number(y.rank)||999999)).slice(0,500)
   .map(c=>({id:c.id,name:c.name,symbol:c.symbol,image:'https://static.coinpaprika.com/coin/'+c.id+'/logo.png',market_cap_rank:Number(c.rank)||null,coinpaprika_id:c.id,coingecko_id:null}));
  if(cp.length<400)throw Error('CoinPaprika listesi eksik: '+cp.length);
 }catch(e){console.log('CoinPaprika evreni alınamadı:',e.message);cp=[]}
 if(!cg.length&&!cp.length)throw Error('CoinGecko ve CoinPaprika coin listeleri alınamadı');
 if(!cg.length)return cp.map(c=>({...c,id:'cp:'+c.id}));
 if(!cp.length)return cg.map(c=>({...c,coingecko_id:c.id,coinpaprika_id:null}));
 const combined=cg.map(c=>({...c,coingecko_id:c.id,coinpaprika_id:null}));
 const pairMap=new Map(),symbolMap=new Map();
 const add=(map,key,item)=>{if(!key)return;const a=map.get(key)||[];a.push(item);map.set(key,a)};
 for(const c of combined){const s=normTicker(c.symbol),n=normIdentity(c.name);add(pairMap,s+'|'+n,c);add(symbolMap,s,c)}
 let linked=0,extra=0;
 for(const p of cp){
  const s=normTicker(p.symbol),n=normIdentity(p.name),pair=pairMap.get(s+'|'+n)||[];
  let match=pair.length===1?pair[0]:null;
  if(!match){
   const candidates=(symbolMap.get(s)||[]).map(c=>({c,diff:Math.abs(Number(c.market_cap_rank||999999)-Number(p.market_cap_rank||999999))})).sort((a,b)=>a.diff-b.diff);
   if(candidates.length&&candidates[0].diff<=5&&(!candidates[1]||candidates[1].diff!==candidates[0].diff))match=candidates[0].c;
  }
  if(match&&!match.coinpaprika_id){match.coinpaprika_id=p.id;linked++}
  else{combined.push({...p,id:'cp:'+p.id});extra++}
 }
 combined.sort((x,y)=>(Number(x.market_cap_rank)||999999)-(Number(y.market_cap_rank)||999999));
 console.log('Coin sağlayıcıları birleştirildi:',{coingecko:cg.length,coinpaprika:cp.length,linked,coinpaprikaOnly:extra,universe:combined.length});
 return combined;
}
function orderedRows(rows){return rows.filter(x=>x&&x.length>=6).map(x=>x.map(Number)).filter(x=>Number.isFinite(x[0])&&x.slice(1,6).every(Number.isFinite)).sort((a,b)=>a[0]-b[0])}
function parseBinanceRows(list){return orderedRows((list||[]).map(k=>[k[0],k[1],k[2],k[3],k[4],k[5]]))}
function parseOkxRows(list){return orderedRows((list||[]).map(k=>[k[0],k[1],k[2],k[3],k[4],k[5]]))}
function parseGateRows(list){return orderedRows((list||[]).map(k=>[Number(k[0])*1000,k[5],k[3],k[4],k[2],k[6]||Number(k[1])/Math.max(Number(k[2]),1e-12)]))}
function parseKucoinRows(list){return orderedRows((list||[]).map(k=>[Number(k[0])*1000,k[1],k[3],k[4],k[2],k[5]]))}
function parseBitgetRows(list){return orderedRows((list||[]).map(k=>[k[0],k[1],k[2],k[3],k[4],k[5]]))}
function parseMexcRows(list){return parseBinanceRows(list)}
function assertParserRows(name,rows){if(rows.length!==30||rows[0][0]!==1700000000000||rows[0][1]!==10||rows[0][2]!==12||rows[0][3]!==9||rows[0][4]!==11||rows[0][5]!==100)throw Error(name+' mum dönüştürme testi başarısız');}
function runParserSelfTests(){
 const t=1700000000000,binance=[t,10,12,9,11,100],okx=[t,10,12,9,11,100],gate=[t/1000,1100,11,12,9,10,100],kucoin=[t/1000,10,11,12,9,100,1100],bitget=[t,10,12,9,11,100,1100];
 const cases=[['Binance',parseBinanceRows],['OKX',parseOkxRows],['Gate',parseGateRows],['KuCoin',parseKucoinRows],['MEXC',parseMexcRows],['Bitget',parseBitgetRows]];
 for(const [name,parse] of cases){const raw=Array.from({length:30},(_,i)=>{const x=[...({Binance:binance,OKX:okx,Gate:gate,KuCoin:kucoin,MEXC:binance,Bitget:bitget}[name])];if(name==='Gate'||name==='KuCoin')x[0]=String(t/1000+i*3600);else x[0]=t+i*3600000;return x});const rows=parse(raw);if(rows.length!==30)throw Error(name+' parser satır sayısı testi başarısız');const first=rows[0];if(first[1]!==10||first[2]!==12||first[3]!==9||first[4]!==11||first[5]!==100)throw Error(name+' OHLCV alan testi başarısız')}
 console.log('Parser self-test: Binance, OKX, Gate, KuCoin, MEXC, Bitget başarılı');
}
runParserSelfTests();
async function klines(symbol,tf){
 const base=symbol.replace(/USDT$/,'');
 const q='klines?symbol='+encodeURIComponent(symbol)+'&interval='+tf.interval+'&limit='+tf.limit;
 let binanceError;
 for(const host of ['https://data-api.binance.vision/api/v3/','https://api.binance.com/api/v3/']){
  try{const rows=parseBinanceRows(await json(host+q,1));if(rows.length<30)throw Error('Yeterli Binance mumu yok');return{rows,source:'Binance Spot'}}catch(e){binanceError=e}
 }
 let bybitError;
 try{
  const interval={'1h':'60','4h':'240','1d':'D','1w':'W','1M':'M'}[tf.interval];
  const data=await json('https://api.bybit.com/v5/market/kline?category=spot&symbol='+encodeURIComponent(symbol)+'&interval='+interval+'&limit='+tf.limit,1);
  const rows=parseOkxRows(data?.retCode===0?data.result?.list:[]);
  if(rows.length<30)throw Error(data?.retMsg||'Yeterli Bybit Spot mumu yok');
  return{rows,source:'Bybit Spot'};
 }catch(e){bybitError=e}
 let okxError;
 try{
  const bar={'1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'}[tf.interval],inst=base+'-USDT';
  const data=await json('https://www.okx.com/api/v5/market/candles?instId='+encodeURIComponent(inst)+'&bar='+bar+'&limit='+tf.limit,1);
  const rows=parseOkxRows(data?.code==='0'?data.data:[]);
  if(rows.length<30)throw Error(data?.msg||'Yeterli OKX Spot mumu yok');
  return{rows,source:'OKX Spot'};
 }catch(e){okxError=e}
 let gateError;
 try{
  const interval={'1h':'1h','4h':'4h','1d':'1d','1w':'7d','1M':'30d'}[tf.interval],pair=base+'_USDT';
  const data=await json('https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair='+encodeURIComponent(pair)+'&interval='+interval+'&limit='+tf.limit,1);
  const rows=parseGateRows(Array.isArray(data)?data:[]);
  if(rows.length<30)throw Error('Yeterli Gate.io Spot mumu yok');
  return{rows,source:'Gate.io Spot'};
 }catch(e){gateError=e}
 let kucoinError;
 try{
  const type={'1h':'1hour','4h':'4hour','1d':'1day','1w':'1week','1M':'1month'}[tf.interval],seconds={'1h':3600,'4h':14400,'1d':86400,'1w':604800,'1M':2592000}[tf.interval],end=Math.floor(Date.now()/1000),start=end-seconds*(tf.limit+10);
  const data=await json('https://api.kucoin.com/api/v1/market/candles?symbol='+encodeURIComponent(base+'-USDT')+'&type='+type+'&startAt='+start+'&endAt='+end,1);
  const rows=parseKucoinRows(data?.code==='200000'?data.data:[]);
  if(rows.length<30)throw Error(data?.msg||'Yeterli KuCoin Spot mumu yok');
  return{rows:rows.slice(-tf.limit),source:'KuCoin Spot'};
 }catch(e){kucoinError=e}
 let mexcError;
 try{
  const interval={'1h':'1h','4h':'4h','1d':'1d','1w':'1W','1M':'1M'}[tf.interval];
  const data=await json('https://api.mexc.com/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval='+interval+'&limit='+tf.limit,1);
  const rows=parseMexcRows(Array.isArray(data)?data:[]);
  if(rows.length<30)throw Error('Yeterli MEXC Spot mumu yok');
  return{rows,source:'MEXC Spot'};
 }catch(e){mexcError=e}
 let bitgetError;
 try{
  const granularity={'1h':'1h','4h':'4h','1d':'1day','1w':'1week','1M':'1M'}[tf.interval];
  const data=await json('https://api.bitget.com/api/v2/spot/market/candles?symbol='+encodeURIComponent(symbol)+'&granularity='+granularity+'&limit='+tf.limit,1);
  const rows=parseBitgetRows(data?.code==='00000'?data.data:[]);
  if(rows.length<30)throw Error(data?.msg||'Yeterli Bitget Spot mumu yok');
  return{rows,source:'Bitget Spot'};
 }catch(e){bitgetError=e}
 throw Error('Binance: '+(binanceError?.message||'yok')+' · Bybit: '+(bybitError?.message||'yok')+' · OKX: '+(okxError?.message||'yok')+' · Gate: '+(gateError?.message||'yok')+' · KuCoin: '+(kucoinError?.message||'yok')+' · MEXC: '+(mexcError?.message||'yok')+' · Bitget: '+(bitgetError?.message||'yok'));
}
function resultFor(c,raw,tf,source='Binance Spot'){
 const identity={id:c.id,symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,coingecko_id:c.coingecko_id||null,coinpaprika_id:c.coinpaprika_id||null};
 const d=raw.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})).filter(x=>[x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
 if(d.length<30)return{...identity,status:'unavailable',reason:'Yeterli mum verisi yok',source};
 const ps=engine.scan(d);
 if(!ps.length)return{...identity,status:'ok',pattern:null,targetPct:-1,expectedMovePct:0,source};
 const p=ps.slice().sort((a,b)=>(Number(b.confirmed)-Number(a.confirmed))||b.score-a.score)[0],dir=p.direction>0?1:p.direction<0?-1:0,last=d[d.length-1],tr=[];
 for(let i=Math.max(1,d.length-14);i<d.length;i++)tr.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));
 const atr=tr.reduce((a,b)=>a+b,0)/Math.max(1,tr.length),entry=last.c,t1=entry+dir*atr,t2=entry+dir*2*atr,move=dir?Math.abs((t2-entry)/entry*100):0;
 return{...identity,status:'ok',pattern:{name:p.name,group:p.group,direction:dir,confirmed:!!p.confirmed,score:p.score,detail:p.detail},entry,target1:t1,target2:t2,stop:dir?entry-dir*atr:null,expectedMovePct:move,targetPct:dir*move,source};
}
async function main(){
 const coins=await getUniverse();console.log('Coin evreni',coins.length);
 let output={schema:1,updatedAt:null,coinCount:coins.length,source:'CoinGecko/CoinPaprika + Binance/Bybit/OKX/Gate/KuCoin/MEXC/Bitget Spot',timeframes:{}};
 try{const old=JSON.parse(fs.readFileSync(OUTPUT,'utf8'));if(old&&old.schema===1&&old.timeframes)output={...old,coinCount:coins.length,source:'CoinGecko/CoinPaprika + Binance/Bybit/OKX Spot'}}catch(e){}
 // Backfill symbol/name on older result rows so the app can match them even when its market-list provider uses different IDs.
 const coinById=new Map(coins.map(c=>[c.id,c]));
 for(const data of Object.values(output.timeframes||{})){
  for(const row of data?.coins||[]){
   const coin=coinById.get(row.id);if(!coin)continue;
   if(!row.symbol)row.symbol=coin.symbol;
   if(!row.name)row.name=coin.name;
   if(!row.rank)row.rank=coin.market_cap_rank||null;\n   if(!row.coingecko_id)row.coingecko_id=coin.coingecko_id||null;\n   if(!row.coinpaprika_id)row.coinpaprika_id=coin.coinpaprika_id||null;
  }
 }
 const keys=Object.keys(TFS);
 const requested=process.env.SCAN_TIMEFRAME;
 let key=requested&&TFS[requested]?requested:null;
 if(!key){
  // Rebuild every timeframe once with the multi-exchange fallback and corrected coin metadata.
  const outdated=keys.find(k=>!output.timeframes[k]||output.timeframes[k].scanVersion!==4);
  if(outdated)key=outdated;
  else key=keys.slice().sort((a,b)=>Date.parse(output.timeframes[a].updatedAt||0)-Date.parse(output.timeframes[b].updatedAt||0))[0];
 }
 const tf=TFS[key];console.log('Bu çalışmada taranacak zaman dilimi:',key);
 {
  const rows=new Array(coins.length),cache=new Map();let next=0,ok=0,unavailable=0;
  async function worker(){while(true){const i=next++;if(i>=coins.length)return;const c=coins[i],sym=String(c.symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!sym){rows[i]={id:c.id,symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,coingecko_id:c.coingecko_id||null,coinpaprika_id:c.coinpaprika_id||null,status:'unavailable',reason:'Sembol yok'};unavailable++;continue}
   try{const k=sym+'|'+tf.interval+'|'+tf.limit;let p=cache.get(k);if(!p){p=klines(sym+'USDT',tf);cache.set(k,p)}const market=await p;rows[i]=resultFor(c,market.rows,tf,market.source);if(rows[i].status==='ok')ok++;else unavailable++}catch(e){rows[i]={id:c.id,symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,coingecko_id:c.coingecko_id||null,coinpaprika_id:c.coinpaprika_id||null,status:'unavailable',reason:e.message};unavailable++}
  }}
  await Promise.all(Array.from({length:10},worker));
  if(ok<100)throw Error(key+' taraması başarısız: yalnızca '+ok+' coin için geçerli veri bulundu; önceki sonuç korunuyor');
  const updatedAt=new Date().toISOString();
  output.updatedAt=updatedAt;
  output.timeframes[key]={label:tf.label,total:coins.length,scanned:ok,unavailable,coins:rows,updatedAt,scanVersion:4};
  const tmp=OUTPUT+'.tmp';fs.writeFileSync(tmp,JSON.stringify(output));fs.renameSync(tmp,OUTPUT);
  console.log(key,{scanned:ok,unavailable,updatedAt});
 }
 console.log('Zaman dilimi taraması ve yayın tamamlandı',key,output.updatedAt);
}
main().catch(e=>{console.error(e);process.exit(1)});
