import { $, $$, esc, openDialog, speak, toast } from './util.js';
import { data, save, addVocab, updateVocab, deleteVocab, getBook } from './store.js';
import { relayReady } from './api.js';
import { responsesJSON } from './live.js';
import { searchImages, picturesHTML } from './images.js';
import { bookCover } from './books.js';
import { openAskBox, closeAskBox } from './askbox.js';
import { canUseAI } from './cloud.js';
import { practiseWord } from './talk.js';

let query = '';
let bookFilter = '';

export function renderWords(el) {
  const draw = () => {
    const q = query.toLowerCase();
    const list = data.vocab.filter((v) =>
      (!bookFilter || v.bookId === bookFilter) &&
      (!q || v.term.toLowerCase().includes(q) || v.meaning.includes(query)));
    const bookIds = [...new Set(data.vocab.map((v) => v.bookId).filter(Boolean))];

    el.innerHTML = `
      <section class="hero">
        <div>
          <h1>My Word Book</h1>
          <p class="muted">登録 <strong>${data.vocab.length}</strong> 語</p>
        </div>
        <div class="row">
          <button class="btn" id="add">＋ 追加</button>
        </div>
      </section>
      <div class="toolbar">
        <input type="search" id="q" placeholder="🔍 単語・意味で検索" value="${esc(query)}">
        <select id="bf">
          <option value="">すべての本</option>
          ${bookIds.map((id) => `<option value="${id}" ${id === bookFilter ? 'selected' : ''}>${esc(getBook(id)?.title || '（削除された本）')}</option>`).join('')}
        </select>
      </div>
      ${list.length ? `<ul class="word-list">${list.map(wordRow).join('')}</ul>`
        : `<div class="empty-state small"><h2>${data.vocab.length ? '見つかりません' : '単語帳はまだ空です'}</h2>
           <p>トーク中に “Can you save that phrase?” と頼むか、ディスプレイやトーク後のフィードバックの「＋単語帳」で単語がたまります。手動でも追加できます。</p></div>`}`;

    $('#add', el).onclick = () => openWordForm(null, draw);
    const qi = $('#q', el);
    qi.oninput = () => {
      query = qi.value;
      draw();
      const n = $('#q', el);
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    };
    $('#bf', el).onchange = (e) => { bookFilter = e.target.value; draw(); };
    $$('[data-speak]', el).forEach((b) => (b.onclick = () => speak(b.dataset.speak)));
    $$('[data-pics]', el).forEach((b) => (b.onclick = () => togglePictures(b.closest('.word'))));
    $$('[data-practice]', el).forEach((b) => (b.onclick = () => practiseWord(data.vocab.find((v) => v.id === b.dataset.practice))));
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => openWordForm(data.vocab.find((v) => v.id === b.dataset.edit), draw)));
    $$('[data-del]', el).forEach((b) => (b.onclick = () => {
      const v = data.vocab.find((x) => x.id === b.dataset.del);
      if (confirm(`「${v.term}」を削除しますか？`)) { deleteVocab(v.id); draw(); }
    }));
  };
  // Floating chat for questions about the words (the newest 60 are given as context).
  openAskBox({ words: () => data.vocab.slice(0, 60), level: data.settings.level });
  draw();
  addEmoji();
  return closeAskBox;
}

function wordRow(v) {
  const book = v.bookId ? getBook(v.bookId) : null;
  return `
    <li class="word card" data-id="${v.id}">
      <div class="word-head">
        <h3 data-pics>${esc(v.term)}</h3>
        <button class="icon-btn" data-speak="${esc(v.term)}" aria-label="発音を聞く">🔊</button>
        <button class="icon-btn" data-pics aria-label="イメージ写真を見る" title="イメージ写真">🖼️</button>
        <span class="word-actions">
          ${canUseAI() ? `<button class="icon-btn" data-practice="${v.id}" aria-label="この語を使う会話練習" title="会話練習">🎙️</button>` : ''}
          <button class="icon-btn" data-edit="${v.id}" aria-label="編集">✏️</button>
          <button class="icon-btn" data-del="${v.id}" aria-label="削除">🗑️</button>
        </span>
      </div>
      <div class="word-pics dict-pics" hidden></div>
      <p class="meaning">${esc(v.meaning)}</p>
      ${v.example ? `<p class="example">${esc(v.example)} <button class="icon-btn sm" data-speak="${esc(v.example)}" aria-label="例文を聞く">🔊</button></p>` : ''}
      ${v.note ? `<p class="mini muted">${esc(v.note)}</p>` : ''}
      ${book ? `<a class="word-book" href="#/book/${book.id}" title="この語が出てきた本">${bookCover(book, 'xs')}<span>${esc(book.title)}</span></a>` : ''}
    </li>`;
}

// Photos for a word, searched when its card is opened (not kept: Pixabay's rule).
async function togglePictures(card) {
  const box = $('.word-pics', card);
  if (!box.hidden) { box.hidden = true; return; }
  const v = data.vocab.find((x) => x.id === card.dataset.id);
  if (!v) return;
  box.hidden = false;
  box.innerHTML = '<p class="mini muted">写真を探しています…</p>';
  const images = await searchImages(v.imageQuery || v.term);
  box.innerHTML = images.length ? picturesHTML(images) : '<p class="mini muted">写真が見つかりませんでした。</p>';
}

// Words without a photo search phrase (saved in talks, from feedback, or before the
// dictionary had them) get one, a batch at a time, in the background.
let addingEmoji = false;
async function addEmoji() {
  if (addingEmoji || !relayReady()) return;
  addingEmoji = true;
  try {
    let todo;
    while ((todo = data.vocab.filter((v) => !v.visualDone).slice(0, 40)).length) {
      const { items } = await responsesJSON({
        instructions: `For each English word or phrase (from a Japanese learner's word book), give:
- emoji: 1–3 emoji that picture its meaning (serendipity → "🍀✨"), or "" if none fits.
- image_query: 1–3 English words to search a photo library for a picture of its meaning — what the picture should show, not always the word itself (serendipity → "happy coincidence", run → "man running"); "" for words that can't be pictured.
Return one item per input line, with the same n.`,
        input: todo.map((v, n) => `${n}. ${v.term}${v.meaning ? ` (${v.meaning})` : ''}`).join('\n'),
        schemaName: 'word_visuals',
        kind: 'visual',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['n', 'emoji', 'image_query'],
                properties: { n: { type: 'integer' }, emoji: { type: 'string' }, image_query: { type: 'string' } },
              },
            },
          },
        },
      });
      for (const it of items) {
        const v = todo[it.n];
        if (!v) continue;
        v.emoji = it.emoji;
        v.imageQuery = it.image_query;
      }
      todo.forEach((v) => (v.visualDone = true)); // even if one was skipped: don't ask again
      save();
    }
  } catch { /* offline or relay unavailable: try again next time */ }
  addingEmoji = false;
}

function openWordForm(v, done) {
  openDialog(`
    <form class="form">
      <h2>${v ? '単語を編集' : '単語を追加'}</h2>
      <label>英語（単語・フレーズ）<input name="term" required value="${esc(v?.term || '')}"></label>
      <label>意味（日本語）<input name="meaning" value="${esc(v?.meaning || '')}"></label>
      <label>例文 <textarea name="example" rows="2">${esc(v?.example || '')}</textarea></label>
      <label>メモ <input name="note" value="${esc(v?.note || '')}"></label>
      <label>本
        <select name="bookId">
          <option value="">—</option>
          ${data.books.map((b) => `<option value="${b.id}" ${v?.bookId === b.id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
        </select>
      </label>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
        <button class="btn btn-primary">${v ? '保存' : '追加'}</button>
      </div>
    </form>`, {
    onSubmit: (fd) => {
      const f = Object.fromEntries(fd);
      f.bookId = f.bookId || null;
      if (v) updateVocab(v.id, f);
      else if (addVocab(f)) toast('追加しました', 'success');
      done();
    },
  });
}
