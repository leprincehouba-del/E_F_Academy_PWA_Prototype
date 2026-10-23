// Create static staging assets with no production project URL or keys.
const fs=require('node:fs'),path=require('node:path');
const productionProject='bmnrltyodljgvrcssjhd';
const url=new URL(process.env.STAGING_SUPABASE_URL||'http://invalid');
const key=process.env.STAGING_SUPABASE_PUBLISHABLE_KEY||'';
const vapid=process.env.STAGING_VAPID_PUBLIC_KEY||'';
if(!/^[A-Za-z0-9_-]{87}$/.test(vapid))throw Error('Independent staging VAPID public key required');
if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.hostname.includes(productionProject))throw Error('Provide the independent staging project URL, never the production project');
if(!key.startsWith('sb_publishable_'))throw Error('Use a staging publishable key, never a service-role/secret key');
const out=path.resolve('staging-dist');
fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','styles.css','app.js','supabase.js','service-worker.js','manifest.webmanifest','logo.png','icons/brand-192.png','icons/brand-512.png','icons/brand-maskable-512.png']){
 const dest=path.join(out,file);fs.mkdirSync(path.dirname(dest),{recursive:true});
 if(file.endsWith('.png'))fs.copyFileSync(file,dest);
 else {
  let source=fs.readFileSync(file,'utf8');
  if(file==='app.js')source=source.replace(/const SUPABASE_URL = .*;/,'const SUPABASE_URL = '+JSON.stringify(url.origin)+';').replace(/const SUPABASE_KEY = .*;/,'const SUPABASE_KEY = '+JSON.stringify(key)+';');
  if(file==='app.js')source=source.replace(/const VAPID_PUBLIC_KEY =\s*"[^"]+";/,'const VAPID_PUBLIC_KEY = '+JSON.stringify(vapid)+';');
  if(file==='service-worker.js')source=source.replace(/const CACHE = "[^"]+";/,'const CACHE = "ef-academy-staging-milestones-stars-only";');
  if(file==='index.html')source=source.replace(/<a\b(?=[^>]*\bid="androidDownloadBtn")[^>]*>[\s\S]*?<\/a>/,'').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\' '+url.origin+' wss://'+url.hostname+' https://cdn.jsdelivr.net;">').replace('<body>','<body><div style="position:sticky;top:0;z-index:100001;background:#ffdf70;color:#111;text-align:center;padding:8px">بيئة اختبار مستقلة — بيانات وهمية فقط</div>');
  if(source.includes(productionProject)||source.includes('sb_publishable_Tk7XuO4BCs9baofK6yjy0Q_LzOKTNVd'))throw Error('Production connection leaked into staging build');
  fs.writeFileSync(dest,source);
 }
}
console.log('Created isolated staging-dist. Host on a separate origin; seed synthetic accounts only.');
