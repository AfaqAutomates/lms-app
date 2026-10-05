const CACHE = 'lms-shell-v2';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/icons.js', './js/config.js', './manifest.json'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for the app shell (so you always get the latest version when
// online), falling back to the cached copy when offline. Data calls to
// Supabase are NOT cached here — recording an activity still needs a live
// connection; this only keeps the page itself loadable without signal.
self.addEventListener('fetch', e=>{
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return; // don't touch Supabase/CDN calls
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy));
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
