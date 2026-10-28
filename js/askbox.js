// A floating text chat (bottom right) for asking about the feedback phrases:
// grammar, word meanings, nuance, more examples. Text only, via the relay.

import { $, esc } from './util.js';
import { ensurePasscode } from './api.js';
import { responsesText } from './live.js';

let current = null;

// phrases: feedback phrases [{ polished, key_phrase, meaning_ja, why_ja, you_said }]
// words: word-book entries [{ term, meaning, example, note }]
export function openAskBox({ phrases = [], words = [], level, bookTitle }) {
  const suggestions = phrases.length ? phrases.map((p) => p.key_phrase) : words.map((w) => w.term);
  closeAskBox();
  const history = []; // [{ role, content }]
  const root = document.createElement('div');
  root.className = 'askbox';
  root.innerHTML = `
    <button class="ask-fab" aria-expanded="false" aria-controls="askPanel">💬 <span>表現について質問</span></button>
    <section class="ask-panel" id="askPanel" role="dialog" aria-label="表現について質問" hidden>
      <header class="ask-head">
        <b>💬 表現について質問</b>
        <button class="icon-btn" data-ask-close aria-label="閉じる">✕</button>
      </header>
      <div class="ask-log" aria-live="polite">
        <p class="ask-msg ask-ai">${phrases.length ? 'ワンランク上の表現' : '単語帳の単語・フレーズ'}について、文法・意味・ニュアンス・ほかの例文など、何でも日本語か英語で聞いてください。</p>
      </div>
      <div class="ask-suggest">
        ${suggestions.slice(0, 3).map((t) => `<button data-suggest="「${esc(t)}」はどんな場面で使えますか？例文もください。">${esc(t)} の使い方</button>`).join('')}
      </div>
      <form class="ask-form">
        <textarea name="q" rows="1" placeholder="例：${esc(suggestions[0] || 'この表現')} のニュアンスは？" aria-label="質問"></textarea>
        <button class="btn btn-primary btn-sm" aria-label="送信">送信</button>
      </form>
    </section>`;
  document.body.appendChild(root);

  const fab = $('.ask-fab', root);
  const panel = $('.ask-panel', root);
  const log = $('.ask-log', root);
  const form = $('.ask-form', root);
  const ta = form.q;

  const setOpen = (open) => {
    panel.hidden = !open;
    root.classList.toggle('open', open);
    fab.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => ta.focus(), 50);
  };
  fab.onclick = () => setOpen(panel.hidden);
  $('[data-ask-close]', root).onclick = () => setOpen(false);
  root.querySelectorAll('[data-suggest]').forEach((b) => (b.onclick = () => send(b.dataset.suggest)));
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.onsubmit = (e) => { e.preventDefault(); send(ta.value); };

  const add = (role, html) => {
    const p = document.createElement('div');
    p.className = `ask-msg ask-${role}`;
    p.innerHTML = html;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  };

  const context = phrases.length
    ? `understand feedback from an English conversation${bookTitle ? ` about the book "${bookTitle}"` : ''}.
The learner received these polished expressions:
${phrases.map((p, i) => `${i + 1}. "${p.polished}" — key phrase "${p.key_phrase}" (${p.meaning_ja}). They had said: "${p.you_said}". Why: ${p.why_ja}`).join('\n')}`
    : `study the words and phrases in their personal word book (collected from conversations about English books):
${words.map((w) => `- ${w.term}${w.meaning ? ` (${w.meaning})` : ''}${w.example ? ` e.g. "${w.example}"` : ''}`).join('\n') || '(empty)'}`;
  const instructions = `You are a friendly, precise English teacher helping a Japanese learner (CEFR ${level || 'B1'}) ${context}

Answer their questions about these expressions, grammar, vocabulary, nuance or usage — including words that are not in the list.
- Reply in Japanese unless they write in English. Keep answers short and clear (usually 2-6 sentences), with 1-2 example sentences when helpful.
- If the question rests on a misunderstanding (for example, calling a present perfect form "progressive"), gently correct it first, then explain.
- Use **bold** for key words. No headings or tables.
- Stay on English learning; politely steer back if asked about unrelated topics.`;

  let busy = false;
  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    if (panel.hidden) setOpen(true);
    if (!(await ensurePasscode())) return;
    busy = true;
    ta.value = '';
    ta.style.height = 'auto';
    add('me', esc(text));
    history.push({ role: 'user', content: text });
    const wait = add('ai', '<span class="ask-typing"><i></i><i></i><i></i></span>');
    try {
      const answer = await responsesText({ instructions, input: history.slice(-12), light: true });
      history.push({ role: 'assistant', content: answer });
      wait.innerHTML = format(answer);
    } catch (err) {
      history.pop();
      wait.classList.add('ask-error');
      wait.textContent = `答えを取得できませんでした：${err.message}`;
    }
    busy = false;
    log.scrollTop = log.scrollHeight;
  }

  current = {
    root,
    // Open the box with a question started about one phrase.
    prefill(text) { setOpen(true); ta.value = text; ta.dispatchEvent(new Event('input')); ta.focus(); },
  };
  return current;
}

export function closeAskBox() {
  current?.root.remove();
  current = null;
}

// Minimal formatting: escape, then **bold** and line breaks.
function format(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}
