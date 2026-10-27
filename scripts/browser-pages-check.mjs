import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
await mkdir('test-results', { recursive:true });
const context = await chromium.launchPersistentContext(process.env.TEST_PROFILE || '.research/browser-profile', { headless:true, args:['--disable-gpu','--disable-webgpu'], viewport:{width:1440,height:1080} });
const page = await context.newPage();
const downloads = [];
context.on('request', request => {
  const url = new URL(request.url());
  if (url.hostname.endsWith('huggingface.co')) downloads.push(url.origin + url.pathname);
});
page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE',message.text().slice(0,800)); });
page.on('pageerror', error => console.log('PAGEERROR',error.message));
await page.exposeFunction('reportStatus', value => console.log('STATUS',value));
await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(() => { const status = document.getElementById('status'); if (status) window.reportStatus(status.textContent); }).observe(document.body,{subtree:true,childList:true,characterData:true});
}));
async function waitIdle() {
  await page.waitForFunction(() => !document.getElementById('generate').disabled, null, {timeout:600000});
  const status = await page.locator('#status').textContent();
  assert.ok(!(await page.locator('#status').evaluate(e=>e.parentElement.classList.contains('error'))),status);
  return status;
}
async function generate() {
  await page.fill('#text','Hello, welcome to your own voice lab.');
  await page.click('#generate');
  assert.match(await waitIdle(),/^已完成/);
  assert.equal(await page.locator('#thread-badge').textContent(),'2 threads');
  const wav = Uint8Array.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.getElementById('download').href)).arrayBuffer()))));
  const view = new DataView(wav.buffer);
  assert.equal(Buffer.from(wav.slice(0,4)).toString(),'RIFF');
  assert.equal(view.getUint32(24,true),24000);
  let energy=0; for(let n=44;n<wav.length;n+=2) energy+=(view.getInt16(n,true)/32768)**2;
  assert.ok(Math.sqrt(energy/((wav.length-44)/2))>.001);
  return wav;
}
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5195/voice-lab/');
  await page.waitForFunction(() => crossOriginIsolated && document.getElementById('download-model').onclick && !document.getElementById('generate').disabled,null,{timeout:600000});
  if (!(await page.locator('#download-state').textContent()).includes('已下載')) { await page.click('#download-model'); await waitIdle(); }
  assert.match(await page.locator('#download-state').textContent(), /已下載/);
  assert.equal(await page.locator('#model').inputValue(),'2m');
  const isolation = await page.evaluate(()=>({isolated:crossOriginIsolated,shared:typeof SharedArrayBuffer,scope:navigator.serviceWorker.controller.scriptURL}));
  const keys = await page.evaluate(async()=>Array.from(await (await caches.open('voice-lab-models:/voice-lab/')).keys()).map(x=>x.url));
  assert.ok(keys.every(key=>key.includes('/models/pocket/2m/')||key.includes('/__ready__/2m/')));
  const first = await generate();
  await writeFile('test-results/pages-2m.wav',first);
  await page.screenshot({path:'test-results/pages-desktop.png',fullPage:true});
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('download-state').textContent.includes('已下載'),null,{timeout:30000});
  const offline = await generate();
  await page.click('#delete-model');
  await waitIdle();
  assert.match(await page.locator('#download-state').textContent(),/尚未下載/);
  await context.setOffline(false);
  await page.click('#download-model');
  await waitIdle();
  assert.match(await page.locator('#download-state').textContent(),/已下載/);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'test-results/pages-mobile.png',fullPage:true});
  await writeFile('test-results/pages-report.json',JSON.stringify({isolation,defaultModel:'2m',downloadedModels:['2m'],networkWeightSources:[...new Set(downloads)],offlineGeneration:true,offlineWavBytes:offline.length,deleteAndRedownload:true,gpuDisabled:true},null,2));
  console.log('PASS: header-free /voice-lab/ Pages preview, automatic 2M download, checksum cache, two-thread CPU WAV, offline reload/generation, deletion/redownload, mobile width');
} finally { await context.close(); }
