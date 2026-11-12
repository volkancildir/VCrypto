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
async function json(url,tries=4){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok){const e=new Error('HTTP '+r.status);e.status=r.status;throw e}return await r.json()}catch(e){last=e;await sleep(e.status===429?Math.min(15000,4000*(i+1)):700*(i+1))}}throw last||Error('Veri alınamadı')}
async function getUniverse(){
 try{
  const pages=await Promise.all([1,2,3].map(p=>json('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+p+'&sparkline=false')));
  const m=new Map();pages.flat().filter(c=>c&&c.id&&!excluded(c)).forEach(c=>{if(!m.has(c.id))m.set(c.id,c)});
  const a=[...m.values()].sort((x,y)=>(Number(x.market_cap_rank)||999999)-(Number(y.market_cap_rank)||999999)).slice(0,500);
  if(a.length>=450)return a;throw Error('CoinGecko listesi eksik: '+a.length);
 }catch(e){
  console.log('CoinPaprika yedeği:',e.message);
  const raw=await json('https://api.coinpaprika.com/v1/tickers?quotes=USD');
  const a=raw.filter(c=>c&&c.id&&!excluded({id:c.id,name:c.name,symbol:c.symbol})&&Number(c.quotes?.USD?.price)>0).sort((x,y)=>(Number(x.rank)||999999)-(Number(y.rank)||999999)).slice(0,500).map(c=>({id:c.id,name:c.name,symbol:c.symbol,image:'https://static.coinpaprika.com/coin/'+c.id+'/logo.png',market_cap_rank:Number(c.rank)||null}));
  if(a.length<400)throw Error('Yedek kaynakta coin sayısı yetersiz: '+a.length);return a;
 }
}
async function klines(symbol,tf){
 const q='klines?symbol='+encodeURIComponent(symbol)+'&interval='+tf.interval+'&limit='+tf.limit;
 let binanceError;
 for(const base of ['https://data-api.binance.vision/api/v3/','https://api.binance.com/api/v3/']){
  try{const a=await json(base+q,2);if(!Array.isArray(a)||a.length<30)throw Error('Mum verisi yetersiz');return{rows:a,source:'Binance Spot'}}
  catch(e){binanceError=e}
 }
 const bybitInterval={'1h':'60','4h':'240','1d':'D','1w':'W','1M':'M'}[tf.interval];
 let bybitError;
 try{
  const u='https://api.bybit.com/v5/market/kline?category=spot&symbol='+encodeURIComponent(symbol)+'&interval='+bybitInterval+'&limit='+tf.limit;
  const data=await json(u,2),list=data?.retCode===0?data.result?.list:null;
  if(!Array.isArray(list)||list.length<30)throw Error(data?.retMsg||'Yeterli Bybit Spot mumu yok');
  const rows=list.slice().reverse().map(k=>[k[0],k[1],k[2],k[3],k[4],k[5]]);
  return{rows,source:'Bybit Spot'};
 }catch(e){bybitError=e}
 const okxBar={'1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'}[tf.interval];
 let okxError;
 try{
  const inst=symbol.replace(/USDT$/,'-USDT');
  const u='https://www.okx.com/api/v5/market/candles?instId='+encodeURIComponent(inst)+'&bar='+okxBar+'&limit='+tf.limit;
  const data=await json(u,2),list=data?.code==='0'?data.data:null;
  if(!Array.isArray(list)||list.length<30)throw Error(data?.msg||'Yeterli OKX Spot mumu yok');
  const rows=list.slice().reverse().map(k=>[k[0],k[1],k[2],k[3],k[4],k[5]]);
  return{rows,source:'OKX Spot'};
 }catch(e){okxError=e}
 throw Error('Binance: '+(binanceError?.message||'veri yok')+' · Bybit: '+(bybitError?.message||'veri yok')+' · OKX: '+(okxError?.message||'veri yok'));
}
function resultFor(c,raw,tf,source='Binance Spot'){
 const d=raw.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]})).filter(x=>[x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
 if(d.length<30)return{id:c.id,symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,status:'unavailable',reason:'Yeterli mum verisi yok',source};
 const ps=engine.scan(d);
 if(!ps.length)return{id:c.id,status:'ok',symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,pattern:null,targetPct:-1,expectedMovePct:0,source};
 const p=ps.slice().sort((a,b)=>(Number(b.confirmed)-Number(a.confirmed))||b.score-a.score)[0],dir=p.direction>0?1:p.direction<0?-1:0,last=d[d.length-1],tr=[];
 for(let i=Math.max(1,d.length-14);i<d.length;i++)tr.push(Math.max(d[i].h-d[i].l,Math.abs(d[i].h-d[i-1].c),Math.abs(d[i].l-d[i-1].c)));
 const atr=tr.reduce((a,b)=>a+b,0)/Math.max(1,tr.length),entry=last.c,t1=entry+dir*atr,t2=entry+dir*2*atr,move=dir?Math.abs((t2-entry)/entry*100):0;
 return{id:c.id,status:'ok',symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,pattern:{name:p.name,group:p.group,direction:dir,confirmed:!!p.confirmed,score:p.score,detail:p.detail},entry,target1:t1,target2:t2,stop:dir?entry-dir*atr:null,expectedMovePct:move,targetPct:dir*move,source};
}
async function main(){
 const coins=await getUniverse();console.log('Coin evreni',coins.length);
 let output={schema:1,updatedAt:null,coinCount:coins.length,source:'CoinGecko/CoinPaprika + Binance/Bybit/OKX Spot',timeframes:{}};
 try{const old=JSON.parse(fs.readFileSync(OUTPUT,'utf8'));if(old&&old.schema===1&&old.timeframes)output={...old,coinCount:coins.length,source:'CoinGecko/CoinPaprika + Binance/Bybit/OKX Spot'}}catch(e){}
 // Backfill symbol/name on older result rows so the app can match them even when its market-list provider uses different IDs.
 const coinById=new Map(coins.map(c=>[c.id,c]));
 for(const data of Object.values(output.timeframes||{})){
  for(const row of data?.coins||[]){
   const coin=coinById.get(row.id);if(!coin)continue;
   if(!row.symbol)row.symbol=coin.symbol;
   if(!row.name)row.name=coin.name;
   if(!row.rank)row.rank=coin.market_cap_rank||null;
  }
 }
 const keys=Object.keys(TFS);
 const requested=process.env.SCAN_TIMEFRAME;
 let key=requested&&TFS[requested]?requested:null;
 if(!key){
  const missing=['4h','1h','1d','1w','1M','1y'].find(k=>!output.timeframes[k]);
  if(missing)key=missing;
  else key=keys.slice().sort((a,b)=>Date.parse(output.timeframes[a].updatedAt||0)-Date.parse(output.timeframes[b].updatedAt||0))[0];
 }
 const tf=TFS[key];console.log('Bu çalışmada taranacak zaman dilimi:',key);
 {
  const rows=new Array(coins.length),cache=new Map();let next=0,ok=0,unavailable=0;
  async function worker(){while(true){const i=next++;if(i>=coins.length)return;const c=coins[i],sym=String(c.symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!sym){rows[i]={id:c.id,status:'unavailable',reason:'Sembol yok'};unavailable++;continue}
   try{const k=sym+'|'+tf.interval+'|'+tf.limit;let p=cache.get(k);if(!p){p=klines(sym+'USDT',tf);cache.set(k,p)}const market=await p;rows[i]=resultFor(c,market.rows,tf,market.source);if(rows[i].status==='ok')ok++;else unavailable++}catch(e){rows[i]={id:c.id,symbol:c.symbol,name:c.name,rank:c.market_cap_rank||null,status:'unavailable',reason:e.message};unavailable++}
  }}
  await Promise.all(Array.from({length:10},worker));
  if(ok<100)throw Error(key+' taraması başarısız: yalnızca '+ok+' coin için geçerli veri bulundu; önceki sonuç korunuyor');
  const updatedAt=new Date().toISOString();
  output.updatedAt=updatedAt;
  output.timeframes[key]={label:tf.label,total:coins.length,scanned:ok,unavailable,coins:rows,updatedAt};
  const tmp=OUTPUT+'.tmp';fs.writeFileSync(tmp,JSON.stringify(output));fs.renameSync(tmp,OUTPUT);
  console.log(key,{scanned:ok,unavailable,updatedAt});
 }
 console.log('Zaman dilimi taraması ve yayın tamamlandı',key,output.updatedAt);
}
main().catch(e=>{console.error(e);process.exit(1)});
