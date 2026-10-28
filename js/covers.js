// Book covers, kept on this device so they show instantly (book list, calendar, talk).
// Remote covers are slow: Open Library redirects twice to archive.org, and 版元ドットコム
// redirects to a new URL on every request, so the browser never caches them. Each cover
// is fetched once, shrunk, and stored in IndexedDB; pages then show it from memory.
// Japanese covers found by ISBN through the relay are stored as "isbn:978…".

import { WORKER_URL } from './config.js';

const DB = 'yoshotalk-covers';
const STORE = 'covers';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const ready = new Map(); // source → object URL
const pending = new Map(); // source → Promise<object URL | null>
const failed = new Set(); // not retried until the page reloads

let dbp = null;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

// Read every stored cover into memory (called once before the first page is drawn).
export async function loadCovers() {
  try {
    const d = await db();
    await new Promise((resolve) => {
      const t = d.transaction(STORE, 'readonly');
      t.objectStore(STORE).openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return;
        ready.set(cur.key, URL.createObjectURL(cur.value));
        cur.continue();
      };
      t.oncomplete = t.onerror = () => resolve();
    });
  } catch { /* no IndexedDB (private mode): covers just load from the web */ }
}

// The src to draw for a cover. Not stored yet → start storing it, and swap it into
// every <img data-cover="source"> on the page when it is ready.
export function coverSrc(source) {
  if (!source || /^(data|blob):/.test(source)) return source || '';
  if (ready.has(source)) return ready.get(source);
  cacheCover(source).then((url) => {
    if (url) document.querySelectorAll('img[data-cover]').forEach((img) => { if (img.dataset.cover === source) img.src = url; });
  });
  return source.startsWith('isbn:') ? BLANK : source;
}

export function cacheCover(source) {
  if (ready.has(source)) return Promise.resolve(ready.get(source));
  if (failed.has(source)) return Promise.resolve(null);
  if (!pending.has(source)) {
    pending.set(source, (async () => {
      try {
        const small = await shrink(await fetchCover(source));
        const url = URL.createObjectURL(small);
        ready.set(source, url);
        db().then((d) => d.transaction(STORE, 'readwrite').objectStore(STORE).put(small, source)).catch(() => {});
        return url;
      } catch {
        failed.add(source);
        return null;
      } finally {
        pending.delete(source);
      }
    })());
  }
  return pending.get(source);
}

async function fetchCover(source) {
  const url = source.startsWith('isbn:') ? `${WORKER_URL}/cover?isbn=${source.slice(5)}` : source;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cover ${res.status}`);
  return res.blob();
}

// Up to 300×440 (twice the largest cover on screen), as JPEG.
async function shrink(blob) {
  const bmp = await createImageBitmap(blob);
  if (bmp.width < 20) throw new Error('not a cover'); // 1×1 "no image" pictures
  const k = Math.min(1, 300 / bmp.width, 440 / bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85));
}
