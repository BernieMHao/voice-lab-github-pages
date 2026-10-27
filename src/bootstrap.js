import { BASE, assetURL } from './paths.js';

async function boot() {
  if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('請透過 GitHub Pages 的 HTTPS 網址開啟，並使用支援 Service Worker 的 Chrome／Edge。');
  const previous = await navigator.serviceWorker.getRegistration(assetURL(''));
  if (previous?.scope === assetURL('')) previous.update().catch(() => {});
  else await navigator.serviceWorker.register(assetURL('sw.js'), { scope: BASE });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once:true }));
  const key = 'voice-lab-isolation-reload:' + BASE;
  if (!crossOriginIsolated) {
    if (sessionStorage.getItem(key)) throw new Error('瀏覽器未能啟用本機推論需要的跨來源隔離。請使用新版 Chrome／Edge，並允許這個網站使用 Service Worker。');
    sessionStorage.setItem(key, '1');
    location.reload();
    return;
  }
  sessionStorage.removeItem(key);
  await import('./app.js');
}
boot().catch(error => {
  document.getElementById('status').textContent = error.message;
  document.getElementById('generate').disabled = true;
  document.getElementById('load').disabled = true;
});
