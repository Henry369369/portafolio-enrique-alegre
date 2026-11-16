// Service worker: primero intenta la red (para recibir actualizaciones) y si no hay conexión usa lo guardado
const CACHE='cielo-vivo-v3';
const FILES=['./','./index.html','./data.js','./manifest.json','./icon-192.png','./icon-512.png','./leaflet/leaflet.js','./leaflet/leaflet.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET')return;
  const guardar=u.origin===location.origin||u.hostname==='unpkg.com';
  if(!guardar)return; // mosaicos del mapa: directo a internet
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));return r}).catch(()=>caches.match(e.request)));
});
