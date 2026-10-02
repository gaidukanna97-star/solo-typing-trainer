// Service worker: після першого завантаження базове навчання працює без мережі.
// Стратегія «спершу мережа, потім кеш»: онлайн завжди свіжа версія, офлайн — збережена.

const CACHE = 'solo-v7';
const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/ametrin-logo.svg',
  'src/ui/app.js',
  'src/ui/exam-views.js',
  'src/ui/account-views.js',
  'src/ui/views.js',
  'src/ui/trainer.js',
  'src/ui/keyboard.js',
  'src/ui/dom.js',
  'src/core/accounts.js',
  'src/core/analysis.js',
  'src/core/certificate.js',
  'src/core/config.js',
  'src/core/curriculum.js',
  'src/core/customtext.js',
  'src/core/feedback.js',
  'src/core/gamification.js',
  'src/core/layouts.js',
  'src/core/remote.js',
  'src/core/session.js',
  'src/core/storage.js',
  'data/derived/uk-words.json',
  'data/derived/uk-ngrams.json',
  'data/derived/en-words.json',
  'data/derived/en-ngrams.json',
  'data/derived/report.json',
  'data/curriculum/content-uk.json',
  'data/curriculum/content-en.json',
  'dictionaries/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
