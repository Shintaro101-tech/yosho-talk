// Talk history (#/history, or #/history/<bookId> for one book): every talk, with its
// script, what was on the display, and the after-talk feedback.

import { $, $$, esc, formatDate, formatDuration, toast } from './util.js';
import { data, getBook, addVocab, deleteTalk, hasVocab } from './store.js';
import { AVATARS, avatarHTML } from './avatars.js';
import { bookCover } from './books.js';
import { openAskBox, closeAskBox } from './askbox.js';
import { canUseAI } from './cloud.js';

const NO_BOOK = 'none';

export function renderHistory(el, [bookParam]) {
  let bookFilter;
  bookFilter = bookParam && (bookParam === NO_BOOK || getBook(bookParam)) ? bookParam : '';

  const draw = () => {
    const talks = data.talks.filter((t) => !bookFilter || (bookFilter === NO_BOOK ? !t.bookId || !getBook(t.bookId) : t.bookId === bookFilter));
    const totalMin = Math.round(talks.reduce((n, t) => n + (t.durationSec || 0), 0) / 60);
    const bookIds = [...new Set(data.talks.map((t) => t.bookId).filter((id) => id && getBook(id)))];
    const hasNoBook = data.talks.some((t) => !t.bookId || !getBook(t.bookId));

    // Group by month, newest first (talks are stored newest first).
    const months = [];
    for (const t of talks) {
      const m = (t.date || '').slice(0, 7);
      if (months.at(-1)?.month !== m) months.push({ month: m, talks: [] });
      months.at(-1).talks.push(t);
    }

    el.innerHTML = `
      <section class="hero">
        <div>
          <h1>Talk History</h1>
          <p class="muted"><strong>${talks.length}</strong> 回 ・ 合計 <strong>${totalMin}</strong> 分</p>
        </div>
        <a class="btn btn-primary" href="#/talk">🎙️ トークする</a>
      </section>
      ${data.talks.length ? `
      <div class="toolbar">
        <select id="hb" aria-label="本で絞り込む">
          <option value="">すべての本</option>
          ${bookIds.map((id) => `<option value="${id}" ${id === bookFilter ? 'selected' : ''}>${esc(getBook(id).title)}</option>`).join('')}
          ${hasNoBook ? `<option value="${NO_BOOK}" ${bookFilter === NO_BOOK ? 'selected' : ''}>本を指定しないトーク</option>` : ''}
        </select>
      </div>` : ''}
      ${talks.length ? months.map((g) => `
        <h2 class="hist-month">${monthLabel(g.month)}</h2>
        <div class="hist-list">${g.talks.map(talkItem).join('')}</div>`).join('')
        : `<div class="empty-state small"><h2>${data.talks.length ? 'この条件のトークはありません' : 'まだトークしていません'}</h2>
           <p>トークを終えると、ここに会話のスクリプト・ディスプレイ・フィードバックが残ります。</p></div>`}`;

    $('#hb', el)?.addEventListener('change', (e) => { bookFilter = e.target.value; draw(); });
    // Fill a talk's details only when it is opened.
    $$('.hist-item', el).forEach((d) => d.addEventListener('toggle', () => {
      if (d.open && !d.dataset.filled) fillDetails(d, data.talks.find((t) => t.id === d.dataset.id), draw);
    }));
  };
  draw();
  return closeAskBox;
}

function monthLabel(m) {
  const [y, mo] = m.split('-');
  return y && mo ? `${y}年${Number(mo)}月` : '日付なし';
}

function talkItem(t) {
  const book = t.bookId ? getBook(t.bookId) : null;
  const avKey = Object.keys(AVATARS).find((k) => AVATARS[k].name === t.avatarName);
  const fb = t.feedback?.polished?.length || t.feedback?.corrections?.length;
  return `
    <details class="hist-item card" data-id="${t.id}">
      <summary>
        ${book ? bookCover(book, 'sm') : '<span class="book-none">📚</span>'}
        <span class="hist-main">
          <b class="hist-title">${esc(book?.title || t.bookTitle || '本を指定しないトーク')}</b>
          <span class="hist-meta">${formatDate(t.date)} ・ ${esc(t.modeLabel || '')} ・ ${formatDuration(t.durationSec || 0)}${t.level ? ` ・ ${esc(t.level)}` : ''}</span>
          <span class="hist-tags">
            ${(t.display || []).length ? `<span>📺 ${(t.display || []).length}</span>` : ''}
            ${(t.savedTerms || []).length ? `<span>🗂️ ${(t.savedTerms || []).length}</span>` : ''}
            ${fb ? '<span>✨ フィードバック</span>' : ''}
          </span>
        </span>
        ${avKey ? `<span class="hist-av" title="${esc(t.avatarName)}">${avatarHTML(avKey, { framing: 'face' })}</span>` : ''}
      </summary>
      <div class="hist-body"></div>
    </details>`;
}

function fillDetails(d, t, redraw) {
  if (!t) return;
  d.dataset.filled = '1';
  const fb = t.feedback || {};
  const polished = fb.polished || [];
  const body = $('.hist-body', d);
  body.innerHTML = `
    ${t.practiced?.length ? `<p class="mini"><b>練習したフレーズ：</b>${t.practiced.map(esc).join(' / ')}</p>` : ''}

    <h3>✨ フィードバック</h3>
    ${polished.length || fb.feedback_ja || fb.corrections?.length ? `
      ${fb.feedback_ja ? `<div class="feedback"><p>${esc(fb.feedback_ja)}</p></div>` : ''}
      ${polished.length ? `
      <ul class="polished-list">
        ${polished.map((p, i) => `
          <li>
            ${p.you_said ? `<p class="you-said"><small>あなた</small><s>${esc(p.you_said)}</s></p>` : ''}
            <p class="polished"><small>Polished</small><span>${esc(p.polished)}</span></p>
            <p class="key-phrase"><b>${esc(p.key_phrase)}</b> — ${esc(p.meaning_ja)}</p>
            <p class="mini muted">${esc(p.why_ja)}</p>
            <span class="row">
              ${hasVocab(p.key_phrase)
                ? '<button class="btn btn-sm" disabled>✓ 単語帳にあります</button>'
                : `<button class="btn btn-sm" data-add="${i}">＋単語帳</button>`}
              ${canUseAI() ? `<button class="btn btn-sm btn-ghost" data-ask="${i}">💬 質問する</button>` : ''}
            </span>
          </li>`).join('')}
      </ul>` : ''}
      ${(fb.corrections || []).length ? `
      <ul class="corrections">
        ${fb.corrections.map((c) => `<li><p><s>${esc(c.you_said)}</s></p><p>→ <strong>${esc(c.better)}</strong></p><p class="mini muted">${esc(c.why_ja)}</p></li>`).join('')}
      </ul>` : ''}`
      : '<p class="mini muted">このトークではフィードバックを受け取っていません。</p>'}

    <h3>📺 ディスプレイ</h3>
    ${(t.display || []).length ? `
    <div class="display hist-display">
      <div class="display-cards">
        ${t.display.map((c) => `
          <section class="dcard dcard-${esc(c.style || 'note')}">
            <h3>${esc(c.heading || '')}</h3>
            ${c.style === 'questions' ? '<ol>' : '<ul>'}
              ${(c.items || []).map((it) => `<li><span class="d-text">${esc(it.text)}</span>${it.note ? `<span class="d-note">${esc(it.note)}</span>` : ''}</li>`).join('')}
            ${c.style === 'questions' ? '</ol>' : '</ul>'}
          </section>`).join('')}
      </div>
    </div>` : '<p class="mini muted">ディスプレイには何も表示されませんでした。</p>'}

    ${(t.savedTerms || []).length ? `
    <h3>🗂️ 保存した語</h3>
    <ul class="chips">${t.savedTerms.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}

    <h3>📝 スクリプト</h3>
    ${(t.turns || []).length ? `
    <div class="transcript hist-script">
      ${t.turns.map((x) => `<p class="line ${x.role}"><b>${x.role === 'user' ? esc(data.settings.userName || 'You') : esc(t.avatarName || 'Partner')}</b>${esc(x.text.trim())}</p>`).join('')}
    </div>` : '<p class="mini muted">スクリプトはありません。</p>'}

    <div class="hist-actions">
      ${t.bookId && getBook(t.bookId) ? `<a class="btn btn-sm btn-ghost" href="#/book/${t.bookId}">📖 本のページ</a>` : ''}
      <button class="btn btn-sm btn-ghost danger" data-del>この記録を削除</button>
    </div>`;

  $$('[data-add]', body).forEach((b) => (b.onclick = () => {
    const p = polished[+b.dataset.add];
    addVocab({ term: p.key_phrase, meaning: p.meaning_ja, example: p.polished, note: p.why_ja, bookId: t.bookId || null, source: 'feedback' });
    b.disabled = true;
    b.textContent = '✓ 追加しました';
  }));
  $$('[data-ask]', body).forEach((b) => (b.onclick = () => {
    const ask = openAskBox({ phrases: polished, level: t.level, bookTitle: getBook(t.bookId)?.title || t.bookTitle || '' });
    ask.prefill(`「${polished[+b.dataset.ask].key_phrase}」について：`);
  }));
  $('[data-del]', body).onclick = () => {
    if (!confirm('このトークの記録を削除しますか？（単語帳の単語は残ります）')) return;
    deleteTalk(t.id);
    toast('削除しました');
    redraw();
  };
}
