'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const files=['index.html','pattern.html'];
let checked=0;
for(const file of files){
 const html=fs.readFileSync(file,'utf8');
 const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
 let match,n=0;
 while((match=re.exec(html))){
  const attrs=match[1]||'',body=match[2]||'';
  if(/\bsrc\s*=/.test(attrs)||/\btype\s*=\s*["']application\/(?:json|ld\+json)["']/i.test(attrs)||!body.trim())continue;
  new vm.Script(body,{filename:file+' inline script '+(++n)});
  checked++;
 }
}
if(!checked)throw new Error('HTML içinde kontrol edilecek inline JavaScript bulunamadı');
console.log('HTML inline JavaScript syntax test: '+checked+' blok başarılı');
