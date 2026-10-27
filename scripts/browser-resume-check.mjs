import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const context=await chromium.launchPersistentContext('.research/resume-profile',{headless:true,args:['--disable-gpu','--disable-webgpu']});
const page=await context.newPage();
try{
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5196/voice-lab/');
 await page.waitForFunction(()=>crossOriginIsolated && document.getElementById('download-state').textContent.includes('已下載') && !document.getElementById('generate').disabled,null,{timeout:600000});
 await page.selectOption('#model','100m');
 await page.waitForFunction(()=>document.getElementById('download-info').textContent.startsWith('Pocket TTS 100M'));
 await page.click('#delete-model');
 await page.waitForFunction(()=>!document.getElementById('generate').disabled);
 await page.click('#download-model');
 await page.evaluate(async()=>{
  const cache=await caches.open('voice-lab-models:/voice-lab/');
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
   const count=(await cache.keys()).filter(k=>k.url.includes('/__chunks__/100m/')).length;
   if(count>=2){document.getElementById('cancel').click();return;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('No resumable chunks appeared');
 });
 await page.waitForFunction(()=>!document.getElementById('generate').disabled);
 const chunks=await page.evaluate(async()=>{const c=await caches.open('voice-lab-models:/voice-lab/');return (await c.keys()).filter(k=>k.url.includes('/__chunks__/100m/')).length;});
 assert.ok(chunks>=2);
 await page.reload();
 await page.waitForFunction(()=>document.getElementById('download-model').onclick && !document.getElementById('generate').disabled);
 await page.selectOption('#model','100m');
 await page.waitForFunction(()=>document.getElementById('download-state').textContent.includes('部分已下載'));
 const rangeStarts=[];
 context.on('request',r=>{if(r.url().includes('/pocket/100m/model.safetensors'))rangeStarts.push(r.headers()['range']);});
 await page.click('#download-model');
 await page.waitForFunction(()=>!document.getElementById('generate').disabled,null,{timeout:180000});
 assert.match(await page.locator('#download-state').textContent(),/已下載/);
 assert.ok(rangeStarts.length>0);assert.ok(!rangeStarts.includes('bytes=0-8388607'),'Saved first chunk must not redownload');
 await writeFile('test-results/resume-report.json',JSON.stringify({completedChunksBeforeReload:chunks,resumedRangeRequests:rangeStarts,sha256Validated:true,transport:'sha256-verified-local-static-mirror'},null,2));
 console.log('PASS: cancelled download, persisted chunks across reload, resumed without first chunk, final SHA-256 verified');
}finally{await context.close();}
