// Small DOM / date helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export function localDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export const today = () => localDate();

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}分${s ? s + '秒' : ''}` : `${s}秒`;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function toast(msg, kind = 'info') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3300);
}

// English text-to-speech with the browser's built-in voices (free, offline-ish).
export function speak(text, rate = 0.95) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  const v = speechSynthesis.getVoices().find((v) => v.lang === 'en-US' && /Samantha|Google US|Aria|Jenny/i.test(v.name))
    || speechSynthesis.getVoices().find((v) => v.lang.startsWith('en'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// Opens the shared <dialog>. `onSubmit(formData, form)` may return false to keep it open.
export function openDialog(html, { onSubmit, onOpen } = {}) {
  const dlg = $('#dialog');
  dlg.innerHTML = html;
  const form = dlg.querySelector('form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keep = onSubmit ? await onSubmit(new FormData(form), form) : true;
      if (keep !== false) dlg.close();
    });
  }
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.showModal();
  onOpen?.(dlg);
  return dlg;
}

export function stars(n) {
  return '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));
}
