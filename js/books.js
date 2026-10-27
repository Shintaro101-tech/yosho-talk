import { $, $$, esc, formatDate, formatDuration, openDialog, stars, today, toast } from './util.js';
import { data, addBook, updateBook, deleteBook, getBook } from './store.js';

const STATUS = {
  want: { label: '読みたい', cls: 'st-want' },
  reading: { label: '読書中', cls: 'st-reading' },
  finished: { label: '読了', cls: 'st-finished' },
};

let viewMode = 'list';
let filter = 'all';
let calMonth = today().slice(0, 7);

// ---------------------------------------------------------------- list + calendar
export function renderBooks(el) {
  const draw = () => {
    const books = data.books.filter((b) => filter === 'all' || b.status === filter);
    const finishedThisYear = data.books.filter((b) => b.status === 'finished' && (b.finishDate || '').startsWith(today().slice(0, 4))).length;
    el.innerHTML = `
      <section class="hero">
        <div>
          <h1>My Bookshelf</h1>
          <p class="muted">今年の読了 <strong>${finishedThisYear}</strong> 冊 ・ 登録 <strong>${data.books.length}</strong> 冊</p>
        </div>
        <button class="btn btn-primary" id="addBook">＋ 本を追加</button>
      </section>
      <div class="toolbar">
        <div class="seg" role="tablist">
          <button data-mode="list" class="${viewMode === 'list' ? 'on' : ''}">リスト</button>
          <button data-mode="calendar" class="${viewMode === 'calendar' ? 'on' : ''}">カレンダー</button>
        </div>
        ${viewMode === 'list' ? `
        <div class="seg seg-sm">
          ${[['all', 'すべて'], ['reading', '読書中'], ['finished', '読了'], ['want', '読みたい']]
            .map(([k, l]) => `<button data-filter="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>` : ''}
      </div>
      <div id="shelf"></div>`;

    const shelf = $('#shelf', el);
    if (viewMode === 'calendar') drawCalendar(shelf, draw);
    else if (!books.length) {
      shelf.innerHTML = data.books.length
        ? `<p class="empty">この条件の本はありません。</p>`
        : `<div class="empty-state">
             <img src="assets/banner.jpg" alt="">
             <h2>最初の1冊を登録しよう</h2>
             <p>読んだ本・読んでいる本を追加すると、その本についてアバターと英語でトークできます。</p>
           </div>`;
    } else {
      shelf.innerHTML = `<div class="book-grid">${books.map(bookCard).join('')}</div>`;
    }

    $('#addBook', el).onclick = () => openBookForm(null, draw);
    $$('[data-mode]', el).forEach((b) => (b.onclick = () => { viewMode = b.dataset.mode; draw(); }));
    $$('[data-filter]', el).forEach((b) => (b.onclick = () => { filter = b.dataset.filter; draw(); }));
  };
  draw();
}

function cover(b, size = '') {
  return b.cover
    ? `<img class="cover ${size}" src="${esc(b.cover)}" alt="" loading="lazy">`
    : `<div class="cover cover-blank ${size}" style="--h:${hue(b.title)}"><span>${esc(b.title)}</span></div>`;
}
const hue = (s = '') => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

function bookCard(b) {
  const talks = data.talks.filter((t) => t.bookId === b.id).length;
  const words = data.vocab.filter((v) => v.bookId === b.id).length;
  return `
    <a class="book-card" href="#/book/${b.id}">
      ${cover(b)}
      <div class="book-info">
        <span class="badge ${STATUS[b.status].cls}">${STATUS[b.status].label}</span>
        <h3>${esc(b.title)}</h3>
        <p class="muted">${esc(b.author || '')}</p>
        ${b.rating ? `<p class="stars">${stars(b.rating)}</p>` : ''}
        <p class="mini">${b.finishDate ? `📅 ${formatDate(b.finishDate)}` : ''} ${talks ? `🎙️${talks}` : ''} ${words ? `🗂️${words}` : ''}</p>
      </div>
    </a>`;
}

function drawCalendar(box, redraw) {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = first.getDay();
  const byDay = {};
  data.books.filter((b) => b.status === 'finished' && b.finishDate?.startsWith(calMonth))
    .forEach((b) => (byDay[+b.finishDate.slice(8)] ||= []).push(b));
  const talkDays = new Set(data.talks.filter((t) => t.date.startsWith(calMonth)).map((t) => +t.date.slice(8)));
  const monthCount = Object.values(byDay).flat().length;
  const t = today();

  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<div class="cal-cell blank"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${calMonth}-${String(d).padStart(2, '0')}`;
    const list = byDay[d] || [];
    cells += `
      <div class="cal-cell ${ds === t ? 'today' : ''}">
        <span class="cal-day">${d}${talkDays.has(d) ? '<i class="talk-dot" title="トークした日"></i>' : ''}</span>
        <div class="cal-books">${list.map((b) => `<a href="#/book/${b.id}" title="${esc(b.title)}">${cover(b, 'xs')}</a>`).join('')}</div>
      </div>`;
  }

  box.innerHTML = `
    <div class="calendar card">
      <div class="cal-head">
        <button class="btn btn-ghost" data-cal="-1" aria-label="前の月">‹</button>
        <h2>${y}年${m}月 <small class="muted">読了 ${monthCount} 冊</small></h2>
        <button class="btn btn-ghost" data-cal="1" aria-label="次の月">›</button>
      </div>
      <div class="cal-grid">
        ${['日', '月', '火', '水', '木', '金', '土'].map((w) => `<div class="cal-w">${w}</div>`).join('')}
        ${cells}
      </div>
      <p class="mini muted">読了日に表紙が並びます。<i class="talk-dot"></i> はトークした日。</p>
    </div>`;
  $$('[data-cal]', box).forEach((b) => (b.onclick = () => {
    const d = new Date(y, m - 1 + Number(b.dataset.cal), 1);
    calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    redraw();
  }));
}

// ---------------------------------------------------------------- add / edit form
export function openBookForm(book, done) {
  const b = book || { status: 'reading', startDate: today() };
  openDialog(`
    <form class="form" method="dialog">
      <h2>${book ? '本を編集' : '本を追加'}</h2>
      <label>タイトル（英語）
        <div class="row">
          <input name="title" required value="${esc(b.title || '')}" placeholder="e.g. Wonder" autocomplete="off">
          <button type="button" class="btn" id="olSearch">🔍 検索</button>
        </div>
      </label>
      <div id="olResults" class="ol-results"></div>
      <label>著者 <input name="author" value="${esc(b.author || '')}"></label>
      <input type="hidden" name="cover" value="${esc(b.cover || '')}">
      <div class="grid2">
        <label>ステータス
          <select name="status">
            ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </label>
        <label>評価
          <select name="rating">
            ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${+b.rating === n ? 'selected' : ''}>${n ? stars(n) : '—'}</option>`).join('')}
          </select>
        </label>
        <label>読み始め <input type="date" name="startDate" value="${esc(b.startDate || '')}"></label>
        <label>読了日 <input type="date" name="finishDate" value="${esc(b.finishDate || '')}"></label>
      </div>
      <label>メモ・感想（トークのときアバターに伝わります）
        <textarea name="memo" rows="3" placeholder="好きな場面、印象に残った言葉、どこまで読んだか など">${esc(b.memo || '')}</textarea>
      </label>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
        <button class="btn btn-primary">${book ? '保存' : '追加'}</button>
      </div>
    </form>`, {
    onOpen: (dlg) => {
      const form = dlg.querySelector('form');
      form.status.onchange = () => {
        if (form.status.value === 'finished' && !form.finishDate.value) form.finishDate.value = today();
      };
      $('#olSearch', dlg).onclick = () => searchOpenLibrary(form, $('#olResults', dlg));
      form.title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); searchOpenLibrary(form, $('#olResults', dlg)); }
      });
    },
    onSubmit: (fd) => {
      const v = Object.fromEntries(fd);
      v.rating = +v.rating;
      if (v.status === 'finished' && !v.finishDate) v.finishDate = today();
      if (book) updateBook(book.id, v);
      else addBook(v);
      done?.();
    },
  });
}

async function searchOpenLibrary(form, box) {
  const q = form.title.value.trim();
  if (!q) return;
  box.innerHTML = `<p class="mini muted">検索中…</p>`;
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6&fields=title,author_name,cover_i,first_publish_year,language`;
    const res = await fetch(url);
    const j = await res.json();
    const docs = (j.docs || []).filter((d) => d.cover_i).slice(0, 6);
    if (!docs.length) { box.innerHTML = `<p class="mini muted">表紙が見つかりませんでした。そのまま登録できます。</p>`; return; }
    box.innerHTML = docs.map((d, i) => `
      <button type="button" class="ol-item" data-i="${i}">
        <img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" alt="">
        <span><strong>${esc(d.title)}</strong><br><small>${esc((d.author_name || []).join(', '))} ${d.first_publish_year ? `(${d.first_publish_year})` : ''}</small></span>
      </button>`).join('');
    $$('.ol-item', box).forEach((btn) => (btn.onclick = () => {
      const d = docs[+btn.dataset.i];
      form.title.value = d.title;
      form.author.value = (d.author_name || []).slice(0, 2).join(', ');
      form.cover.value = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
      $$('.ol-item', box).forEach((x) => x.classList.toggle('picked', x === btn));
    }));
  } catch {
    box.innerHTML = `<p class="mini muted">検索できませんでした（オフライン？）。そのまま登録できます。</p>`;
  }
}

// ---------------------------------------------------------------- detail
export function renderBookDetail(el, [id]) {
  const draw = () => {
    const b = getBook(id);
    if (!b) { el.innerHTML = `<p class="empty">本が見つかりません。<a href="#/books">本棚へ戻る</a></p>`; return; }
    const talks = data.talks.filter((t) => t.bookId === b.id);
    const words = data.vocab.filter((v) => v.bookId === b.id);
    el.innerHTML = `
      <a href="#/books" class="back">‹ 本棚</a>
      <section class="detail card">
        ${cover(b, 'lg')}
        <div class="detail-body">
          <span class="badge ${STATUS[b.status].cls}">${STATUS[b.status].label}</span>
          <h1>${esc(b.title)}</h1>
          <p class="muted">${esc(b.author || '')}</p>
          ${b.rating ? `<p class="stars">${stars(b.rating)}</p>` : ''}
          <p class="mini">${b.startDate ? `読み始め ${formatDate(b.startDate)}` : ''} ${b.finishDate ? `・ 読了 ${formatDate(b.finishDate)}` : ''}</p>
          ${b.memo ? `<p class="memo">${esc(b.memo)}</p>` : ''}
          <div class="actions-left">
            <a class="btn btn-primary" href="#/talk/${b.id}">🎙️ この本についてトーク</a>
            ${b.status !== 'finished' ? `<button class="btn" id="finish">✅ 読了にする</button>` : ''}
            <button class="btn btn-ghost" id="edit">編集</button>
            <button class="btn btn-ghost danger" id="del">削除</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>🗂️ この本から学んだ単語 <small class="muted">${words.length}</small></h2>
        ${words.length ? `<ul class="chips">${words.map((v) => `<li title="${esc(v.meaning)}">${esc(v.term)}</li>`).join('')}</ul>`
          : `<p class="muted mini">トークすると、ここに単語やフレーズがたまっていきます。</p>`}
      </section>

      <section class="card">
        <h2>🎙️ トーク履歴 <small class="muted">${talks.length}</small></h2>
        ${talks.length ? talks.map((t) => `
          <details class="talk-log">
            <summary>${formatDate(t.date)} ・ ${esc(t.modeLabel || '')} ・ ${formatDuration(t.durationSec || 0)}</summary>
            <div class="transcript small">${(t.turns || []).map((x) => `<p class="line ${x.role}"><b>${x.role === 'user' ? 'You' : esc(t.avatarName || 'Partner')}</b> ${esc(x.text)}</p>`).join('')}</div>
          </details>`).join('')
          : `<p class="muted mini">まだトークしていません。</p>`}
      </section>`;

    $('#edit', el).onclick = () => openBookForm(b, draw);
    const fin = $('#finish', el);
    if (fin) fin.onclick = () => { updateBook(b.id, { status: 'finished', finishDate: b.finishDate || today() }); draw(); };
    $('#del', el).onclick = () => {
      if (!confirm(`「${b.title}」を削除しますか？（単語帳の単語は残ります）`)) return;
      deleteBook(b.id);
      toast('削除しました');
      location.hash = '#/books';
    };
  };
  draw();
}
