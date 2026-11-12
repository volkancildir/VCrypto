'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.VCryptoPatternMatcher=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const normSymbol=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const normName=v=>String(v||'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
 function create(coins,rows){
  const byId=new Map(),symbols=new Map(),names=new Map(),pairs=new Map(),used=new Set();
  const add=(map,key,row)=>{if(!key)return;const a=map.get(key)||[];a.push(row);map.set(key,a)};
  for(const row of rows||[]){
   for(const alias of [row.id,row.coingecko_id,row.coinpaprika_id])if(alias&&!byId.has(alias))byId.set(alias,row);
   const s=normSymbol(row.symbol),n=normName(row.name);
   add(symbols,s,row);add(names,n,row);if(s&&n)add(pairs,s+'|'+n,row);
  }
  function rankPick(list,coin){
   const rank=Number(coin?.market_cap_rank);if(!Number.isFinite(rank))return null;
   const options=(list||[]).filter(x=>!used.has(x)&&Number.isFinite(Number(x.rank))).map(x=>({row:x,diff:Math.abs(Number(x.rank)-rank)})).sort((a,b)=>a.diff-b.diff);
   if(!options.length||options[0].diff>5||(options[1]&&options[1].diff===options[0].diff))return null;
   return options[0].row;
  }
  return {
   find(coin,id){
    const exact=byId.get(id);if(exact&&!used.has(exact)){used.add(exact);return exact}
    const s=normSymbol(coin?.symbol),n=normName(coin?.name);
    const pair=pairs.get(s+'|'+n)||[];
    let found=pair.length===1&&!used.has(pair[0])?pair[0]:null;
    if(!found){const sameName=names.get(n)||[];if(sameName.length===1&&!used.has(sameName[0]))found=sameName[0]}
    if(!found){const sameSymbol=symbols.get(s)||[];found=rankPick(sameSymbol,coin)||(sameSymbol.length===1&&!used.has(sameSymbol[0])?sameSymbol[0]:null)}
    if(found)used.add(found);
    return found||null;
   }
  };
 }
 return {create,normSymbol,normName};
});
