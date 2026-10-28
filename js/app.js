import { $, $$ } from './util.js';
import { onChange, talkUsage } from './store.js';
import { renderBooks, renderBookDetail } from './books.js';
import { renderTalk } from './talk.js';
import { renderWords } from './words.js';
import { renderSettings } from './settings.js';
import { renderAvatarCheck } from './avatar-check.js';
import { renderHistory } from './history.js';
import { renderDict } from './dict.js';
import { renderLogin } from './login.js';
import { CLOUD, initCloud, signedIn } from './cloud.js';
import { loadCovers } from './covers.js';
import './install.js'; // listens for the install prompt from page load

const routes = {
  books: renderBooks,
  book: renderBookDetail,
  talk: renderTalk,
  words: renderWords,
  settings: renderSettings,
  avatars: renderAvatarCheck,
  history: renderHistory,
  dict: renderDict,
  login: renderLogin,
};

let cleanup = null;

function route() {
  const [name = 'books', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  // With accounts, everything but the login page needs a login.
  if (CLOUD && !signedIn() && name !== 'login') { location.hash = '#/login'; return; }
  document.body.classList.toggle('logged-out', CLOUD && !signedIn());
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
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  $('#playerChip').innerHTML = `
    <span class="chip-level">🎙️ ${min}<small>/${limit / 60}分</small></span>
    <span class="chip-bar ${pct >= 90 ? 'warn' : ''}"><span style="width:${pct}%"></span></span>`;
}

window.addEventListener('hashchange', route);
onChange(renderChip);
renderChip();
// Stored covers and the account's data first, so the first page draws them right away.
Promise.all([loadCovers(), initCloud().catch((err) => console.error(err))]).then(route);
