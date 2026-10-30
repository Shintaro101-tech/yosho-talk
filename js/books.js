import { $, $$, esc, formatDate, formatDuration, openDialog, stars, today, toast } from './util.js';
import { data, addBook, updateBook, deleteBook, getBook } from './store.js';
import { installBanner } from './install.js';
import { coverSrc, cacheCover } from './covers.js';

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
  let unBanner = null;
  const draw = () => {
    const books = data.books.filter((b) => filter === 'all' || b.status === filter);
    const finishedThisYear = data.books.filter((b) => b.status === 'finished' && (b.finishDate || '').startsWith(today().slice(0, 4))).length;
    el.innerHTML = `
      <div id="installSlot"></div>
      <section class="hero">
        <div>
          <h1>My Bookshelf</h1>
          <p class="tagline">読んだ本を、英語で話そう。</p>
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

    unBanner?.();
    unBanner = installBanner($('#installSlot', el));
    const shelf = $('#shelf', el);
    if (viewMode === 'calendar') drawCalendar(shelf, draw);
    else if (!books.length) {
      shelf.innerHTML = data.books.length
        ? `<p class="empty">この条件の本はありません。</p>`
        : `<div class="empty-state">
             <img src="assets/brand/banner.png" alt="洋書トーク — 読んだ本を、英語で話そう。">
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
  return () => unBanner?.();
}

export function bookCover(b, size = '') {
  return cover(b, size);
}
function cover(b, size = '') {
  return b.cover
    ? `<img class="cover ${size}" src="${esc(coverSrc(b.cover))}" data-cover="${esc(b.cover)}" alt="">`
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
      <details class="search-box" ${book ? '' : 'open'}>
        <summary>🔍 本を検索して入力${book ? '（表紙の差し替えなど）' : ''}</summary>
        <div class="search-row">
          <select id="olField" aria-label="検索する項目">
            <option value="q">タイトル・著者</option>
            <option value="title">タイトル</option>
            <option value="author">著者名</option>
          </select>
          <input id="olQuery" type="search" placeholder="例: Wonder / かがみの孤城 / 村上春樹" autocomplete="off">
          <button type="button" class="btn" id="olSearch">検索</button>
        </div>
        <div id="olResults" class="ol-results"></div>
        <p class="mini muted">見つからないときは、下の欄に直接入力して登録できます。</p>
      </details>

      <div class="book-fields">
        <div class="cover-edit">
          <div id="coverPreview"></div>
          <label class="btn btn-sm">📷 画像を選ぶ<input type="file" accept="image/*" id="coverFile" hidden></label>
          <button type="button" class="btn btn-ghost btn-sm" id="coverUrl">URLで指定</button>
          <button type="button" class="btn btn-ghost btn-sm danger" id="coverClear">画像を外す</button>
        </div>
        <div class="book-main-fields">
          <label>タイトル <input name="title" required value="${esc(b.title || '')}" placeholder="e.g. Wonder" autocomplete="off"></label>
          <label>著者 <input name="author" value="${esc(b.author || '')}" placeholder="e.g. R. J. Palacio"></label>
        </div>
      </div>
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
        <label>読み始め
          <span class="date-field"><input type="date" name="startDate" value="${esc(b.startDate || '')}"><button type="button" class="btn btn-ghost btn-sm" data-clear="startDate">クリア</button></span>
        </label>
        <label>読了日
          <span class="date-field"><input type="date" name="finishDate" value="${esc(b.finishDate || '')}"><button type="button" class="btn btn-ghost btn-sm" data-clear="finishDate">クリア</button></span>
        </label>
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
      const preview = () => {
        const c = form.cover.value;
        $('#coverPreview', dlg).innerHTML = cover({ title: form.title.value || '?', cover: c });
        $('#coverClear', dlg).hidden = !c;
      };
      preview();
      form.title.addEventListener('input', () => { if (!form.cover.value) preview(); });
      form.status.onchange = () => {
        if (form.status.value === 'finished' && !form.finishDate.value) form.finishDate.value = today();
        // A book still to read has no reading dates yet.
        if (form.status.value === 'want') form.startDate.value = form.finishDate.value = '';
      };
      // Date inputs can't be emptied on some phones (iPhone), so each has a clear button.
      $$('[data-clear]', dlg).forEach((btn) => (btn.onclick = () => { form[btn.dataset.clear].value = ''; }));

      const search = () => searchBooks($('#olField', dlg).value, $('#olQuery', dlg).value, $('#olResults', dlg), (d) => {
        form.title.value = d.title;
        form.author.value = d.author;
        if (d.cover) form.cover.value = d.cover;
        preview();
      });
      $('#olSearch', dlg).onclick = search;
      $('#olQuery', dlg).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); search(); }
      });
      if (!book) setTimeout(() => $('#olQuery', dlg).focus(), 50);

      $('#coverFile', dlg).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          form.cover.value = await shrinkImage(file);
          preview();
        } catch {
          toast('この画像は読み込めませんでした', 'error');
        }
        e.target.value = '';
      };
      $('#coverUrl', dlg).onclick = () => {
        const url = prompt('表紙画像のURLを入力してください（https://〜）', form.cover.value.startsWith('http') ? form.cover.value : '');
        if (url === null) return;
        if (url && !/^https:\/\//.test(url.trim())) { toast('https:// で始まるURLを入力してください', 'error'); return; }
        form.cover.value = url.trim();
        preview();
      };
      $('#coverClear', dlg).onclick = () => { form.cover.value = ''; preview(); };
    },
    onSubmit: (fd) => {
      const v = Object.fromEntries(fd);
      v.title = v.title.trim();
      v.author = v.author.trim();
      v.rating = +v.rating;
      if (v.status === 'finished' && !v.finishDate) v.finishDate = today();
      if (book) updateBook(book.id, v);
      else addBook(v);
      done?.();
    },
  });
}

// Resize an uploaded cover to a small JPEG data URL so it fits in localStorage.
function shrinkImage(file, maxW = 300, maxH = 450) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

// Book search. English titles come from Open Library; queries with Japanese text also
// search the National Diet Library (国立国会図書館サーチ), with covers found by ISBN.
const JA = /[぀-ヿ㐀-鿿]/;

async function searchBooks(field, query, box, onPick) {
  const q = query.trim();
  if (!q) return;
  box.innerHTML = `<p class="mini muted">検索中…</p>`;
  const japanese = JA.test(q);
  const [ndl, ol] = await Promise.all([
    japanese ? searchNDL(field, q).catch(() => null) : [],
    searchOpenLibrary(field, q).catch(() => null),
  ]);
  if (ndl === null && ol === null) {
    box.innerHTML = `<p class="mini muted">検索できませんでした（オフライン？）。下の欄に直接入力して登録できます。</p>`;
    return;
  }
  const docs = [...(ndl || []), ...(ol || [])].slice(0, 20);
  if (!docs.length) {
    box.innerHTML = `<p class="mini muted">見つかりませんでした。言葉を変えるか、下の欄に直接入力してください。</p>`;
    return;
  }
  box.innerHTML = docs.map((d, i) => `
    <button type="button" class="ol-item" data-i="${i}">
      ${d.thumb ? `<img src="${esc(d.thumb)}" alt="" loading="lazy">` : '<span class="ol-noimg">No image</span>'}
      <span><strong>${esc(d.title)}</strong><br><small>${esc(d.author)} ${d.year ? `(${esc(d.year)})` : ''}${d.publisher ? ` ・ ${esc(d.publisher)}` : ''}</small></span>
    </button>`).join('');
  $$('.ol-item', box).forEach((btn) => (btn.onclick = () => {
    onPick(docs[+btn.dataset.i]);
    $$('.ol-item', box).forEach((x) => x.classList.toggle('picked', x === btn));
  }));
}

async function searchOpenLibrary(field, q) {
  const url = `https://openlibrary.org/search.json?${field}=${encodeURIComponent(q)}&limit=12&fields=key,title,author_name,cover_i,first_publish_year`;
  const j = await (await fetch(url)).json();
  // Books with a cover first, keeping Open Library's relevance order otherwise.
  return (j.docs || []).map((d, i) => [d, i]).sort((x, y) => (!x[0].cover_i - !y[0].cover_i) || x[1] - y[1]).map(([d]) => ({
    title: d.title,
    author: (d.author_name || []).slice(0, 2).join(', '),
    year: d.first_publish_year || '',
    thumb: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : '',
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
  }));
}

// 国立国会図書館サーチ OpenSearch (RSS). Its order is not by relevance, so keep books from
// Japanese publishers, merge editions of the same title, and put exact title matches first.
// "タイトル・著者" searches titles and authors (not full text, which brings in unrelated books).
async function searchNDL(field, q) {
  const params = field === 'title' ? ['title'] : field === 'author' ? ['creator'] : ['title', 'creator'];
  const feeds = await Promise.all(params.map((p) =>
    fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?${p}=${encodeURIComponent(q)}&cnt=80&mediatype=books`).then((r) => r.text())));
  const DC = 'http://purl.org/dc/elements/1.1/';
  const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
  const norm = (s) => s.replace(/[\s　・:：「」『』〈〉<>]/g, '').toLowerCase();
  const nq = norm(q);
  const byTitle = new Map();
  for (const text of feeds) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    for (const item of xml.getElementsByTagName('item')) {
      const title = (item.getElementsByTagNameNS(DC, 'title')[0]?.textContent || '').trim();
      if (!title) continue;
      const isbn = [...item.getElementsByTagNameNS(DC, 'identifier')]
        .filter((e) => /ISBN/.test(e.getAttributeNS(XSI, 'type') || ''))
        .map((e) => e.textContent.replace(/[^0-9X]/gi, ''))[0] || '';
      // Japanese books only (ISBN 978-4… / 4…): drops translations, DVDs and CDs.
      if (!(isbn.length === 13 ? isbn.startsWith('9784') : isbn.length === 10 && isbn.startsWith('4'))) continue;
      const creators = [...item.getElementsByTagNameNS(DC, 'creator')].map((e) => personName(e.textContent)).filter(Boolean);
      const issued = item.getElementsByTagNameNS('http://purl.org/dc/terms/', 'issued')[0]?.textContent || '';
      const nt = norm(title);
      const book = {
        title, isbn,
        author: creators.slice(0, 2).join(', '),
        year: (issued.match(/\d{4}/) || [''])[0],
        publisher: item.getElementsByTagNameNS(DC, 'publisher')[0]?.textContent || '',
        rank: nt === nq ? 0 : nt.startsWith(nq) ? 1 : nt.includes(nq) ? 2 : 3,
      };
      if (field === 'author' || (field === 'q' && book.rank === 3 && norm(book.author).includes(nq))) book.rank = Math.min(book.rank, 1);
      // One entry per title + author; keep the newest edition that names its author.
      const key = `${nt}|${norm(creators[0] || '')}`;
      const prev = byTitle.get(key);
      if (!prev || book.year > prev.year) byTitle.set(key, book);
    }
  }
  const authored = new Set([...byTitle.values()].filter((b) => b.author).map((b) => norm(b.title)));
  const books = [...byTitle.values()].filter((b) => b.author || (b.rank === 0 && !authored.has(norm(b.title))));
  books.sort((a, b) => a.rank - b.rank || String(b.year).localeCompare(String(a.year)));
  const top = books.slice(0, 12);
  await addJapaneseCovers(top);
  // Ones with a cover first within the same rank.
  return top.sort((a, b) => a.rank - b.rank || (!a.cover - !b.cover));
}

// "村上, 春樹, 1949-" → "村上春樹"; "Carver, Raymond, 1938-1988" → "Raymond Carver"
function personName(s) {
  const parts = s.split(',').map((x) => x.trim()).filter((x) => x && !/^\d{4}-?(\d{4})?$/.test(x));
  if (!parts.length) return '';
  return JA.test(parts[0]) ? parts.slice(0, 2).join('') : parts.slice(0, 2).reverse().join(' ');
}

// Covers for Japanese books by ISBN. The relay tries openBD, 版元ドットコム and Google
// Books (it can tell Google's grey "no image" picture from a real cover; the browser
// can't). Without the relay, openBD and 版元ドットコム are tried from here.
async function addJapaneseCovers(books) {
  books.forEach((b) => (b.isbn = b.isbn.length === 10 ? isbn10to13(b.isbn) : b.isbn));
  const missing = [];
  await Promise.all(books.map(async (b) => {
    const url = await cacheCover(`isbn:${b.isbn}`);
    if (url) { b.cover = `isbn:${b.isbn}`; b.thumb = url; } else missing.push(b);
  }));
  if (!missing.length) return;
  const fromOpenBD = new Map();
  try {
    const j = await (await fetch(`https://api.openbd.jp/v1/get?isbn=${missing.map((b) => b.isbn).join(',')}`)).json();
    for (const r of j || []) if (r?.summary?.cover) fromOpenBD.set(r.summary.isbn, r.summary.cover);
  } catch { /* covers are optional */ }
  await Promise.all(missing.map(async (b) => {
    for (const url of [fromOpenBD.get(b.isbn), `https://www.hanmoto.com/bd/img/${b.isbn}.jpg`]) {
      if (url && (await imageLoads(url))) { b.thumb = b.cover = url; return; }
    }
  }));
}

function imageLoads(src, ms = 4000) {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), ms);
    // 版元ドットコム answers a missing cover with a tiny picture: not a cover.
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth >= 20); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = src;
  });
}

function isbn10to13(isbn10) {
  const core = `978${isbn10.slice(0, 9)}`;
  const sum = [...core].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
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
        <h2>🎙️ トーク履歴 <small class="muted">${talks.length}</small>${talks.length ? ` <a class="mini hist-link" href="#/history/${b.id}">フィードバックやディスプレイも見る →</a>` : ''}</h2>
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
