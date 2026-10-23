/* VCrypto Pattern Library v1
 * Deterministic pattern detectors + local market memory. Client-side only.
 * Heuristic detections are labels, not calibrated probabilities.
 */
(function(){
'use strict';
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const safeNum=x=>Number.isFinite(x)?x:0;
function pivots(data,type,r=2){const out=[];for(let i=r;i<data.length-r;i++){const v=type==='high'?data[i].h:data[i].l;let ok=true;for(let j=i-r;j<=i+r;j++){if(j===i)continue;const z=type==='high'?data[j].h:data[j].l;if(type==='high'?z>=v:z<=v){ok=false;break}}if(ok)out.push({i,p:v})}return out}
function scan(data){
 if(!Array.isArray(data)||data.length<25)return [];
 const out=[],last=data[data.length-1],prev=data[data.length-2],body=Math.abs(last.c-last.o),span=Math.max(last.h-last.l,1e-12),upper=last.h-Math.max(last.o,last.c),lower=Math.min(last.o,last.c)-last.l;
 const atrs=[];for(let i=Math.max(1,data.length-15);i<data.length;i++)atrs.push(Math.max(data[i].h-data[i].l,Math.abs(data[i].h-data[i-1].c),Math.abs(data[i].l-data[i-1].c)));
 const atr=Math.max(avg(atrs),last.c*.0001),closes=data.map(x=>x.c),recent=data.slice(-20),high=Math.max(...recent.map(x=>x.h)),low=Math.min(...recent.map(x=>x.l));
 const ph=pivots(data,'high'),pl=pivots(data,'low'),hs=ph.slice(-4),ls=pl.slice(-4);
 const add=(name,group,direction,confirmed,detail,score)=>out.push({name,group,direction,confirmed,detail,score:Math.max(1,Math.min(5,score||3))});
 // Candlestick families
 if(body/span<.1)add('Doji','Mum',0,false,'Gövde çok küçük; kararsızlık olası.',2);
 if(lower>=body*2&&upper<=Math.max(body*.7,span*.08)&&last.c>=last.o)add('Çekiç / hammer adayı','Mum',1,last.c>prev.c,'Uzun alt fitil ve küçük gövde; konum ve sonraki mum teyidi gerekir.',3);
 if(upper>=body*2&&lower<=Math.max(body*.7,span*.08)&&last.c<=last.o)add('Asılı adam / shooting-star geometrisi','Mum',-1,false,'Uzun üst fitil; yükseliş trendindeki konum ayrıca doğrulanmalı.',3);
 if(last.c>last.o&&prev.c<prev.o&&last.o<=prev.c&&last.c>=prev.o)add('Boğa yutan mum','Mum',1,true,'Son yeşil mum önceki kırmızı gövdeyi yuttu.',4);
 if(last.c<last.o&&prev.c>prev.o&&last.o>=prev.c&&last.c<=prev.o)add('Ayı yutan mum','Mum',-1,true,'Son kırmızı mum önceki yeşil gövdeyi yuttu.',4);
 if(body/span>.75&&upper/span<.12&&lower/span<.12)add(last.c>last.o?'Güçlü boğa marubozu':'Güçlü ayı marubozu','Mum',last.c>last.o?1:-1,true,'Gövde geniş, fitiller kısa; tek mumla işlem kararı verilmemeli.',3);
 // Market structure, breakouts and sweeps
 const prior=data.slice(-21,-1),priorHigh=Math.max(...prior.map(x=>x.h)),priorLow=Math.min(...prior.map(x=>x.l));
 const avgVol=avg(prior.map(x=>x.v)),volRatio=avgVol?last.v/avgVol:1;
 if(last.c>priorHigh)add('Direnç kırılımı / BOS','Piyasa yapısı',1,true,'Kapanış önceki 20 mumun tepesinin üzerinde.'+(volRatio>=1.3?' Hacim artışı da var.':''),volRatio>=1.3?5:4);
 if(last.c<priorLow)add('Destek kırılımı / BOS','Piyasa yapısı',-1,true,'Kapanış önceki 20 mumun dibinin altında.'+(volRatio>=1.3?' Hacim artışı da var.':''),volRatio>=1.3?5:4);
 if(last.h>priorHigh&&last.c<priorHigh)add('Yukarı likidite süpürmesi','Piyasa yapısı',-1,true,'Önceki tepenin üstü test edildi fakat kapanış yeniden altına geldi.',4);
 if(last.l<priorLow&&last.c>priorLow)add('Aşağı likidite süpürmesi','Piyasa yapısı',1,true,'Önceki dibin altı test edildi fakat kapanış yeniden üstüne geldi.',4);
 if(hs.length>=2&&ls.length>=2){
  const hh=hs[hs.length-1].p>hs[hs.length-2].p,hl=ls[ls.length-1].p>ls[ls.length-2].p;
  const lh=hs[hs.length-1].p<hs[hs.length-2].p,ll=ls[ls.length-1].p<ls[ls.length-2].p;
  if(hh&&hl)add('Yükselen tepe + yükselen dip','Piyasa yapısı',1,false,'Son swing yapısı yükseliş eğiliminde.',3);
  if(lh&&ll)add('Alçalan tepe + alçalan dip','Piyasa yapısı',-1,false,'Son swing yapısı düşüş eğiliminde.',3);
  const lastH=hs[hs.length-1],lastL=ls[ls.length-1];
  if(last.c>lastH.p&&lastH.i<data.length-1)add('Swing tepe üstü kapanış','Piyasa yapısı',1,true,'Son teyitli swing tepesi aşıldı.',4);
  if(last.c<lastL.p&&lastL.i<data.length-1)add('Swing dip altı kapanış','Piyasa yapısı',-1,true,'Son teyitli swing dibi kırıldı.',4);
 }
 // Classical patterns: broad coverage, intentionally return candidates not forced labels
 if(hs.length>=2){const a=hs[hs.length-2],b=hs[hs.length-1],between=data.slice(a.i,b.i+1),neck=Math.min(...between.map(x=>x.l)),tol=Math.max(last.c*.018,atr*.65);if(b.i-a.i>=4&&Math.abs(a.p-b.p)<=tol){add(last.c<neck?'Çift tepe · teyitli':'Çift tepe adayı','Klasik formasyon',-1,last.c<neck,'Benzer iki tepe; boyun seviyesi '+(last.c<neck?'kırılmış':'henüz kırılmamış')+'.',last.c<neck?5:3)}}
 if(ls.length>=2){const a=ls[ls.length-2],b=ls[ls.length-1],between=data.slice(a.i,b.i+1),neck=Math.max(...between.map(x=>x.h)),tol=Math.max(last.c*.018,atr*.65);if(b.i-a.i>=4&&Math.abs(a.p-b.p)<=tol){add(last.c>neck?'Çift dip · teyitli':'Çift dip adayı','Klasik formasyon',1,last.c>neck,'Benzer iki dip; boyun seviyesi '+(last.c>neck?'kırılmış':'henüz kırılmamış')+'.',last.c>neck?5:3)}}
 if(hs.length>=3){const [a,b,c]=hs.slice(-3),neck=Math.min(...data.slice(a.i,c.i+1).map(x=>x.l));if(b.p>a.p+atr*.5&&b.p>c.p+atr*.5&&Math.abs(a.p-c.p)<=Math.max(last.c*.04,atr*1.5))add(last.c<neck?'Omuz-baş-omuz · teyitli':'Omuz-baş-omuz adayı','Klasik formasyon',-1,last.c<neck,'Baş, iki omuzdan yüksek; boyun çizgisi '+(last.c<neck?'kırılmış':'bekleniyor')+'.',last.c<neck?5:3)}
 if(ls.length>=3){const [a,b,c]=ls.slice(-3),neck=Math.max(...data.slice(a.i,c.i+1).map(x=>x.h));if(b.p<a.p-atr*.5&&b.p<c.p-atr*.5&&Math.abs(a.p-c.p)<=Math.max(last.c*.04,atr*1.5))add(last.c>neck?'Ters omuz-baş-omuz · teyitli':'Ters omuz-baş-omuz adayı','Klasik formasyon',1,last.c>neck,'Ters omuz-baş-omuz geometrisi; boyun çizgisi '+(last.c>neck?'kırılmış':'bekleniyor')+'.',last.c>neck?5:3)}
 if(hs.length>=3&&ls.length>=3){const hdrop=hs[0].p-hs[2].p,lrise=ls[2].p-ls[0].p,flatH=Math.max(...hs.slice(-3).map(p=>p.p))-Math.min(...hs.slice(-3).map(p=>p.p))<Math.max(last.c*.012,atr*.8),flatL=Math.max(...ls.slice(-3).map(p=>p.p))-Math.min(...ls.slice(-3).map(p=>p.p))<Math.max(last.c*.012,atr*.8);if(hdrop>atr*.35&&lrise>atr*.35)add('Simetrik üçgen / sıkışma','Klasik formasyon',last.c>high?1:last.c<low?-1:0,last.c>Math.max(...hs.slice(-3).map(p=>p.p))||last.c<Math.min(...ls.slice(-3).map(p=>p.p)),'Tepeler alçalırken dipler yükseliyor; yönlü kırılım aranır.',4);else if(flatH&&lrise>atr*.5)add('Yükselen üçgen adayı','Klasik formasyon',1,last.c>Math.max(...hs.slice(-3).map(p=>p.p)),'Yatay direnç ve yükselen dipler.',3);else if(flatL&&hdrop>atr*.5)add('Alçalan üçgen adayı','Klasik formasyon',-1,last.c<Math.min(...ls.slice(-3).map(p=>p.p)),'Yatay destek ve alçalan tepeler.',3)}
 const recentRanges=data.slice(-10).map(x=>x.h-x.l),oldRanges=data.slice(-30,-10).map(x=>x.h-x.l);if(oldRanges.length&&avg(recentRanges)<avg(oldRanges)*.65)add('Volatilite sıkışması','Volatilite',0,false,'Son 10 mumun ortalama aralığı önceki 20 muma göre daraldı.',3);
 if(volRatio>=1.8)add('Hacim anomalisi','Hacim',last.c>last.o?1:last.c<last.o?-1:0,false,'Son mum hacmi önceki 20 mum ortalamasının '+volRatio.toFixed(2)+' katı.',4);
 // Deduplicate similar label collisions and keep most informative results first
 return out.filter((x,i,a)=>a.findIndex(y=>y.name===x.name)===i).sort((a,b)=>(b.confirmed-a.confirmed)||(b.score-a.score)).slice(0,18);
}
const KEY='vcrypto.marketMemory.v1';
function readMemory(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch(_){return []}}
function writeMemory(items){try{localStorage.setItem(KEY,JSON.stringify(items.slice(0,250)));return true}catch(_){return false}}
function fmt(v){return Number.isFinite(v)?'$'+v.toLocaleString('en-US',{maximumFractionDigits:v<1?6:2}):'—'}
function updateMemory({symbol,view,candles,result,patterns}){
 const items=readMemory(),nowBar=candles[candles.length-1],key=symbol+'|'+view+'|'+nowBar.t;
 // Resolve previous tracked setups using subsequent OHLC bars; first touched level wins per candle, ambiguous same-candle hits stay ambiguous.
 for(const item of items){if(item.symbol!==symbol||item.view!==view||item.outcome!=='İzleniyor')continue;const later=candles.filter(k=>k.t>item.barTime);for(const k of later){const targetHit=item.direction>0?k.h>=item.target:k.l<=item.target,stopHit=item.direction>0?k.l<=item.stop:k.h>=item.stop;if(targetHit&&stopHit){item.outcome='Belirsiz (aynı mumda hedef/stop)';item.resolvedAt=k.t;break}if(targetHit){item.outcome='Hedef görüldü';item.resolvedAt=k.t;break}if(stopHit){item.outcome='Stop görüldü';item.resolvedAt=k.t;break}}}
 let saved=false;
 if(!items.some(x=>x.key===key)){
  items.unshift({key,symbol,view,barTime:nowBar.t,recordedAt:Date.now(),entry:nowBar.c,direction:result.direction,target:result.target1,stop:result.stop,pattern:result.name,confidence:result.confidence,outcome:'İzleniyor',patternList:(patterns||[]).slice(0,8).map(p=>p.name)});
  saved=writeMemory(items);
 }else writeMemory(items);
 return {items:readMemory().filter(x=>x.symbol===symbol&&x.view===view).slice(0,12),saved,total:readMemory().length};
}
function renderPatterns(patterns){const root=document.getElementById('libraryResults');if(!root)return;if(!patterns.length){root.innerHTML='<div class="memory-empty">Yeterli mum yok veya belirgin formasyon bulunamadı.</div>';return}root.innerHTML=patterns.map(p=>'<article class="library-item"><div class="library-item-head"><strong>'+esc(p.name)+'</strong><span class="library-tag '+(p.confirmed?'confirmed':'candidate')+'">'+(p.confirmed?'Teyitli kırılım':'Aday / izleme')+'</span></div><div class="library-meta">'+esc(p.group)+' · '+(p.direction>0?'Yukarı eğilim':p.direction<0?'Aşağı eğilim':'Yönsüz')+' · sinyal gücü '+p.score+'/5</div><div class="library-detail">'+esc(p.detail)+'</div></article>').join('')}
function renderMemory(items,total,saved){const root=document.getElementById('memoryRows');if(!root)return;const count=items.filter(x=>x.outcome==='Hedef görüldü').length,stop=items.filter(x=>x.outcome==='Stop görüldü').length,resolved=count+stop;const stats=document.getElementById('memoryStats');if(stats)stats.textContent='Bu periyotta '+items.length+' kayıt · '+(resolved?Math.round(count/resolved*100)+'% hedef oranı (çözülen '+resolved+' kayıt)':'henüz çözülen sinyal yok')+' · cihaz hafızasında '+total+' kayıt';const state=document.getElementById('memoryState');if(state)state.textContent=saved?'Yeni mum kaydı hafızaya alındı.':'Bu mum için kayıt zaten var; geçmiş sonuçlar güncellendi.';if(!items.length){root.innerHTML='<div class="memory-empty">Bu coin ve periyot için henüz hafıza kaydı yok.</div>';return}root.innerHTML=items.map(x=>'<article class="memory-row"><div class="memory-row-top"><strong>'+esc(x.pattern)+'</strong><span class="memory-outcome '+(x.outcome==='Hedef görüldü'?'win':x.outcome==='Stop görüldü'?'loss':'pending')+'">'+esc(x.outcome)+'</span></div><div class="library-meta">'+esc(x.symbol)+' · '+esc(x.view)+' · '+new Date(x.barTime).toLocaleString('tr-TR')+'</div><div class="memory-prices">Giriş '+fmt(x.entry)+' · Hedef '+fmt(x.target)+' · Stop '+fmt(x.stop)+'</div></article>').join('')}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function exportMemory(){const blob=new Blob([JSON.stringify(readMemory(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='vcrypto-market-memory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function clearMemory(){if(!confirm('Bu cihazdaki tüm VCrypto piyasa hafızası silinsin mi?'))return;localStorage.removeItem(KEY);document.getElementById('memoryRows').innerHTML='<div class="memory-empty">Hafıza temizlendi.</div>';const s=document.getElementById('memoryStats');if(s)s.textContent='Kayıt yok';const st=document.getElementById('memoryState');if(st)st.textContent='Hafıza temizlendi.'}
window.VCryptoPatternEngine={scan,updateMemory,renderPatterns,renderMemory,exportMemory,clearMemory,readMemory};
})();