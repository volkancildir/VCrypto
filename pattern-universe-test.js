'use strict';
const fs=require('node:fs');
const {create}=require('./pattern-matcher.js');
const excluded=c=>{
 const s=String(c.symbol||'').toUpperCase(),id=String(c.id||'').toLowerCase(),n=String(c.name||'').toLowerCase();
 return s==='FIGR_HELOC'||id==='figure-heloc'||s==='SSTN'||s==='PC0000031'||id.includes('rent-financing')||n.includes('rent financing platform')||n.includes('tradable na');
};
async function get(url){
 const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('HTTP '+r.status+' '+url);
 return r.json();
}
async function main(){
 const payload=JSON.parse(fs.readFileSync('pattern-results.json','utf8'));
 const entries=Object.entries(payload.timeframes||{}).filter(([,x])=>Array.isArray(x.coins)).sort((a,b)=>Date.parse(b[1].updatedAt||0)-Date.parse(a[1].updatedAt||0));
 if(!entries.length)throw Error('Sunucu sonuçları bulunamadı');
 const [tf,data]=entries[0],rows=data.coins;
 async function check(name,coins){
  const matcher=create(coins,rows);let matched=0,ok=0,unavailable=0;
  for(const coin of coins){const row=matcher.find(coin,coin.id);if(!row)continue;matched++;if(row.status==='ok')ok++;else unavailable++}
  console.log(name+' eşleşme testi ('+tf+'): '+matched+'/'+coins.length+' eşleşti · '+ok+' mum verili · '+unavailable+' verisiz · '+(coins.length-matched)+' eşleşmedi');
 }
 try{
  const pages=await Promise.all([1,2,3].map(page=>get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+page+'&sparkline=false')));
  const byId=new Map();pages.flat().filter(c=>c&&c.id&&!excluded(c)).forEach(c=>{if(!byId.has(c.id))byId.set(c.id,c)});
  const cg=[...byId.values()].sort((a,b)=>(Number(a.market_cap_rank)||999999)-(Number(b.market_cap_rank)||999999)).slice(0,500);
  if(cg.length>=450)await check('CoinGecko',cg);else console.log('CoinGecko eşleşme testi atlandı: liste '+cg.length+' coin');
 }catch(e){console.log('CoinGecko canlı eşleşme testi atlandı: '+e.message)}
 try{
  const raw=await get('https://api.coinpaprika.com/v1/tickers?quotes=USD');
  const cp=raw.filter(c=>c&&c.id&&!excluded(c)&&Number(c.quotes?.USD?.price)>0).sort((a,b)=>(Number(a.rank)||999999)-(Number(b.rank)||999999)).slice(0,500).map(c=>({id:c.id,name:c.name,symbol:c.symbol,market_cap_rank:Number(c.rank)||null}));
  if(cp.length>=400)await check('CoinPaprika',cp);else console.log('CoinPaprika eşleşme testi atlandı: liste '+cp.length+' coin');
 }catch(e){console.log('CoinPaprika canlı eşleşme testi atlandı: '+e.message)}
}
main().catch(e=>{console.error(e);process.exit(1)});
