// Pictures for words: Pixabay photos searched by the relay (needs PIXABAY_KEY there).
// Pixabay asks for search results to be cached for 24 hours and for photos not to be
// kept for good, so only the search results are kept here, for a day.

import { esc } from './util.js';
import { getPasscode, relayPost } from './api.js';

const KEY = 'yoshotalk:images';
const TTL = 24 * 60 * 60 * 1000;
const MAX = 60;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

// [{ src, page, user, tags }], or [] when there are none or image search isn't set up.
export async function searchImages(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !getPasscode()) return [];
  const kept = load();
  if (kept[q] && Date.now() - kept[q].at < TTL) return kept[q].list;
  try {
    const res = await relayPost('/images', { q });
    if (!res.ok) return [];
    const { images = [] } = await res.json();
    kept[q] = { at: Date.now(), list: images };
    // Drop expired searches and keep the newest ones.
    const fresh = Object.entries(kept).filter(([, v]) => Date.now() - v.at < TTL).sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(fresh))); } catch { /* full: just not kept */ }
    return images;
  } catch { return []; }
}

// The strip of photos (each links to its Pixabay page, as Pixabay asks).
export function picturesHTML(images, emoji = '') {
  const pics = images.slice(0, 3);
  return `
    <div class="dict-pic-row">
      ${emoji ? `<span class="dict-emoji" aria-hidden="true">${esc(emoji)}</span>` : ''}
      ${pics.map((p) => `<a class="dict-pic" href="${esc(p.page)}" target="_blank" rel="noopener" title="Pixabay: ${esc(p.user)}"><img src="${esc(p.src)}" alt="${esc(p.tags)}" loading="lazy"></a>`).join('')}
    </div>
    ${pics.length ? '<a class="dict-credit" href="https://pixabay.com/" target="_blank" rel="noopener">Images: Pixabay</a>' : ''}`;
}
