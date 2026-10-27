import { $, $$, esc, formatDuration, openDialog, toast } from './util.js';
import { data, save, getBook, addVocab, addTalk, addXP } from './store.js';
import { ensurePasscode } from './api.js';
import { AVATARS, avatarSVG } from './avatars.js';
import { LiveSession, responsesJSON } from './live.js';

export const MODES = {
  impressions: {
    label: '感想を話す',
    desc: '読んだ本（一部でも全部でも）の感想を話します',
    en: `IMPRESSIONS. Help the learner talk about their impressions: how the book made them feel, favourite scenes, characters they liked or disliked, surprising moments, and whether they would recommend it. Ask one question at a time and dig deeper into their answers.`,
  },
  discussion: {
    label: 'ディスカッション',
    desc: '読んだ内容をもとに、アバターが考えた問いについて話し合います',
    en: `DISCUSSION. Based on the learner's summary, create 3 open-ended discussion questions suited to their level (about choices characters made, themes, and connections to real life). Put all 3 questions on the display first, then discuss them one at a time. Share your own opinion briefly too, and ask "why?" to help them develop their ideas.`,
  },
  casual: {
    label: 'おしゃべり',
    desc: '本の話をきっかけに、気軽に雑談します',
    en: `CASUAL CHAT. Have a relaxed, friendly chat. Start from the book, then let the topic drift naturally (reading habits, daily life, hobbies, anything the learner brings up). Keep it light and fun.`,
  },
};

// CEFR levels, with approximate Eiken equivalents (MEXT correspondence table).
export const LEVELS = {
  A2: { label: 'Elementary', eiken: '英検準2級程度', en: 'A2 (elementary): very short, simple sentences and common words; speak slowly and clearly' },
  B1: { label: 'Intermediate', eiken: '英検2級程度', en: 'B1 (intermediate): clear everyday language; explain any less common word' },
  B2: { label: 'Upper-intermediate', eiken: '英検準1級程度', en: 'B2 (upper-intermediate): natural speed and some idioms; occasionally explain nuance' },
  C1: { label: 'Advanced', eiken: '英検1級程度', en: 'C1 (advanced): natural, native-like discussion; challenge their ideas' },
  C2: { label: 'Proficiency', eiken: '英検1級以上', en: 'C2 (proficiency): talk exactly as with an educated native speaker, including idioms, subtle nuance and abstract ideas' },
};

let live = null;

function buildInstructions({ book, mode, avatar, level, name }) {
  const a = AVATARS[avatar];
  const bookPart = book
    ? `They chose the book "${book.title}"${book.author ? ` by ${book.author}` : ''}. ${book.status === 'finished'
      ? 'They have finished it.'
      : 'They may not have finished it — never spoil anything beyond what they have read.'}${book.memo ? ` Their own notes (may be Japanese): ${book.memo}` : ''}`
    : 'You do not know yet which book they read — ask them as part of the summary. Never spoil anything beyond what they have read.';
  return `You are ${a.name}, an English conversation partner in "Yosho Talk" (洋書トーク), a learning app linked to the YouTube show "Yosho Radio" (洋書ラジオ), where two English teachers talk about English-language books.
Personality: ${a.persona}.
The learner's name is ${name}. Always call them "${name}" — in your greeting and naturally now and then.
The learner is a Japanese speaker. Level: ${LEVELS[level].en}.
${bookPart}

CONVERSATION FLOW
1. You speak first. Greet ${name} by name, warmly and briefly.
2. Ask ${name} to give you a short summary of what they have read so far (part of the book or all of it is fine)${book ? '' : ', including the title'}. Listen and react to it. If the summary is very short, ask one friendly follow-up question.
3. Then continue with today's theme, building on what they told you in the summary:
${MODES[mode].en}

THE DISPLAY
There is a screen next to you that ${name} can see. Use it to make important language visible. Delegate a request to show something on the display (give the exact text to show) whenever:
- you present discussion questions;
- you introduce, explain or correct a useful word, phrase or expression;
- ${name} asks what a word means, how to say something in English, or how to spell something;
- ${name} asks you to show or write something ("Can you show it on the display?", "Can you write it down?", "Could you put that on the screen?") — show whatever they ask for.
Keep display text short. You can say "I've put it on the display."

HOW TO TALK
- Speak only English, except a few Japanese words if ${name} is really stuck.
- Keep each turn short (1-3 sentences) and usually end with one question. Let ${name} do most of the talking.
- Show real interest; share your own opinion briefly sometimes.
- When ${name} makes a meaningful mistake, recast it naturally ("Oh, you mean ...?") instead of lecturing.
- If ${name} asks you to save or remember a word or phrase, delegate it so it is saved to their word book, then confirm briefly.`;
}

const BACKEND_INSTRUCTIONS = `You are the backend helper for "Yosho Talk", an English book-discussion app for Japanese learners. The voice partner delegates tasks to you. You have two functions:

show_on_display — the learner can see a display screen. Call it whenever you are asked to show, display, write down or put something on the screen. Use the exact content you were given and keep it concise.
  - style "questions": discussion questions (one question per item, no numbering — the app numbers them).
  - style "vocabulary": words or expressions. text = the English expression; note = a short Japanese meaning, optionally followed by " / " and a short English example.
  - style "note": anything else (a correction, a sentence, a list, a spelling). For a correction, text = the better version and note = a short Japanese explanation.

save_vocabulary — call it once per item when the learner wants a word or phrase saved: term in dictionary/base form, a concise natural Japanese meaning, and a short natural English example (ideally connected to the book or conversation).

For factual questions about a book or author, answer briefly and avoid spoilers. Keep any text reply short and plain so it can be spoken aloud.`;

const SAVE_TOOL = {
  type: 'function',
  name: 'save_vocabulary',
  description: "Save an English word or phrase to the learner's personal word book.",
  parameters: {
    type: 'object',
    properties: {
      term: { type: 'string', description: 'The English word or phrase (base form).' },
      meaning_ja: { type: 'string', description: 'Concise Japanese meaning.' },
      example_en: { type: 'string', description: 'One short natural English example sentence.' },
      note_ja: { type: 'string', description: 'Optional short usage note in Japanese.' },
    },
    required: ['term', 'meaning_ja', 'example_en'],
  },
};

const DISPLAY_TOOL = {
  type: 'function',
  name: 'show_on_display',
  description: 'Show text on the display screen the learner can see (discussion questions, words and expressions, corrections, or anything they ask to see written).',
  parameters: {
    type: 'object',
    properties: {
      heading: { type: 'string', description: 'Short heading, e.g. "Discussion Questions", "Useful expression", "Spelling".' },
      style: { type: 'string', enum: ['questions', 'vocabulary', 'note'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Main text.' },
            note: { type: 'string', description: 'Optional smaller text, e.g. Japanese meaning or explanation.' },
          },
          required: ['text'],
        },
      },
    },
    required: ['heading', 'style', 'items'],
  },
};

// Asks for the name the avatar should call the learner (saved in settings).
export function askUserName() {
  return new Promise((resolve) => {
    let saved = false;
    const dlg = openDialog(`
      <form class="form">
        <h2>👋 あなたの呼び名</h2>
        <p class="mini muted">アバターが会話のなかであなたを呼ぶ名前です（例：Shintaro, Shin, Mr. Horikawa）。あとから「設定」で変更できます。</p>
        <input name="name" required maxlength="30" value="${esc(data.settings.userName || '')}" placeholder="Your name" autocomplete="given-name">
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
          <button class="btn btn-primary">保存</button>
        </div>
      </form>`, {
      onOpen: (d) => d.querySelector('input').focus(),
      onSubmit: (fd) => {
        data.settings.userName = String(fd.get('name')).trim();
        save();
        saved = true;
      },
    });
    dlg.addEventListener('close', () => resolve(saved), { once: true });
  });
}

export function renderTalk(el, [bookIdParam]) {
  const s = data.settings;
  const state = {
    bookId: bookIdParam && getBook(bookIdParam) ? bookIdParam : '',
    mode: MODES[s.talkMode] ? s.talkMode : 'impressions',
    avatar: s.avatar,
    level: LEVELS[s.level] ? s.level : 'B1',
    status: 'idle',
    turns: [],
    saved: [],
    shown: [],
    startedAt: 0,
    muted: false,
  };
  let meter = null;
  let timer = null;

  el.innerHTML = `
    <section class="talk">
      <div class="talk-side card" id="setup"></div>
      <div class="talk-main">
        <div class="stage card">
          <div class="avatar-box" id="avatarBox"></div>
          <div class="stage-meta">
            <h2 id="avName"></h2>
            <p class="status-line"><span class="status-dot" id="statusDot"></span><span id="statusText">準備OK</span> <span id="clock" class="clock"></span></p>
            <div class="talk-controls" id="controls"></div>
          </div>
        </div>
        <div class="display" id="display"></div>
        <div id="review"></div>
      </div>
    </section>`;

  const setup = $('#setup', el);
  const displayEl = $('#display', el);

  function drawSetup() {
    const locked = state.status !== 'idle' && state.status !== 'ended';
    const book = getBook(state.bookId);
    const dis = locked ? 'disabled' : '';
    setup.innerHTML = `
      <p class="mini muted hello">${s.userName ? `👋 ${esc(s.userName)} さん` : '呼び名が未登録です'} <button class="link-btn" id="editName" ${dis}>${s.userName ? '変更' : '登録'}</button></p>
      ${book ? `<p class="talk-book">📖 <b>${esc(book.title)}</b> <button class="link-btn" id="unlinkBook" ${dis} title="本の指定を外す">×</button></p>` : ''}

      <h3 class="pick-title">キャラクター</h3>
      <div class="avatar-pick">
        ${Object.entries(AVATARS).map(([k, a]) => `
          <button class="avatar-opt ${k === state.avatar ? 'on' : ''}" data-av="${k}" ${dis}>
            ${avatarSVG(k)}<span><b>${a.name}</b><small>${a.tagline}</small></span>
          </button>`).join('')}
      </div>

      <h3 class="pick-title">英語レベル</h3>
      <div class="opt-list">
        ${Object.entries(LEVELS).map(([k, l]) => `
          <button class="opt ${k === state.level ? 'on' : ''}" data-level="${k}" ${dis}>
            <b class="opt-key">${k}</b><span><b>${l.label}</b><small>${l.eiken}</small></span>
          </button>`).join('')}
      </div>

      <h3 class="pick-title">テーマ</h3>
      <div class="opt-list">
        ${Object.entries(MODES).map(([k, m], i) => `
          <button class="opt ${k === state.mode ? 'on' : ''}" data-mode="${k}" ${dis}>
            <b class="opt-key">${'①②③'[i]}</b><span><b>${m.label}</b><small>${m.desc}</small></span>
          </button>`).join('')}
      </div>

      ${state.saved.length ? `
      <div class="saved-box">
        <h3>このトークで保存した語 <small class="muted">${state.saved.length}</small></h3>
        <ul class="chips">${state.saved.map((v) => `<li title="${esc(v.meaning)}">${esc(v.term)}</li>`).join('')}</ul>
      </div>` : ''}`;
    if (locked) return;
    $('#editName', setup).onclick = async () => { await askUserName(); drawSetup(); };
    $('#unlinkBook', setup)?.addEventListener('click', () => { state.bookId = ''; drawSetup(); });
    $$('[data-av]', setup).forEach((b) => (b.onclick = () => {
      state.avatar = s.avatar = b.dataset.av;
      save();
      drawSetup();
      drawStage();
    }));
    $$('[data-level]', setup).forEach((b) => (b.onclick = () => {
      state.level = s.level = b.dataset.level;
      save();
      drawSetup();
    }));
    $$('[data-mode]', setup).forEach((b) => (b.onclick = () => {
      state.mode = s.talkMode = b.dataset.mode;
      save();
      drawSetup();
    }));
  }

  function drawStage() {
    const a = AVATARS[state.avatar];
    $('.talk', el).classList.toggle('in-call', ['connecting', 'live', 'lost', 'ending'].includes(state.status));
    $('#avatarBox', el).innerHTML = avatarSVG(state.avatar);
    $('#avatarBox', el).dataset.state = state.status;
    $('#avName', el).textContent = a.name;
    const labels = { idle: '準備OK', connecting: '接続中…', live: '会話中 — 英語で話しかけてください', ending: '終了処理中…', ended: '終了しました', lost: '接続が切れました' };
    $('#statusText', el).textContent = labels[state.status] || state.status;
    $('#statusDot', el).className = `status-dot ${state.status}`;
    const c = $('#controls', el);
    if (state.status === 'idle' || state.status === 'ended') {
      c.innerHTML = `<button class="btn btn-primary btn-lg" id="start">🎙️ トークを始める</button>`;
      $('#start', c).onclick = start;
    } else if (state.status === 'live' || state.status === 'connecting' || state.status === 'lost') {
      c.innerHTML = `
        <button class="btn" id="mute">${state.muted ? '🔇 ミュート中' : '🎤 マイクON'}</button>
        <button class="btn" id="hint" title="言葉に詰まったとき">💡 ヒント</button>
        <button class="btn" id="slow" title="ゆっくり・簡単に">🐢 ゆっくり</button>
        <button class="btn btn-danger" id="stop">■ 終了</button>`;
      $('#mute', c).onclick = () => { state.muted = !state.muted; live?.setMuted(state.muted); drawStage(); };
      $('#hint', c).onclick = () => appendInstruction('The learner pressed the HINT button: they are stuck. Rephrase your last question more simply and show two short example sentence starters on the display.');
      $('#slow', c).onclick = () => appendInstruction('The learner asked you to speak more slowly and use simpler words from now on.');
      $('#stop', c).onclick = () => stop();
    } else {
      c.innerHTML = '';
    }
  }

  function appendInstruction(content) {
    live?.send({ type: 'session.instructions.append', event_id: `ins_${Date.now()}`, delegation_id: null, content });
    toast('アバターに伝えました');
  }

  // ---- the display screen
  function drawDisplay() {
    if (!state.shown.length) {
      displayEl.innerHTML = `
        <div class="display-head"><span>📺 DISPLAY</span></div>
        <div class="display-empty">
          <p>大事な表現やディスカッション・クエスチョンが、ここに表示されます。</p>
          <p class="mini">会話中に <b>“Can you show it on the display?”</b> や <b>“Can you write it down?”</b> と頼むと、何でも書いてくれます。<br>
          <b>“Can you save that word?”</b> と頼むと単語帳に保存されます。</p>
        </div>`;
      return;
    }
    displayEl.innerHTML = `
      <div class="display-head"><span>📺 DISPLAY</span><small>${state.shown.length}</small></div>
      <div class="display-cards">
        ${state.shown.map((c, ci) => `
          <section class="dcard dcard-${esc(c.style)} ${ci === 0 ? 'new' : ''}">
            <h3>${esc(c.heading)}</h3>
            ${c.style === 'questions' ? '<ol>' : '<ul>'}
              ${c.items.map((it, ii) => `
                <li>
                  <span class="d-text">${esc(it.text)}</span>
                  ${it.note ? `<span class="d-note">${esc(it.note)}</span>` : ''}
                  ${c.style === 'vocabulary' ? `<button class="d-save" data-save="${ci}:${ii}" title="単語帳に追加">${it.saved ? '✓' : '＋単語帳'}</button>` : ''}
                </li>`).join('')}
            ${c.style === 'questions' ? '</ol>' : '</ul>'}
          </section>`).join('')}
      </div>`;
    $$('[data-save]', displayEl).forEach((b) => (b.onclick = () => {
      const [ci, ii] = b.dataset.save.split(':').map(Number);
      const it = state.shown[ci].items[ii];
      if (it.saved) return;
      const [meaning, example = ''] = (it.note || '').split(' / ');
      const v = addVocab({ term: it.text, meaning, example, bookId: state.bookId || null, source: 'talk' });
      if (v && !state.saved.includes(v)) state.saved.push(v);
      it.saved = true;
      drawDisplay();
      drawSetup();
    }));
  }

  function showOnDisplay(args) {
    const items = (Array.isArray(args.items) ? args.items : [])
      .map((it) => (typeof it === 'string' ? { text: it } : it))
      .filter((it) => it?.text);
    if (!items.length) return { ok: false, error: 'nothing to show' };
    const style = ['questions', 'vocabulary', 'note'].includes(args.style) ? args.style : 'note';
    state.shown.unshift({ heading: args.heading || 'Note', style, items });
    drawDisplay();
    displayEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return { ok: true, shown: true };
  }

  // Transcript is not shown, but kept for the after-talk feedback.
  function addTranscript(role, delta) {
    if (!delta) return;
    let last = state.turns[state.turns.length - 1];
    if (!last || last.role !== role) {
      last = { role, text: '' };
      state.turns.push(last);
    }
    last.text += delta;
  }

  async function start() {
    if (!s.userName && !(await askUserName())) return;
    drawSetup();
    if (!(await ensurePasscode())) return;
    const book = getBook(state.bookId);
    const name = s.userName;
    state.turns = [];
    state.saved = [];
    state.shown = [];
    state.muted = false;
    drawDisplay();
    $('#review', el).innerHTML = '';
    state.status = 'connecting';
    drawSetup();
    drawStage();

    meter = createMeter();
    live = new LiveSession({
      session: {
        model: 'gpt-live-1',
        instructions: buildInstructions({ book, mode: state.mode, avatar: state.avatar, level: state.level, name }),
        audio: { output: { voice: AVATARS[state.avatar].voice } },
        delegation: {
          type: 'responses',
          responses: {
            instructions: BACKEND_INSTRUCTIONS,
            tools: [DISPLAY_TOOL, SAVE_TOOL],
            tool_choice: 'auto',
            parallel_tool_calls: false,
          },
        },
      },
      onStatus: (st) => {
        if (st === 'live' && state.status !== 'live') {
          state.startedAt = Date.now();
          timer = setInterval(() => ($('#clock', el).textContent = formatDuration((Date.now() - state.startedAt) / 1000)), 1000);
          // Kick off the conversation: the avatar greets the learner by name first.
          live.send({
            type: 'session.commentary.append',
            event_id: `greet_${Date.now()}`,
            delegation_id: null,
            content: `Greet ${name} by name now, warmly, and ask for a short summary of what they have read so far${book ? ` of "${book.title}"` : ' (and which book it is)'}.`,
          });
        }
        if (st === 'ended') return;
        state.status = st;
        drawStage();
      },
      onRemoteStream: (stream) => meter.attach(stream, $('#avatarBox', el)),
      onEvent: (ev) => {
        if (ev.type === 'session.input_transcript.delta') addTranscript('user', ev.delta);
        else if (ev.type === 'session.output_transcript.delta') addTranscript('assistant', ev.delta);
        else if (ev.type === 'error') {
          console.warn('GPT-Live error', ev);
          toast(`エラー: ${ev.error?.message || '不明なエラー'}`, 'error');
        }
      },
      onFunctionCall: (fn, args) => {
        if (fn === 'show_on_display') return showOnDisplay(args);
        if (fn === 'save_vocabulary') {
          const v = addVocab({ term: args.term, meaning: args.meaning_ja, example: args.example_en, note: args.note_ja, bookId: state.bookId || null, source: 'talk' });
          if (v && !state.saved.includes(v)) state.saved.push(v);
          drawSetup();
          return { ok: true, saved: args.term };
        }
        return { ok: false, error: 'unknown function' };
      },
    });

    try {
      await live.start();
    } catch (err) {
      console.error(err);
      const msg = err.name === 'NotAllowedError' ? 'マイクの使用が許可されていません。ブラウザの設定を確認してください。' : err.message;
      toast(msg, 'error');
      $('#review', el).innerHTML = `<div class="card error-card"><h3>接続できませんでした</h3><p>${esc(msg)}</p></div>`;
      meter?.stop();
      live = null;
      state.status = 'idle';
      drawSetup();
      drawStage();
    }
  }

  async function stop({ silent = false } = {}) {
    if (!live) return;
    state.status = 'ending';
    if (!silent) drawStage();
    clearInterval(timer);
    const closed = await live.close();
    live = null;
    meter?.stop();
    const elapsed = state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0;
    const durationSec = Math.round(closed?.usage?.seconds ?? elapsed);
    state.status = 'ended';
    if (!state.turns.length) {
      if (!silent) { drawSetup(); drawStage(); }
      return;
    }
    const book = getBook(state.bookId);
    const talk = addTalk({
      bookId: state.bookId || null,
      bookTitle: book?.title || '',
      mode: state.mode,
      modeLabel: MODES[state.mode].label,
      avatarName: AVATARS[state.avatar].name,
      level: state.level,
      durationSec,
      turns: state.turns,
      display: state.shown,
      savedTerms: state.saved.map((v) => v.term),
    });
    if (durationSec >= 30) addXP(Math.max(5, Math.round((durationSec / 60) * 10)), `${formatDuration(durationSec)}トーク`);
    if (silent) return;
    drawSetup();
    drawStage();
    drawReview(talk);
  }

  function drawReview(talk) {
    const box = $('#review', el);
    box.innerHTML = `
      <div class="card review-card">
        <h2>おつかれさまでした！ 🎉</h2>
        <p class="muted">${formatDuration(talk.durationSec)} 話しました。会話から覚えたい単語・フレーズを AI に選んでもらいましょう。</p>
        <button class="btn btn-primary" id="extract">✨ 単語・フレーズを抽出＆フィードバック</button>
        <div id="extracted"></div>
      </div>`;
    $('#extract', box).onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = '分析中…';
      try {
        const result = await extract(talk);
        talk.feedback = result;
        save();
        drawExtracted(result, $('#extracted', box));
        e.target.remove();
      } catch (err) {
        toast(`抽出に失敗しました: ${err.message}`, 'error');
        e.target.disabled = false;
        e.target.textContent = '✨ もう一度試す';
      }
    };
  }

  function drawExtracted(r, box) {
    box.innerHTML = `
      <div class="feedback"><p>${esc(r.feedback_ja)}</p></div>
      ${r.corrections.length ? `
        <h3>より自然な言い方</h3>
        <ul class="corrections">
          ${r.corrections.map((c, i) => `
            <li>
              <p><s>${esc(c.you_said)}</s></p>
              <p>→ <strong>${esc(c.better)}</strong> <button class="btn btn-sm" data-corr="${i}">＋単語帳</button></p>
              <p class="mini muted">${esc(c.why_ja)}</p>
            </li>`).join('')}
        </ul>` : ''}
      <h3>覚えたい単語・フレーズ</h3>
      <form id="pick">
        <ul class="pick-list">
          ${r.items.map((it, i) => `
            <li><label>
              <input type="checkbox" name="i" value="${i}" checked>
              <span><strong>${esc(it.term)}</strong> — ${esc(it.meaning_ja)}<br><em class="mini">${esc(it.example_en)}</em>${it.note_ja ? `<br><small class="muted">${esc(it.note_ja)}</small>` : ''}</span>
            </label></li>`).join('')}
        </ul>
        <button class="btn btn-primary">選んだ語を単語帳に追加</button>
      </form>`;
    $('#pick', box).onsubmit = (e) => {
      e.preventDefault();
      const picked = new FormData(e.target).getAll('i').map(Number);
      picked.forEach((i) => {
        const it = r.items[i];
        addVocab({ term: it.term, meaning: it.meaning_ja, example: it.example_en, note: it.note_ja, bookId: state.bookId || null, source: 'talk' });
      });
      toast(`${picked.length} 語を単語帳に追加しました`, 'success');
      e.target.querySelector('button').disabled = true;
    };
    $$('[data-corr]', box).forEach((b) => (b.onclick = () => {
      const c = r.corrections[+b.dataset.corr];
      addVocab({ term: c.better, meaning: c.why_ja, example: '', note: `元の言い方: ${c.you_said}`, bookId: state.bookId || null, source: 'correction' });
      b.disabled = true;
    }));
  }

  async function extract(talk) {
    const transcript = talk.turns.map((t) => `${t.role === 'user' ? 'Learner' : 'Partner'}: ${t.text}`).join('\n');
    const str = { type: 'string' };
    return responsesJSON({
      instructions: `You are an experienced English teacher for Japanese learners (CEFR ${talk.level}). Analyse the discussion transcript about the book "${talk.bookTitle || 'a book'}".
1. items: pick 5-10 words or phrases worth learning — expressions the partner used that are useful at this level, or things the learner struggled to say. Prefer collocations, phrasal verbs and book-discussion phrases over single easy words. Give term in base form, natural Japanese meaning, an example sentence (prefer one from the transcript), and a short Japanese usage note (empty string if none).
2. corrections: up to 5 meaningful errors or unnatural expressions from the LEARNER's lines, with a more natural version and a short Japanese explanation. Speech-recognition glitches are not errors.
3. feedback_ja: 2-3 warm, specific sentences in Japanese about what went well and one thing to try next time.`,
      input: transcript,
      schemaName: 'talk_review',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'corrections', 'feedback_ja'],
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'meaning_ja', 'example_en', 'note_ja'], properties: { term: str, meaning_ja: str, example_en: str, note_ja: str } } },
          corrections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['you_said', 'better', 'why_ja'], properties: { you_said: str, better: str, why_ja: str } } },
          feedback_ja: str,
        },
      },
    });
  }

  drawSetup();
  drawStage();
  drawDisplay();

  // Leaving the page mid-talk: close the session and keep what was said.
  return () => {
    clearInterval(timer);
    if (live) stop({ silent: true });
  };
}

// Drives the avatar's mouth from the partner's audio level.
function createMeter() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let raf = 0;
  let src = null;
  return {
    attach(stream, box) {
      src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length) / 128;
        smooth = smooth * 0.6 + Math.min(1, rms * 6) * 0.4;
        const mouth = box.querySelector('.mouth');
        if (mouth) mouth.setAttribute('ry', (3 + smooth * 13).toFixed(1));
        box.classList.toggle('speaking', smooth > 0.08);
        raf = requestAnimationFrame(tick);
      };
      tick();
    },
    stop() {
      cancelAnimationFrame(raf);
      try { src?.disconnect(); } catch {}
      ctx.close();
    },
  };
}
