import { $, $$ } from './util.js';
import { onChange, levelInfo, currentStreak } from './store.js';
import { renderBooks, renderBookDetail } from './books.js';
import { renderTalk } from './talk.js';
import { renderWords } from './words.js';
import { renderPlay } from './play.js';
import { renderSettings } from './settings.js';
import { renderAvatarCheck } from './avatar-check.js';

const routes = {
  books: renderBooks,
  book: renderBookDetail,
  talk: renderTalk,
  words: renderWords,
  play: renderPlay,
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

function renderChip() {
  const { level, into, need } = levelInfo();
  const streak = currentStreak();
  $('#playerChip').innerHTML = `
    <span class="chip-level">Lv.${level}</span>
    <span class="chip-bar"><span style="width:${(into / need) * 100}%"></span></span>
    <span class="chip-streak" title="連続学習日数">🔥${streak}</span>`;
}

window.addEventListener('hashchange', route);
onChange(renderChip);
renderChip();
route();
