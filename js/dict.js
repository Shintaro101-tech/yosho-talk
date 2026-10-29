// Dictionary (#/dict, or #/dict/<word>): look up an English word or phrase and get a
// learner's-dictionary entry in Japanese, with US/UK pronunciation symbols and audio,
// and add it to the word book in one tap.
// The entry is written by the backend model through the relay; real recordings of the
// pronunciation come from Free Dictionary API (Wiktionary), else the browser's voice.
// Each entry has emoji, and photos from Pixabay (searched by the relay) when it's set up.

import { $, $$, esc, toast } from './util.js';
import { data, addVocab, getBook, hasVocab } from './store.js';
import { ensurePasscode } from './api.js';
import { searchImages, picturesHTML } from './images.js';
import { responsesJSON } from './live.js';
import { bookCover } from './books.js';
import { openAskBox, closeAskBox } from './askbox.js';
import { speak, findRecordings } from './speech.js';

const CACHE_KEY = 'yoshotalk:dict';
const CACHE_MAX = 40;
let bookChoice = ''; // the book new words are tagged with
let bookPicked = false; // chosen by the learner (kept while the app is open)

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'emoji', 'image_query', 'headword', 'lemma_note_ja', 'ipa_us', 'ipa_uk', 'cefr', 'forms_ja', 'senses', 'context_ja', 'collocations', 'synonyms', 'usage_ja', 'candidates'],
  properties: {
    found: { type: 'boolean' },
    emoji: { type: 'string' },
    image_query: { type: 'string' },
    headword: { type: 'string' },
    lemma_note_ja: { type: 'string' },
    ipa_us: { type: 'string' },
    ipa_uk: { type: 'string' },
    cefr: { type: 'string' },
    forms_ja: { type: 'string' },
    senses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pos_ja', 'meaning_ja', 'definition_en', 'example_en', 'example_ja'],
        properties: {
          pos_ja: { type: 'string' },
          meaning_ja: { type: 'string' },
          definition_en: { type: 'string' },
          example_en: { type: 'string' },
          example_ja: { type: 'string' },
        },
      },
    },
    context_ja: { type: 'string' },
    collocations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'meaning_ja'],
        properties: { phrase: { type: 'string' }, meaning_ja: { type: 'string' } },
      },
    },
    synonyms: { type: 'array', items: { type: 'string' } },
    usage_ja: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['word', 'meaning_ja'],
        properties: { word: { type: 'string' }, meaning_ja: { type: 'string' } },
      },
    },
  },
};

const INSTRUCTIONS = `You are an English-Japanese learner's dictionary (like a good 英和辞典) for a Japanese reader of English novels.
Given an English word or phrase (phrasal verbs and idioms too), write its entry:
- found: true if it is real English. headword: the dictionary form, correctly spelled (for "ran" → "run"; keep phrases as phrases).
- lemma_note_ja: when the query is an inflected form or misspelling, say so briefly in Japanese (e.g. "ran は run の過去形"); else "".
- ipa_us / ipa_uk: the pronunciation in the broad IPA style of learner's dictionaries (Oxford / Cambridge), with stress marks, between slashes, e.g. /ˌserənˈdɪpəti/. For a phrase, give the whole phrase.
- cefr: its CEFR level (A1–C2), or "" if unsure.
- forms_ja: irregular or useful forms in Japanese (e.g. "過去形 ran／過去分詞 run", "複数形 mice"), else "".
- senses: the main senses, most common first (1–5). pos_ja is the part of speech in Japanese (名詞, 動詞, 形容詞, 句動詞, イディオム…). meaning_ja: concise Japanese equivalents like a 英和辞典. definition_en: a short, simple English definition. example_en: a natural example sentence, ideally the kind found in novels; example_ja: its Japanese translation.
- context_ja: if a sentence where the reader met the word is given, explain in Japanese which sense it is and what it means there; else "".
- collocations: 0–5 common collocations or set phrases with Japanese meanings.
- synonyms: 0–5 near synonyms.
- emoji: 1–3 emoji that picture the main sense (serendipity → "🍀✨"), or "" if none fits.
- image_query: 1–3 English words to search a photo library for a picture of the main sense — what the picture should show, not always the word itself (serendipity → "happy coincidence", melancholy → "sad person window rain", run → "man running"). "" for words that can't be pictured (of, whether, the).
- usage_ja: 1–2 sentences in Japanese on nuance, register (formal / informal / literary) or common mistakes; "" if nothing useful.
- If the query is Japanese, or not English, or too misspelled to tell: found false, empty entry fields, and candidates = up to 5 English words or phrases it may mean, each with meaning_ja. Otherwise candidates = [].`;

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || { recent: [], entries: {} }; } catch { return { recent: [], entries: {} }; }
}
function saveCache(c) {
  c.recent = c.recent.slice(0, CACHE_MAX);
  for (const k of Object.keys(c.entries)) if (!c.recent.includes(k)) delete c.entries[k];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* full: entries just aren't kept */ }
}
const keyOf = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export function renderDict(el, [param]) {
  const cache = loadCache();
  let entry = null;
  let audio = {}; // { us, uk, au }: recording URLs
  let images = []; // [{ src, page, user }] from Pixabay
  let busy = false;
  if (!bookPicked) bookChoice = data.books.find((b) => b.status === 'reading')?.id || '';

  el.innerHTML = `
    <section class="hero">
      <div>
        <h1>Dictionary</h1>
        <p class="muted">本で出会った単語・フレーズを調べて、そのまま単語帳へ。</p>
      </div>
    </section>
    <form class="dict-search card">
      <div class="search-row">
        <input type="search" name="q" placeholder="例: serendipity / give in / 諦める" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="調べる単語">
        <button class="btn btn-primary">調べる</button>
      </div>
      <details class="dict-ctx">
        <summary>見かけた文も入れる（任意・その文での意味がわかります）</summary>
        <textarea name="ctx" rows="2" placeholder="例: It was pure serendipity that we met on the train."></textarea>
      </details>
    </form>
    <div id="dictOut"></div>
    <div id="dictRecent"></div>`;

  const form = $('.dict-search', el);
  const out = $('#dictOut', el);

  const drawRecent = () => {
    const box = $('#dictRecent', el);
    const recent = cache.recent.filter((k) => cache.entries[k]?.found);
    box.innerHTML = recent.length ? `
      <div class="dict-recent-head">
        <h2 class="dict-recent-title">最近調べた語</h2>
        <button class="link-btn" data-clear>すべて消す</button>
      </div>
      <ul class="chips dict-recent">${recent.map((k) => `
        <li><button data-look="${esc(cache.entries[k].headword)}">${esc(cache.entries[k].headword)}</button><button class="dict-forget" data-forget="${esc(k)}" aria-label="${esc(cache.entries[k].headword)} を履歴から消す">×</button></li>`).join('')}</ul>` : '';
    $$('[data-look]', box).forEach((b) => (b.onclick = () => lookUp(b.dataset.look)));
    // Removing a word from the history also drops its saved entry (it is looked up again next time).
    $$('[data-forget]', box).forEach((b) => (b.onclick = () => {
      cache.recent = cache.recent.filter((k) => k !== b.dataset.forget);
      saveCache(cache);
      drawRecent();
    }));
    $('[data-clear]', box)?.addEventListener('click', () => {
      if (!confirm('最近調べた語の履歴をすべて消しますか？（単語帳の単語は消えません）')) return;
      cache.recent = [];
      saveCache(cache);
      drawRecent();
    });
  };

  async function lookUp(q, ctx = '') {
    q = q.trim();
    if (!q || busy) return;
    form.q.value = q;
    if (location.hash !== `#/dict/${encodeURIComponent(q)}`) history.replaceState(null, '', `#/dict/${encodeURIComponent(q)}`);
    const key = keyOf(q);
    const cached = !ctx && cache.entries[key];
    if (!cached && !(await ensurePasscode())) return;
    busy = true;
    form.querySelector('button').disabled = true;
    out.innerHTML = `<div class="card dict-entry dict-loading"><span class="ask-typing"><i></i><i></i><i></i></span> 「${esc(q)}」を調べています…</div>`;
    try {
      entry = cached || await responsesJSON({
        instructions: INSTRUCTIONS,
        input: `Word or phrase: ${q}${ctx ? `\nSentence where the reader met it: ${ctx}` : ''}`,
        schemaName: 'dictionary_entry',
        kind: 'dict',
        schema: SCHEMA,
      });
      if (!ctx) {
        cache.entries[key] = entry;
        if (entry.found) cache.entries[keyOf(entry.headword)] = entry;
        cache.recent = [keyOf(entry.found ? entry.headword : q), ...cache.recent.filter((k) => k !== key && k !== keyOf(entry.headword))];
        saveCache(cache);
      }
      audio = {};
      images = [];
      drawEntry(q);
      drawRecent();
      if (entry.found) {
        const shown = entry;
        findRecordings(entry.headword).then((a) => { if (entry === shown) { audio = a; drawAudioButtons(); } });
        searchImages(entry.image_query).then((list) => { if (entry === shown) { images = list; drawPictures(); } });
      }
    } catch (err) {
      out.innerHTML = `<div class="card dict-entry"><p>調べられませんでした：${esc(err.message)}</p></div>`;
    }
    busy = false;
    form.querySelector('button').disabled = false;
  }

  function drawEntry(q) {
    const e = entry;
    if (!e.found) {
      out.innerHTML = `
        <div class="card dict-entry">
          <p>「${esc(q)}」は見つかりませんでした。${e.candidates.length ? 'もしかして：' : 'つづりを確かめてください。'}</p>
          ${e.candidates.length ? `<ul class="dict-cands">${e.candidates.map((c) => `<li><button class="link-btn" data-look="${esc(c.word)}">${esc(c.word)}</button> <span class="muted">${esc(c.meaning_ja)}</span></li>`).join('')}</ul>` : ''}
        </div>`;
      $$('[data-look]', out).forEach((b) => (b.onclick = () => lookUp(b.dataset.look)));
      return;
    }
    const saved = hasVocab(e.headword);
    out.innerHTML = `
      <article class="card dict-entry">
        <header class="dict-head">
          <h2>${esc(e.headword)}</h2>
          ${e.cefr ? `<span class="badge dict-cefr">${esc(e.cefr)}</span>` : ''}
        </header>
        ${e.lemma_note_ja ? `<p class="mini muted">${esc(e.lemma_note_ja)}</p>` : ''}
        <div class="dict-pron" id="dictPron"></div>
        <div class="dict-pics" id="dictPics"></div>
        ${e.forms_ja ? `<p class="mini dict-forms">${esc(e.forms_ja)}</p>` : ''}
        ${e.context_ja ? `<div class="dict-context"><b>この文では</b><p>${esc(e.context_ja)}</p></div>` : ''}

        <ol class="dict-senses">
          ${e.senses.map((s) => `
            <li>
              <p class="dict-mean"><span class="dict-pos">${esc(s.pos_ja)}</span>${esc(s.meaning_ja)}</p>
              <p class="mini muted">${esc(s.definition_en)}</p>
              ${s.example_en ? `<p class="example">${esc(s.example_en)} <button class="icon-btn sm" data-say="${esc(s.example_en)}" aria-label="例文を聞く">🔊</button></p>
              <p class="mini dict-ex-ja">${esc(s.example_ja)}</p>` : ''}
            </li>`).join('')}
        </ol>

        ${e.collocations.length ? `
        <h3 class="dict-sub">よく使う組み合わせ</h3>
        <ul class="dict-colls">
          ${e.collocations.map((c, i) => `
            <li><b>${esc(c.phrase)}</b> <span class="muted">${esc(c.meaning_ja)}</span>
              ${hasVocab(c.phrase)
                ? '<button class="btn btn-sm btn-ghost" disabled>✓ 単語帳にあります</button>'
                : `<button class="btn btn-sm btn-ghost" data-addc="${i}">＋単語帳</button>`}</li>`).join('')}
        </ul>` : ''}
        ${e.synonyms.length ? `<p class="mini"><b>類義語：</b>${e.synonyms.map((w) => `<button class="link-btn" data-look="${esc(w)}">${esc(w)}</button>`).join(' ・ ')}</p>` : ''}
        ${e.usage_ja ? `<p class="mini dict-usage">💡 ${esc(e.usage_ja)}</p>` : ''}

        <footer class="dict-add">
          <label class="dict-book">${bookChoice && getBook(bookChoice) ? bookCover(getBook(bookChoice), 'xs') : ''}
            <select id="dictBook" aria-label="この語が出てきた本">
              <option value="">本を指定しない</option>
              ${data.books.map((b) => `<option value="${b.id}" ${b.id === bookChoice ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
            </select>
          </label>
          <button class="btn btn-primary" id="dictAdd" ${saved ? 'disabled' : ''}>${saved ? '✓ 単語帳にあります' : '＋ 単語帳に追加'}</button>
        </footer>
      </article>`;
    drawAudioButtons();
    drawPictures();

    $$('[data-say]', out).forEach((b) => (b.onclick = () => say(b.dataset.say, 'us')));
    $$('[data-look]', out).forEach((b) => (b.onclick = () => lookUp(b.dataset.look)));
    $('#dictBook', out).onchange = (ev) => {
      bookChoice = ev.target.value;
      bookPicked = true;
      const book = getBook(bookChoice);
      const label = ev.target.parentElement;
      label.querySelector('.cover')?.remove();
      if (book) label.insertAdjacentHTML('afterbegin', bookCover(book, 'xs'));
    };
    $('#dictAdd', out).onclick = (ev) => {
      const s = e.senses[0] || {};
      addVocab({
        term: e.headword,
        meaning: e.senses.map((x) => x.meaning_ja).slice(0, 3).join('；'),
        example: s.example_en || '',
        note: [e.ipa_us && `${e.ipa_us}`, s.pos_ja, e.usage_ja].filter(Boolean).join(' ・ '),
        emoji: e.emoji,
        imageQuery: e.image_query,
        bookId: bookChoice || null,
        source: 'dictionary',
      });
      ev.target.disabled = true;
      ev.target.textContent = '✓ 追加しました';
      toast(`「${e.headword}」を単語帳に追加しました`, 'success');
    };
    $$('[data-addc]', out).forEach((b) => (b.onclick = () => {
      const c = e.collocations[+b.dataset.addc];
      addVocab({ term: c.phrase, meaning: c.meaning_ja, note: `${e.headword} の組み合わせ`, bookId: bookChoice || null, source: 'dictionary' });
      b.disabled = true;
      b.textContent = '✓ 追加';
    }));
  }

  // Emoji, then up to three photos.
  function drawPictures() {
    const box = $('#dictPics', out);
    if (!box || !entry?.found) return;
    box.hidden = !entry.emoji && !images.length;
    box.innerHTML = picturesHTML(images, entry.emoji);
  }

  // Pronunciation: IPA with a play button for each accent (recording if there is one).
  function drawAudioButtons() {
    const box = $('#dictPron', out);
    if (!box || !entry?.found) return;
    const row = (accent, label, ipa) => `
      <span class="dict-ipa">
        <button class="btn btn-sm dict-play" data-play="${accent}" aria-label="${label}の発音を聞く">🔊 ${label}</button>
        <span class="ipa">${esc(ipa)}</span>
      </span>`;
    box.innerHTML = row('us', '米', entry.ipa_us) + row('uk', '英', entry.ipa_uk)
      + `<button class="btn btn-sm btn-ghost dict-slow" data-play="slow" aria-label="ゆっくり聞く">🐢 ゆっくり</button>`;
    $$('[data-play]', box).forEach((b) => (b.onclick = () => {
      const a = b.dataset.play;
      if (a === 'slow') return say(entry.headword, 'us', 0.6);
      const rec = audio[a] || (a === 'uk' ? audio.au : null);
      if (rec) new Audio(rec).play().catch(() => say(entry.headword, a));
      else say(entry.headword, a);
    }));
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    lookUp(form.q.value, form.ctx.value.trim());
  };
  drawRecent();
  // Floating chat for questions; it knows the entry on screen and the recent look-ups.
  openAskBox({
    source: 'dict',
    level: data.settings.level,
    words: () => [entry, ...cache.recent.map((k) => cache.entries[k])]
      .filter((e, i, all) => e?.found && all.indexOf(e) === i).slice(0, 20)
      .map((e) => ({ term: e.headword, meaning: e.senses.map((x) => x.meaning_ja).slice(0, 2).join('；'), example: e.senses[0]?.example_en || '' })),
  });
  if (param) lookUp(param);
  else setTimeout(() => form.q.focus(), 50);
  return closeAskBox;
}

// The device's most natural voice, in the chosen accent (see speech.js).
const say = (text, accent = 'us', rate = 0.9) => speak(text, { accent, rate });
