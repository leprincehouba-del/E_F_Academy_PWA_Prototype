const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
(async()=>{
 let shown=0,fail=false,navigated,focused=0;const handlers={};
 const ctx=vm.createContext({indexedDB,URL,Date,console,self:{addEventListener:(n,fn)=>handlers[n]=fn,registration:{scope:'https://example.test/app/',showNotification:async()=>{if(fail)throw Error('injected');shown++}}},clients:{matchAll:async()=>[{url:'https://example.test/other/',focus:async()=>assert.fail('unrelated tab')},{url:'https://example.test/app/',navigate:async u=>navigated=u,focus:async()=>focused++}],openWindow:async u=>navigated=u}});
 vm.runInContext(fs.readFileSync('service-worker.js','utf8'),ctx);
 const push=async(tag)=>{let task;handlers.push({data:{json:()=>({title:'Award',tag,url:'./?milestone=200'})},waitUntil:t=>task=t});await task};
 await Promise.all([push('milestone:a:200'),push('milestone:a:200')]);assert.equal(shown,1);
 await push('milestone:a:200');assert.equal(shown,1,'dismiss/restart retry suppressed');
 await push('milestone:a:400');assert.equal(shown,2);
 fail=true;await push('milestone:a:600');fail=false;await push('milestone:a:600');assert.equal(shown,3,'display failure recoverable');
 await push(undefined);await push(undefined);assert.equal(shown,5,'existing attendance pushes unaffected');
 let task;handlers.notificationclick({notification:{close(){},data:{url:'./?milestone=200&student_id=a'}},waitUntil:t=>task=t});await task;
 assert.equal(navigated,'https://example.test/app/?milestone=200&student_id=a');assert.equal(focused,1);
 console.log('PASS: persistent milestone push deduplication, concurrent delivery, display retry, existing pushes, scoped notification navigation.');
})().catch(e=>{console.error(e);process.exit(1)});
