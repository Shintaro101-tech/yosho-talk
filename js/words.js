import { $, $$, esc, openDialog, speak, toast } from './util.js';
import { data, addVocab, updateVocab, deleteVocab, getBook, isDue, isMastered } from './store.js';

let query = '';
let bookFilter = '';

export function renderWords(el) {
  const draw = () => {
    const q = query.toLowerCase();
    const list = data.vocab.filter((v) =>
      (!bookFilter || v.bookId === bookFilter) &&
      (!q || v.term.toLowerCase().includes(q) || v.meaning.includes(query)));
    const due = data.vocab.filter(isDue).length;
    const mastered = data.vocab.filter(isMastered).length;
    const bookIds = [...new Set(data.vocab.map((v) => v.bookId).filter(Boolean))];

    el.innerHTML = `
      <section class="hero">
        <div>
          <h1>My Word Book</h1>
          <p class="muted">登録 <strong>${data.vocab.length}</strong> 語 ・ 今日の復習 <strong>${due}</strong> ・ マスター <strong>${mastered}</strong></p>
        </div>
        <div class="row">
          ${due ? `<a class="btn btn-primary" href="#/play/flash">🃏 今日の復習 (${due})</a>` : ''}
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
           <p>トーク中に “Can you save that phrase?” と頼むか、トーク後の「抽出」で単語がたまります。手動でも追加できます。</p></div>`}`;

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
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => openWordForm(data.vocab.find((v) => v.id === b.dataset.edit), draw)));
    $$('[data-del]', el).forEach((b) => (b.onclick = () => {
      const v = data.vocab.find((x) => x.id === b.dataset.del);
      if (confirm(`「${v.term}」を削除しますか？`)) { deleteVocab(v.id); draw(); }
    }));
  };
  draw();
}

function mastery(v) {
  const pct = Math.min(100, Math.round((v.srs.interval / 21) * 100));
  return `<span class="mastery" title="定着度 ${pct}%"><span style="width:${pct}%"></span></span>`;
}

function wordRow(v) {
  const book = v.bookId ? getBook(v.bookId) : null;
  return `
    <li class="word card">
      <div class="word-head">
        <h3>${esc(v.term)}</h3>
        <button class="icon-btn" data-speak="${esc(v.term)}" aria-label="発音を聞く">🔊</button>
        ${isDue(v) ? '<span class="badge st-reading">復習</span>' : ''}
        ${isMastered(v) ? '<span class="badge st-finished">マスター</span>' : ''}
        <span class="spacer"></span>
        <button class="icon-btn" data-edit="${v.id}" aria-label="編集">✏️</button>
        <button class="icon-btn" data-del="${v.id}" aria-label="削除">🗑️</button>
      </div>
      <p class="meaning">${esc(v.meaning)}</p>
      ${v.example ? `<p class="example">${esc(v.example)} <button class="icon-btn sm" data-speak="${esc(v.example)}" aria-label="例文を聞く">🔊</button></p>` : ''}
      ${v.note ? `<p class="mini muted">${esc(v.note)}</p>` : ''}
      <div class="word-foot">${mastery(v)} ${book ? `<a class="mini" href="#/book/${book.id}">📖 ${esc(book.title)}</a>` : ''}</div>
    </li>`;
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
