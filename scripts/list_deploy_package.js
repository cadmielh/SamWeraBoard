// Listează exact ce ar împacheta Firebase CLI pentru funcții (folosește `functions[0].ignore` din firebase.json). Rulează din rădăcina proiectului: node scripts/list_deploy_package.js
const ft='/Users/cadmielh/.local/node/lib/node_modules/firebase-tools/lib';
const fsAsync=require(ft+'/fsAsync'); const fs=require('fs'), path=require('path');
const cfg=JSON.parse(fs.readFileSync('firebase.json','utf8')).functions[0];
const ignore=[...(cfg.ignore||["node_modules",".git"]),"firebase-debug.log","firebase-debug.*.log"];
(async()=>{
  const files=await fsAsync.readdirRecursive({path:process.cwd(),ignoreStrings:ignore});
  let total=0; const rows=files.map(f=>{const s=fs.statSync(f.name).size; total+=s; return [f.name.replace(process.cwd()+'/',''),s]});
  console.log('fișiere:',rows.length,'| total necomprimat:',(total/1024/1024).toFixed(2),'MB');
  rows.sort((a,b)=>b[1]-a[1]).forEach(r=>console.log(String(r[1]).padStart(9),r[0]));
})().catch(e=>{console.error('EROARE',e.message);process.exit(1)});
