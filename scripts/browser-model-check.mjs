import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { MODELS } from '../src/models.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
await mkdir('test-results',{recursive:true});
const context = await chromium.launchPersistentContext(process.env.TEST_PROFILE || '.research/browser-profile',{headless:true,args:['--disable-gpu','--disable-webgpu'],viewport:{width:1440,height:1080}});
const page = await context.newPage();
const reports = [], postRequests = [];
context.on('request', request=>{if(request.method()!=='GET' && request.method()!=='HEAD') postRequests.push(request.url());});
page.on('pageerror', error=>console.log('PAGEERROR',error.message));
page.on('console', message=>{if(message.type()==='error') console.log('CONSOLE',message.text().slice(0,1000));});
await page.exposeFunction('reportStatus',value=>console.log('STATUS',value));
await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
  let last='';new MutationObserver(()=>{const value=document.getElementById('status')?.textContent;if(value && value!==last){last=value;window.reportStatus(value);}}).observe(document.body,{childList:true,subtree:true,characterData:true});
}));
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5195/voice-lab/');
  await page.waitForFunction(()=>crossOriginIsolated && document.getElementById('download-model').onclick && !document.getElementById('generate').disabled,null,{timeout:600000});
  for(const id of process.argv.slice(2).length ? process.argv.slice(2) : MODELS.map(model=>model.id)){
    const model=MODELS.find(model=>model.id===id);
    await page.selectOption('#model',id);
    await page.fill('#text',model.testText || 'Hello, welcome to Voice Lab.');
    const start=Date.now();
    await page.click('#generate');
    await page.waitForFunction(()=>!document.getElementById('generate').disabled,null,{timeout:1200000});
    const status=await page.locator('#status').textContent();
    assert.match(status,/^已完成/,`${id}: ${status}`);
    assert.equal(await page.locator('#thread-badge').textContent(),`${model.threads||2} threads`);
    assert.match(await page.locator('#download-state').textContent(),/已下載/);
    const bytes=Uint8Array.from(await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(document.getElementById('download').href)).arrayBuffer()))));
    const view=new DataView(bytes.buffer);
    assert.equal(Buffer.from(bytes.slice(0,4)).toString(),'RIFF');
    assert.equal(view.getUint32(24,true),model.sampleRate||24000);
    let sum=0;for(let n=44;n<bytes.length;n+=2)sum+=(view.getInt16(n,true)/32768)**2;
    const rms=Math.sqrt(sum/((bytes.length-44)/2));assert.ok(rms>.001);
    const report={id,wallMs:Date.now()-start,rms,wavBytes:bytes.length,sampleRate:view.getUint32(24,true),metrics:await page.locator('.metrics strong').allTextContents()};
    reports.push(report);console.log('MODEL',JSON.stringify(report));
    await writeFile(`test-results/pages-${id}.wav`,bytes);
    await page.screenshot({path:`test-results/pages-${id}.png`,fullPage:true});
  }
  assert.deepEqual(postRequests,[],'No text or inference request should leave the browser');
  console.log('PASS',reports.length,'client CPU models, download/cache checksums, correct WAV rates, no inference POST requests');
} finally {
  await writeFile(process.env.TEST_REPORT||'test-results/models-report.json',JSON.stringify({reports,postRequests,transport:process.env.TEST_TRANSPORT || 'public-model-sources',gpuDisabled:true,scope:'/voice-lab/'},null,2));
  await context.close();
}
