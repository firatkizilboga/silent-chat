const CACHE_NAME = 'silent-chat-v8';
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './js/app.js',
    './js/api.js',
    './js/config.js',
    './js/crypto.js',
    './js/events.js',
    './js/storage.js',
    './js/ui.js',
    './js/utils.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
