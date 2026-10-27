import { $, $$, esc, formatDuration, openDialog, toast } from './util.js';
import { data, save, getBook, addVocab, addTalk, talkUsage, addTalkSeconds, TALK_LIMIT_MIN } from './store.js';
import { ensurePasscode } from './api.js';
import { AVATARS, avatarHTML, avatarKey, lipSync, voiceFor } from './avatars.js';
import { LiveSession, responsesJSON } from './live.js';
import { bookCover } from './books.js';
import { openAskBox, closeAskBox } from './askbox.js';

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
  C2: { label: 'Proficient', eiken: '英検1級以上', en: 'C2 (proficiency): talk exactly as with an educated native speaker, including idioms, subtle nuance and abstract ideas' },
};

// The level the after-talk feedback aims for (one step up; C2 stays C2).
const NEXT_LEVEL = { A2: 'B1', B1: 'B2', B2: 'C1', C1: 'C2', C2: 'C2' };

let live = null;

const STATUS_LABEL = { reading: '読書中', finished: '読了', want: '読みたい' };
// Books for the talk picker: reading first, then finished (latest first), then want-to-read.
function talkBooks() {
  const rank = { reading: 0, finished: 1, want: 2 };
  return [...data.books].sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)
    || String(b.finishDate || b.startDate || '').localeCompare(String(a.finishDate || a.startDate || ''))
    || (b.createdAt || 0) - (a.createdAt || 0));
}
const IDLE_MS = 30_000; // pause the session after this long with nobody speaking

// Escapes text and marks the key phrase inside the polished sentence.
function highlight(sentence, phrase) {
  const i = phrase ? sentence.toLowerCase().indexOf(phrase.toLowerCase()) : -1;
  if (i < 0) return esc(sentence);
  return `${esc(sentence.slice(0, i))}<mark>${esc(sentence.slice(i, i + phrase.length))}</mark>${esc(sentence.slice(i + phrase.length))}`;
}

function bookContext(book) {
  if (!book) return 'You do not know yet which book they read — ask them as part of the summary. Never spoil anything beyond what they have read.';
  const status = {
    finished: 'They have finished it.',
    reading: 'They are reading it now and have not finished it — never spoil anything beyond what they have read.',
    want: 'They have NOT started reading it yet (it is on their "want to read" list) — do not reveal anything about the plot beyond the basic premise.',
  }[book.status] || 'They may not have finished it — never spoil anything beyond what they have read.';
  return `They chose the book "${book.title}"${book.author ? ` by ${book.author}` : ''}. ${status}${book.memo ? ` Their own notes (may be Japanese): ${book.memo}` : ''}`;
}

// The latest earlier talk about this book, so the avatar can pick up where they left off.
function lastTalkAbout(book) {
  if (!book) return null;
  const t = data.talks.find((x) => x.bookId === book.id && x.mode !== 'practice' && x.turns?.length);
  if (!t) return null;
  const said = t.turns.filter((x) => x.role === 'user').map((x) => x.text.trim()).join(' ').slice(-600);
  const shown = (t.display || []).map((c) => `${c.heading}: ${c.items.map((i) => i.text).join(' | ')}`).join('; ').slice(0, 400);
  return { date: t.date, said, shown, terms: (t.savedTerms || []).slice(0, 8).join(', ') };
}

// How the avatar opens the talk: step 2 of the flow, and the kick-off cue.
function opening(book, name) {
  const prev = lastTalkAbout(book);
  if (!book) {
    return {
      step: `Ask ${name} which book they are reading and to give you a short summary of what they have read so far (part of the book or all of it is fine).`,
      cue: `Greet ${name} by name now, warmly, and ask which book they are reading and for a short summary of what they have read so far.`,
    };
  }
  const title = `"${book.title}"`;
  if (book.status === 'want') {
    return {
      step: `${name} hasn't started ${title} yet. Instead of a summary, ask what made them want to read it and what they already know about it (cover, blurb, reviews, the author). Talk about their expectations and predictions — without spoilers.`,
      cue: `Greet ${name} by name now, mention that ${title} is on their reading list, and ask what made them want to read it.`,
    };
  }
  if (prev) {
    return {
      step: `You talked with ${name} about ${title} before (on ${prev.date}). Briefly recall it in one sentence, then ask ${book.status === 'finished' ? 'how they felt about the rest of the book now that they have finished it' : 'how far they have read since then and to summarise the new part'}.
What ${name} said last time: ${prev.said || '(little)'}${prev.shown ? `\nOn the display last time: ${prev.shown}` : ''}${prev.terms ? `\nWords they saved: ${prev.terms}` : ''}`,
      cue: `Greet ${name} by name now, say it's nice to talk about ${title} again, recall last time in a few words, and ask ${book.status === 'finished' ? 'how they found the ending part now that they have finished it' : 'how far they have read since then'}.`,
    };
  }
  if (book.status === 'finished') {
    return {
      step: `${name} has finished ${title}. Congratulate them briefly, then ask for a short summary of the story in their own words.`,
      cue: `Greet ${name} by name now, congratulate them on finishing ${title}, and ask them to sum it up in their own words.`,
    };
  }
  return {
    step: `${name} is reading ${title}. Ask how far they have got and for a short summary of what has happened so far.`,
    cue: `Greet ${name} by name now, mention that they are reading ${title}, and ask how far they have got and what has happened so far.`,
  };
}

const HOW_TO_TALK = (name) => `HOW TO TALK
- Speak only English, except a few Japanese words if ${name} is really stuck.
- Keep each turn short (1-3 sentences) and usually end with one question. Let ${name} do most of the talking.
- Show real interest; share your own opinion briefly sometimes.
- When ${name} makes a meaningful mistake, recast it naturally ("Oh, you mean ...?") instead of lecturing.
- If ${name} asks you to save or remember a word or phrase, delegate it so it is saved to their word book, then confirm briefly.

ENDING THE TALK
When ${name} clearly wants to finish ("Let's stop here.", "That's all for today.", "I have to go.", "Goodbye!"), say a short, warm goodbye (one or two sentences, mentioning one thing they did well), then delegate a request to end the talk — the app closes it after your goodbye. If you are not sure they want to stop, ask "Shall we finish here?" first. Never end the talk on your own initiative.`;

const DISPLAY_RULES = (name) => `THE DISPLAY
There is a screen next to you that ${name} can see. Use it to make important language visible. Delegate a request to show something on the display (give the exact text to show) whenever:
- you present discussion questions;
- you introduce, explain or correct a useful word, phrase or expression;
- ${name} asks what a word means, how to say something in English, or how to spell something;
- ${name} asks you to show or write something ("Can you show it on the display?", "Can you write it down?", "Could you put that on the screen?") — show whatever they ask for.
If ${name} asks to see the conversation itself as text ("Can you show our conversation on the display?", "Can you show the script?"), delegate a request to switch the screen to the live script; delegate switching back when they ask. Then say something short like "Sure, the script is on the screen now."
When you put something new on the display while ${name} may be looking at the script, mention it ("I've put it on the display — have a look at the Display tab.").
Keep display text short. You can say "I've put it on the display."`;

function buildPracticeInstructions({ book, avatar, level, name, phrases }) {
  const a = AVATARS[avatar];
  const one = phrases.length === 1;
  const list = phrases.map((p, i) => `${i + 1}. "${p.key_phrase}" — e.g. "${p.polished}" (meaning: ${p.meaning_ja}; ${name} had said: "${p.you_said}")`).join('\n');
  return `You are ${a.name}, an English conversation partner in "Yosho Talk" (洋書トーク), a learning app linked to the YouTube show "Yosho Radio" (洋書ラジオ).
You are ${a.persona}
${a.accent}${voiceFor(avatar).prompt ? `\nYour voice: ${voiceFor(avatar).prompt}` : ''}
The learner's name is ${name}. Always call them "${name}".
${name} is a Japanese speaker whose English level is ${LEVELS[level].en}. These phrases are one step above that level.
${book ? `Their recent talk was about "${book.title}"${book.author ? ` by ${book.author}` : ''}.` : ''}

TODAY: PHRASE PRACTICE
${one ? 'This phrase comes' : 'These phrases come'} from feedback on ${name}'s last talk. ${one ? 'It is' : 'They are'} already on the display:
${list}

FLOW
1. You speak first. Greet ${name} by name and say: "Let's practice using the ${one ? 'phrase' : 'phrases'} in conversation."
2. Go over ${one ? 'the phrase' : 'each phrase, one at a time'}: say it clearly, explain briefly when and how to use it, and give one short example.
3. Ask ${name} if they have any questions about the ${one ? 'phrase' : 'phrases'}, and answer them.
4. When ${name} has no more questions, ask several natural questions (3-5${one ? '' : ', covering every phrase'}), one at a time, that invite ${name} to answer using the ${one ? 'phrase' : 'phrases'}. Connect the questions to the book and to ${name}'s life.
   - If ${name} uses the phrase well, praise it specifically.
   - If they don't use it, encourage them gently ("Could you try using '...' in your answer?").
   - If they use it slightly wrong, model the correct version and let them try again.
5. Give a short, warm wrap-up of how they did, then ask if they'd like to keep practising or finish here.

${DISPLAY_RULES(name)}

${HOW_TO_TALK(name)}`;
}

function buildInstructions({ book, mode, avatar, level, name }) {
  const a = AVATARS[avatar];
  return `You are ${a.name}, an English conversation partner in "Yosho Talk" (洋書トーク), a learning app linked to the YouTube show "Yosho Radio" (洋書ラジオ), where two English teachers talk about English-language books.
You are ${a.persona}
${a.accent}${voiceFor(avatar).prompt ? `\nYour voice: ${voiceFor(avatar).prompt}` : ''}
The learner's name is ${name}. Always call them "${name}" — in your greeting and naturally now and then.
The learner is a Japanese speaker whose English level is ${LEVELS[level].en}. Adjust your English to that level.
${bookContext(book)}

CONVERSATION FLOW
1. You speak first. Greet ${name} by name, warmly and briefly.
2. ${opening(book, name).step} Listen and react to it. If the answer is very short, ask one friendly follow-up question.
3. Then continue with today's theme, building on what they told you:
${MODES[mode].en}

${DISPLAY_RULES(name)}

${HOW_TO_TALK(name)}`;
}

const BACKEND_INSTRUCTIONS = `You are the backend helper for "Yosho Talk", an English book-discussion app for Japanese learners. The voice partner delegates tasks to you. You have four functions:

show_on_display — the learner can see a display screen. Call it whenever you are asked to show, display, write down or put something on the screen. Use the exact content you were given and keep it concise.
  - style "questions": discussion questions (one question per item, no numbering — the app numbers them).
  - style "vocabulary": words or expressions. text = the English expression; note = a short Japanese meaning, optionally followed by " / " and a short English example.
  - style "note": anything else (a correction, a sentence, a list, a spelling). For a correction, text = the better version and note = a short Japanese explanation.

show_script — call it with show=true when asked to show the conversation itself (the script / transcript / what we are saying), and show=false when asked to go back to the display. The app switches its screen to a live transcript; don't write the conversation out yourself.

end_talk — call it when asked to end the talk (the learner wants to finish). The app closes the session after the goodbye has been spoken.

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

const END_TOOL = {
  type: 'function',
  name: 'end_talk',
  description: 'End the talk because the learner wants to finish. Call it only after saying goodbye.',
  parameters: { type: 'object', properties: {}, required: [] },
};

const SCRIPT_TOOL = {
  type: 'function',
  name: 'show_script',
  description: 'Show or hide the live script (a running transcript of the conversation) on the display.',
  parameters: {
    type: 'object',
    properties: { show: { type: 'boolean', description: 'true to show the script, false to hide it.' } },
    required: ['show'],
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
    bookId: bookIdParam && getBook(bookIdParam) ? bookIdParam : getBook(s.talkBookId) ? s.talkBookId : '',
    mode: MODES[s.talkMode] ? s.talkMode : 'impressions',
    avatar: avatarKey(s.avatar),
    level: LEVELS[s.level] ? s.level : 'B1',
    status: 'idle',
    turns: [],
    saved: [],
    shown: [],
    startedAt: 0,
    muted: false,
    practice: null, // phrases being practised, or null for a normal talk
    elapsedBefore: 0, // seconds of earlier sessions in this talk (before a pause)
    segStart: 0,
    lastActivity: 0,
    lastOutput: 0, // when the avatar last said something
    endAt: 0, // when the avatar asked to end the talk (end_talk)
    reviewing: false,
    tab: 'display', // display tab shown: 'display' (cards) or 'script'
    unseen: false, // new cards arrived while the Script tab was open
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
    const u = talkUsage();
    const usedMin = Math.floor(u.used / 60);
    // Keep the book row where the learner scrolled it (redrawing would reset it).
    const pickScroll = $('.book-pick', setup)?.scrollLeft || 0;
    setup.innerHTML = `
      <div class="usage ${u.left < 1 ? 'over' : u.left < 600 ? 'low' : ''}">
        <div class="usage-head"><b>今月のトーク</b><span><b>${usedMin}</b> / ${u.limit / 60}分</span></div>
        <span class="bar"><span style="width:${Math.min(100, (u.used / u.limit) * 100)}%"></span></span>
        <small>${u.left < 1 ? '今月の上限に達しました' : `残り ${Math.ceil(u.left / 60)}分`} ・ ${u.resetLabel}にリセット</small>
      </div>
      <p class="mini hist-shortcut"><a href="#/history">📜 これまでのトークを見る</a></p>
      <p class="mini muted hello">${s.userName ? `👋 ${esc(s.userName)} さん` : '呼び名が未登録です'} <button class="link-btn" id="editName" ${dis}>${s.userName ? '変更' : '登録'}</button></p>

      <h3 class="pick-title">話す本</h3>
      ${data.books.length ? `
      <div class="book-pick" role="listbox" aria-label="話す本">
        <button class="book-opt ${!book ? 'on' : ''}" data-book="" ${dis}><span class="book-none">📚</span><small>指定しない</small></button>
        ${talkBooks().map((b) => `
          <button class="book-opt ${b.id === state.bookId ? 'on' : ''}" data-book="${b.id}" ${dis} title="${esc(b.title)}">
            ${bookCover(b, 'sm')}<small>${esc(b.title)}</small><em class="st st-${b.status}">${STATUS_LABEL[b.status] || ''}</em>
          </button>`).join('')}
      </div>` : '<p class="mini muted">本棚に本を登録すると、ここで話す本を選べます。<a href="#/books">本棚へ</a></p>'}

      <h3 class="pick-title">キャラクター</h3>
      <div class="avatar-pick">
        ${Object.entries(AVATARS).filter(([, a]) => a.talk !== false).map(([k, a]) => `
          <button class="avatar-opt ${k === state.avatar ? 'on' : ''}" data-av="${k}" ${dis}>
            ${avatarHTML(k, { framing: 'face' })}<span><b>${a.name} <span class="from">${a.from}</span></b><small>${a.tagline}</small></span>
          </button>`).join('')}
      </div>

      <h3 class="pick-title">あなたの英語レベル</h3>
      <p class="mini muted pick-help">アバターがあなたのレベルに合わせて話します</p>
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
      </div>` : ''}

      <button class="btn btn-primary btn-lg setup-start" id="setupStart" ${dis}>🎙️ トークを始める</button>`;
    const pick = $('.book-pick', setup);
    if (pick) pick.scrollLeft = pickScroll;
    if (locked) return;
    $('#setupStart', setup).onclick = () => start();
    $('#editName', setup).onclick = async () => { await askUserName(); drawSetup(); };
    // Picking only moves the highlight: redrawing would rebuild the cover and face
    // images, and they flash blank for a moment while they reload.
    const pickOne = (attr, b) => {
      $$(`[${attr}]`, setup).forEach((x) => x.classList.toggle('on', x === b));
      save();
    };
    $$('[data-book]', setup).forEach((b) => (b.onclick = () => {
      state.bookId = s.talkBookId = b.dataset.book;
      pickOne('data-book', b);
    }));
    $$('[data-av]', setup).forEach((b) => (b.onclick = () => {
      state.avatar = s.avatar = b.dataset.av;
      pickOne('data-av', b);
      drawStage();
    }));
    $$('[data-level]', setup).forEach((b) => (b.onclick = () => {
      state.level = s.level = b.dataset.level;
      pickOne('data-level', b);
    }));
    $$('[data-mode]', setup).forEach((b) => (b.onclick = () => {
      state.mode = s.talkMode = b.dataset.mode;
      pickOne('data-mode', b);
    }));
  }

  function drawStage() {
    const a = AVATARS[state.avatar];
    // Phase drives the phone layout: setup screen → full-screen call → review.
    const inCall = ['connecting', 'live', 'lost', 'pausing', 'paused', 'ending'].includes(state.status);
    const talkEl = $('.talk', el);
    talkEl.classList.toggle('in-call', inCall);
    talkEl.dataset.phase = inCall ? 'call' : state.reviewing ? 'review' : 'setup';
    if ($('#avatarBox', el).dataset.key !== state.avatar) {
      $('#avatarBox', el).innerHTML = avatarHTML(state.avatar);
      $('#avatarBox', el).dataset.key = state.avatar;
    }
    $('#avatarBox', el).dataset.state = state.status;
    $('#avName', el).textContent = a.name;
    const labels = { idle: '準備OK', connecting: '接続中…', live: '会話中', pausing: '一時停止中…', paused: '一時停止中', ending: '終了処理中…', ended: '終了しました', lost: '接続が切れました' };
    $('#statusText', el).textContent = labels[state.status] || state.status;
    $('#statusDot', el).className = `status-dot ${state.status}`;
    const c = $('#controls', el);
    if (state.status === 'idle' || state.status === 'ended') {
      c.innerHTML = `<button class="btn btn-primary btn-lg" id="start">🎙️ トークを始める</button>`;
      $('#start', c).onclick = () => start();
    } else if (state.status === 'live' || state.status === 'connecting' || state.status === 'lost') {
      c.innerHTML = `
        <button class="btn" id="mute">${state.muted ? '🔇 ミュート中' : '🎤 マイクON'}</button>
        <button class="btn btn-danger" id="stop">■ 終了</button>`;
      $('#mute', c).onclick = () => { state.muted = !state.muted; live?.setMuted(state.muted); drawStage(); };
      $('#stop', c).onclick = () => stop();
    } else if (state.status === 'paused') {
      c.innerHTML = `
        <p class="pause-note">30秒間会話がなかったので一時停止しました（課金も止まっています）。</p>
        <button class="btn btn-primary" id="resume">▶ 再開</button>
        <button class="btn btn-danger" id="stop">■ 終了</button>`;
      $('#resume', c).onclick = () => resume();
      $('#stop', c).onclick = () => stop();
    } else {
      c.innerHTML = '';
    }
  }

  function backToSetup() {
    closeAskBox();
    state.reviewing = false;
    $('#review', el).innerHTML = '';
    drawStage();
    window.scrollTo(0, 0);
  }

  // ---- the display screen: two tabs. "Display" holds the cards (questions, words,
  // notes); "Script" is the live transcript. New cards light up the Display tab.
  function drawDisplay() {
    const onScript = state.tab === 'script';
    const cards = state.shown.length ? `
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
      </div>` : `
      <div class="display-empty">
        <p>大事な表現やディスカッション・クエスチョンが、ここに表示されます。</p>
        <p class="mini">会話中に <b>“Can you show it on the display?”</b> や <b>“Can you write it down?”</b> と頼むと、何でも書いてくれます。<br>
        <b>“Can you show the script?”</b> と頼むか「Script」タブを押すと、会話のスクリプトが見られます。<br>
        <b>“Can you save that word?”</b> と頼むと単語帳に保存されます。</p>
      </div>`;
    const glow = state.unseen && onScript;
    displayEl.classList.toggle('on-script', onScript);
    displayEl.innerHTML = `
      <div class="display-tabs" role="tablist">
        <button role="tab" class="dtab ${onScript ? '' : 'on'} ${glow ? 'glow' : ''}" data-tab="display" aria-selected="${!onScript}">
          📺 Display${state.shown.length ? ` <small>${state.shown.length}</small>` : ''}${glow ? '<span class="dtab-new">NEW</span>' : ''}
        </button>
        <button role="tab" class="dtab ${onScript ? 'on' : ''}" data-tab="script" aria-selected="${onScript}">📝 Script</button>
      </div>
      ${onScript ? '<div class="script" id="script" aria-live="polite"></div>' : cards}`;
    $$('[data-tab]', displayEl).forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
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
    if (onScript) drawScript(true);
  }

  function setTab(tab) {
    state.tab = tab === 'script' ? 'script' : 'display';
    if (state.tab === 'display') state.unseen = false;
    drawDisplay();
    return { ok: true, screen: state.tab };
  }

  // Redraws the script; batched to one paint per frame since deltas arrive fast.
  let scriptFrame = 0;
  function drawScript(now = false) {
    if (state.tab !== 'script') return;
    if (!now) {
      if (!scriptFrame) scriptFrame = requestAnimationFrame(() => { scriptFrame = 0; drawScript(true); });
      return;
    }
    const box = $('#script', displayEl);
    if (!box) return;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40; // follow only if already at the bottom
    const who = { user: esc(s.userName || 'You'), assistant: esc(AVATARS[state.avatar].name) };
    box.innerHTML = state.turns.length
      ? state.turns.map((t) => `<p class="s-line s-${t.role}"><b>${who[t.role]}</b>${esc(t.text.trim())}</p>`).join('')
      : '<p class="s-wait">会話が始まると、ここにスクリプトが流れます。</p>';
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function showOnDisplay(args) {
    const items = (Array.isArray(args.items) ? args.items : [])
      .map((it) => (typeof it === 'string' ? { text: it } : it))
      .filter((it) => it?.text);
    if (!items.length) return { ok: false, error: 'nothing to show' };
    const style = ['questions', 'vocabulary', 'note'].includes(args.style) ? args.style : 'note';
    state.shown.unshift({ heading: args.heading || 'Note', style, items });
    if (state.tab === 'script') state.unseen = true;
    drawDisplay();
    displayEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return { ok: true, shown: true };
  }

  // Kept for the after-talk feedback, and shown on the display when the script is on.
  function addTranscript(role, delta) {
    if (!delta) return;
    let last = state.turns[state.turns.length - 1];
    if (!last || last.role !== role) {
      last = { role, text: '' };
      state.turns.push(last);
    }
    last.text += delta;
    drawScript();
  }

  // practice: polished phrases to practise (from the review), or null for a normal talk.
  async function start(practice = null) {
    if (!s.userName && !(await askUserName())) return;
    drawSetup();
    if (talkUsage().left < 1) {
      toast(`今月のトーク時間（${TALK_LIMIT_MIN}分）を使い切りました。${talkUsage().resetLabel}にリセットされます。`, 'error');
      return;
    }
    if (!(await ensurePasscode())) return;
    closeAskBox();
    state.practice = practice;
    state.reviewing = false;
    state.turns = [];
    state.saved = [];
    state.shown = [];
    state.tab = 'display';
    state.unseen = false;
    state.muted = false;
    state.elapsedBefore = 0;
    state.endAt = 0;
    if (practice) {
      // Put the phrases on the display straight away; no need to wait for the avatar.
      state.shown.push({
        heading: practice.length === 1 ? "Today's phrase" : "Today's phrases",
        style: 'vocabulary',
        items: practice.map((p) => ({ text: p.key_phrase, note: `${p.meaning_ja} / ${p.polished}` })),
      });
    }
    drawDisplay();
    $('#review', el).innerHTML = '';
    window.scrollTo(0, 0);
    await connect(false);
  }

  // Opens a GPT-Live session. resume: continue a talk that was paused for silence.
  async function connect(resume) {
    const book = getBook(state.bookId);
    const name = s.userName;
    const practice = state.practice;
    state.status = 'connecting';
    drawSetup();
    drawStage();

    let instructions = practice
      ? buildPracticeInstructions({ book, avatar: state.avatar, level: state.level, name, phrases: practice })
      : buildInstructions({ book, mode: state.mode, avatar: state.avatar, level: state.level, name });
    let greeting = practice
      ? `Greet ${name} by name now and say "Let's practice using the ${practice.length === 1 ? 'phrase' : 'phrases'} in conversation." Then go over the ${practice.length === 1 ? 'phrase' : 'phrases'} on the display.`
      : opening(book, name).cue;
    if (resume) {
      const transcript = state.turns.map((t) => `${t.role === 'user' ? name : 'You'}: ${t.text}`).join('\n').slice(-8000);
      const shown = state.shown.map((c) => `${c.heading}: ${c.items.map((i) => i.text).join(' | ')}`).join('\n');
      instructions += `\n\nRESUMED CONVERSATION
The talk was paused because nobody spoke for a while, and ${name} has just resumed it. Do not start over and do not greet them as if for the first time. Here is the conversation so far:
${transcript || '(nothing yet)'}${shown ? `\nAlready on the display:\n${shown}` : ''}`;
      greeting = `Welcome ${name} back in one short, friendly sentence, then continue the conversation where you left off (for example, gently repeat your last question).`;
    }

    meter = createMeter();
    live = new LiveSession({
      session: {
        model: 'gpt-live-1',
        instructions,
        audio: { output: { voice: voiceFor(state.avatar).voice } },
        delegation: {
          type: 'responses',
          responses: {
            instructions: BACKEND_INSTRUCTIONS,
            tools: [DISPLAY_TOOL, SCRIPT_TOOL, SAVE_TOOL, END_TOOL],
            tool_choice: 'auto',
            parallel_tool_calls: false,
          },
        },
      },
      onStatus: (st) => {
        if (st === 'live' && state.status !== 'live') {
          state.segStart = Date.now();
          state.lastActivity = Date.now();
          clearInterval(timer);
          timer = setInterval(tick, 1000);
          tick();
          // Kick off the conversation: the avatar speaks first.
          live.send({ type: 'session.commentary.append', event_id: `greet_${Date.now()}`, delegation_id: null, content: greeting });
        }
        if (st === 'ended') return;
        state.status = st;
        drawStage();
      },
      onRemoteStream: (stream) => meter.attach(stream, $('#avatarBox', el)),
      onEvent: (ev) => {
        if (ev.type === 'session.input_transcript.delta') { addTranscript('user', ev.delta); state.lastActivity = Date.now(); }
        else if (ev.type === 'session.output_transcript.delta') { addTranscript('assistant', ev.delta); state.lastActivity = state.lastOutput = Date.now(); }
        else if (ev.type === 'response.event') state.lastActivity = Date.now();
        else if (ev.type === 'error') {
          console.warn('GPT-Live error', ev);
          toast(`エラー: ${ev.error?.message || '不明なエラー'}`, 'error');
        }
      },
      onFunctionCall: (fn, args) => {
        if (fn === 'show_on_display') return showOnDisplay(args);
        if (fn === 'end_talk') {
          state.endAt = Date.now();
          return { ok: true, note: 'The app will end the talk once your goodbye has been spoken.' };
        }
        if (fn === 'show_script') return setTab(args.show !== false ? 'script' : 'display');
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
      meter?.stop();
      live = null;
      if (resume) {
        state.status = 'paused';
        drawStage();
        return;
      }
      $('#review', el).innerHTML = `<div class="card error-card"><h3>接続できませんでした</h3><p>${esc(msg)}</p></div>`;
      state.status = 'idle';
      drawSetup();
      drawStage();
    }
  }

  // Every second while live: clock, monthly limit, and the silence auto-pause.
  function tick() {
    if (state.status !== 'live') return;
    const seg = (Date.now() - state.segStart) / 1000;
    const left = talkUsage().left - seg;
    $('#clock', el).textContent = `${formatDuration(state.elapsedBefore + seg)} ・ 今月の残り ${Math.max(0, Math.ceil(left / 60))}分`;
    if (left <= 0) {
      toast(`今月のトーク時間（${TALK_LIMIT_MIN}分）を使い切ったので終了しました。`, 'error');
      stop();
    } else if (state.endAt && goodbyeDone()) {
      toast('会話が終わったので、トークを終了しました', 'success');
      stop();
    } else if (Date.now() - state.lastActivity > IDLE_MS) {
      pause();
    }
  }

  // After end_talk: wait until the avatar has finished its goodbye (quiet for 2 s,
  // at least 4 s after the request), or 20 s at most.
  function goodbyeDone() {
    const now = Date.now();
    if (now - state.endAt > 20_000) return true;
    const speaking = $('#avatarBox', el).classList.contains('speaking');
    return now - state.endAt > 4000 && now - (state.lastOutput || 0) > 2000 && !speaking;
  }

  // Closes the current GPT-Live session (billing stops) and counts its time.
  async function endSegment() {
    clearInterval(timer);
    const closed = await live.close();
    live = null;
    meter?.stop();
    const elapsed = state.segStart ? (Date.now() - state.segStart) / 1000 : 0;
    const sec = Math.round(closed?.usage?.seconds ?? elapsed);
    state.segStart = 0;
    state.elapsedBefore += sec;
    addTalkSeconds(sec);
  }

  async function pause() {
    if (!live || state.status !== 'live') return;
    state.status = 'pausing';
    drawStage();
    await endSegment();
    state.status = 'paused';
    drawStage();
  }

  async function resume() {
    if (talkUsage().left < 1) {
      toast(`今月のトーク時間（${TALK_LIMIT_MIN}分）を使い切りました。`, 'error');
      return;
    }
    await connect(true);
  }

  async function stop({ silent = false } = {}) {
    if (!live && state.status !== 'paused') return;
    state.status = 'ending';
    if (!silent) drawStage();
    if (live) await endSegment();
    const durationSec = state.elapsedBefore;
    state.status = 'ended';
    if (!state.turns.length) {
      if (!silent) { drawSetup(); drawStage(); }
      return;
    }
    const book = getBook(state.bookId);
    const practice = state.practice;
    const talk = addTalk({
      bookId: state.bookId || null,
      bookTitle: book?.title || '',
      mode: practice ? 'practice' : state.mode,
      modeLabel: practice ? 'フレーズ練習' : MODES[state.mode].label,
      avatarName: AVATARS[state.avatar].name,
      level: state.level,
      durationSec,
      turns: state.turns,
      display: state.shown,
      savedTerms: state.saved.map((v) => v.term),
      ...(practice ? { practiced: practice.map((p) => p.key_phrase) } : {}),
    });
    if (silent) return;
    state.reviewing = true;
    drawSetup();
    drawStage();
    if (practice) drawPracticeReview(talk, practice);
    else drawReview(talk);
    window.scrollTo(0, 0);
  }

  const backBtn = `<button class="btn btn-ghost back-setup" data-back>← 最初の画面へ</button>`;

  function drawReview(talk) {
    const box = $('#review', el);
    const from = talk.level;
    const to = NEXT_LEVEL[from] || 'C2';
    let count = Math.min(3, Math.max(1, Number(s.feedbackCount) || 2));
    box.innerHTML = `
      <div class="card review-card">
        <h2>おつかれさまでした！ 🎉</h2>
        <p class="muted">${formatDuration(talk.durationSec)} 話しました。</p>
        <h3>ワンランク上の表現 <span class="badge">${from === to ? 'C2 · より洗練された表現' : `${from} → ${to}`}</span></h3>
        <p class="mini muted">あなたの発言を、${from === to ? 'さらに洗練された' : `${to} レベルの`}表現に磨き上げます。いくつ受け取りますか？</p>
        <div class="seg count-seg" id="countSeg">
          ${[1, 2, 3].map((n) => `<button type="button" data-n="${n}" class="${n === count ? 'on' : ''}">${n}つ</button>`).join('')}
        </div>
        <div class="review-actions">
          <button class="btn btn-primary" id="extract">✨ フィードバックを受け取る</button>
        </div>
        <div id="extracted"></div>
        <div class="review-actions">${backBtn}</div>
      </div>`;
    $$('[data-n]', box).forEach((b) => (b.onclick = () => {
      count = s.feedbackCount = Number(b.dataset.n);
      save();
      $$('[data-n]', box).forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('[data-back]', box).onclick = backToSetup;
    $('#extract', box).onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = '分析中…';
      $$('[data-n]', box).forEach((x) => (x.disabled = true));
      try {
        const result = await polish(talk, count, to);
        talk.feedback = { ...result, target: to };
        save();
        $('#countSeg', box).remove();
        box.querySelector('.mini.muted').remove();
        e.target.parentElement.remove();
        drawPolished(talk.feedback, $('#extracted', box));
      } catch (err) {
        toast(`フィードバックの作成に失敗しました: ${err.message}`, 'error');
        e.target.disabled = false;
        e.target.textContent = '✨ もう一度試す';
        $$('[data-n]', box).forEach((x) => (x.disabled = false));
      }
    };
  }

  function phraseCards(list) {
    return `
      <ul class="polished-list">
        ${list.map((p, i) => `
          <li>
            ${p.you_said ? `<p class="you-said"><small>あなた</small><s>${esc(p.you_said)}</s></p>` : ''}
            <p class="polished"><small>Polished</small><span>${highlight(p.polished, p.key_phrase)}</span></p>
            <p class="key-phrase"><b>${esc(p.key_phrase)}</b> — ${esc(p.meaning_ja)}</p>
            <p class="mini muted">${esc(p.why_ja)}</p>
            <span class="row">
              <button class="btn btn-sm" data-add="${i}">＋単語帳</button>
              <button class="btn btn-sm btn-ghost" data-ask="${i}">💬 質問する</button>
            </span>
          </li>`).join('')}
      </ul>`;
  }

  function bindPhraseCards(box, list) {
    $$('[data-add]', box).forEach((b) => (b.onclick = () => {
      const p = list[+b.dataset.add];
      addVocab({ term: p.key_phrase, meaning: p.meaning_ja, example: p.polished, note: p.why_ja, bookId: state.bookId || null, source: 'feedback' });
      b.disabled = true;
      b.textContent = '✓ 追加しました';
    }));
    // Floating chat for questions about these phrases.
    const ask = openAskBox({ phrases: list, level: state.level, bookTitle: getBook(state.bookId)?.title || '' });
    $$('[data-ask]', box).forEach((b) => (b.onclick = () => ask.prefill(`「${list[+b.dataset.ask].key_phrase}」について：`)));
  }

  function drawPolished(fb, box) {
    const list = fb.polished;
    box.innerHTML = `
      ${fb.feedback_ja ? `<div class="feedback"><p>${esc(fb.feedback_ja)}</p></div>` : ''}
      ${phraseCards(list)}
      <div class="review-actions">
        <button class="btn btn-primary btn-lg" id="practice">🎙️ フレーズを使う練習をする</button>
      </div>`;
    bindPhraseCards(box, list);
    $('#practice', box).onclick = () => start(list);
  }

  function drawPracticeReview(talk, list) {
    const box = $('#review', el);
    box.innerHTML = `
      <div class="card review-card">
        <h2>練習おつかれさまでした！ 💪</h2>
        <p class="muted">${formatDuration(talk.durationSec)} 練習しました。今日のフレーズを単語帳に入れて、くり返し使ってみましょう。</p>
        ${phraseCards(list)}
        <div class="review-actions">
          <button class="btn btn-primary" id="again">🔁 もう一度練習する</button>
          ${backBtn}
        </div>
      </div>`;
    bindPhraseCards(box, list);
    $('#again', box).onclick = () => start(list);
    $('[data-back]', box).onclick = backToSetup;
  }

  async function polish(talk, count, target) {
    const transcript = talk.turns.map((t) => `${t.role === 'user' ? 'Learner' : 'Partner'}: ${t.text}`).join('\n');
    const str = { type: 'string' };
    const goal = talk.level === 'C2'
      ? 'even more polished, sophisticated and idiomatic, like an articulate educated native speaker'
      : `typical of a CEFR ${target} speaker (one step above their current level, ${talk.level})`;
    const r = await responsesJSON({
      instructions: `You are an experienced English teacher for Japanese learners. The learner's English level is CEFR ${talk.level}. Below is a transcript of their spoken conversation${talk.bookTitle ? ` about the book "${talk.bookTitle}"` : ''}.
Goal: help the learner move up to the next level by giving them EXACTLY ${count} polished ${count === 1 ? 'expression' : 'expressions'}.
1. polished: choose the ${count} LEARNER ${count === 1 ? 'line' : 'lines'} whose upgrade would help them most. For each:
   - you_said: what the learner said (short; you may trim it, and ignore speech-recognition glitches).
   - polished: the same idea rewritten so it is natural and ${goal}. One sentence, keep their meaning.
   - key_phrase: the reusable chunk inside "polished" that they should learn (a collocation, phrase or sentence frame that appears in "polished" word for word, e.g. "what struck me most was").
   - meaning_ja: concise Japanese meaning of key_phrase.
   - why_ja: one short Japanese sentence explaining why it sounds more ${talk.level === 'C2' ? 'refined' : target}.
   Choose different kinds of phrases; prefer ones they can reuse when talking about books. If the learner said very little, base it on what they were trying to say.
2. feedback_ja: one or two warm, specific sentences in Japanese about what went well.`,
      input: transcript,
      schemaName: 'polished_feedback',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['polished', 'feedback_ja'],
        properties: {
          polished: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['you_said', 'polished', 'key_phrase', 'meaning_ja', 'why_ja'], properties: { you_said: str, polished: str, key_phrase: str, meaning_ja: str, why_ja: str } } },
          feedback_ja: str,
        },
      },
    });
    r.polished = r.polished.slice(0, count);
    if (!r.polished.length) throw new Error('表現を作れませんでした');
    return r;
  }

  drawSetup();
  drawStage();
  drawDisplay();

  // Leaving the page mid-talk: close the session and keep what was said.
  return () => {
    closeAskBox();
    clearInterval(timer);
    if (live || state.status === 'paused') stop({ silent: true });
  };
}

// Drives the avatar's mouth from the partner's audio level.
export function createMeter() {
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
      const sync = lipSync(() => box.querySelector('.av'));
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length) / 128;
        smooth = smooth * 0.6 + Math.min(1, rms * 6) * 0.4;
        sync(Math.min(1, rms * 6));
        box.classList.toggle('speaking', smooth > 0.08);
        raf = requestAnimationFrame(tick);
      };
      tick();
    },
    stop() {
      cancelAnimationFrame(raf);
      document.querySelectorAll('.av.mouth-open').forEach((av) => av.classList.remove('mouth-open'));
      try { src?.disconnect(); } catch {}
      ctx.close();
    },
  };
}
