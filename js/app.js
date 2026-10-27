import { $, $$ } from './util.js';
import { onChange, talkUsage } from './store.js';
import { renderBooks, renderBookDetail } from './books.js';
import { renderTalk } from './talk.js';
import { renderWords } from './words.js';
import { renderSettings } from './settings.js';
import { renderAvatarCheck } from './avatar-check.js';
import './install.js'; // listens for the install prompt from page load

const routes = {
  books: renderBooks,
  book: renderBookDetail,
  talk: renderTalk,
  words: renderWords,
  settings: renderSettings,
  avatars: renderAvatarCheck,
};

let cleanup = null;

function route() {
  const [name = 'books', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const render = routes[name] || renderBooks;
  if (typeof cleanup === 'function') cleanup();
  const view = $('#view');
  view.innerHTML = '';
  view.className = `view view-${name}`;
  cleanup = render(view, params) || null;
  const navKey = name === 'book' ? 'books' : name === 'avatars' ? 'settings' : name;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  window.scrollTo(0, 0);
}

// This month's talk time (capped; resets on the 1st).
function renderChip() {
  const { used, limit } = talkUsage();
  const min = Math.floor(used / 60);
  const pct = Math.min(100, (used / limit) * 100);
  $('#playerChip').innerHTML = `
    <span class="chip-level">🎙️ ${min}<small>/${limit / 60}分</small></span>
    <span class="chip-bar ${pct >= 90 ? 'warn' : ''}"><span style="width:${pct}%"></span></span>`;
}

window.addEventListener('hashchange', route);
onChange(renderChip);
renderChip();
route();
