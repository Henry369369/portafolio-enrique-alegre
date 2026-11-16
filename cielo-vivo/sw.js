// Service worker de Cielo Vivo
// - App: primero la red (para recibir actualizaciones) y, sin conexión, lo guardado.
// - Mapas y fotos: se guardan al verlos, para poder usarlos después sin internet.
const CACHE='cielo-vivo-v11',TILES='cielo-mapas-v1',MAXTILES=1500;
const FILES=['./','./index.html','./data.js','./satellite.min.js','./manifest.json','./icon-192.png','./icon-512.png','./leaflet/leaflet.js','./leaflet/leaflet.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==TILES).map(k=>caches.delete(k)))));self.clients.claim()});
const esMapa=u=>/tile\.openstreetmap\.org|arcgisonline\.com|upload\.wikimedia\.org/.test(u.hostname);
async function recortar(){const c=await caches.open(TILES);const k=await c.keys();if(k.length>MAXTILES)for(const r of k.slice(0,k.length-MAXTILES))await c.delete(r)}
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;const u=new URL(e.request.url);
  if(esMapa(u)){
    e.respondWith(caches.open(TILES).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque'){c.put(e.request,r.clone());if(Math.random()<0.05)recortar()}return r}))));
    return;
  }
  if(u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));return r}).catch(()=>caches.match(e.request)));
});
