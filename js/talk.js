import { $, $$, esc, formatDuration, toast } from './util.js';
import { data, save, getApiKey, getBook, addVocab, addTalk, addXP } from './store.js';
import { AVATARS, avatarSVG } from './avatars.js';
import { LiveSession, responsesJSON } from './live.js';

export const MODES = {
  impressions: { label: '感想を話す', en: 'Share overall impressions, favourite scenes and how the book made the learner feel.' },
  characters: { label: '登場人物について', en: 'Discuss the characters: their motivations, how they change, and who the learner relates to.' },
  themes: { label: 'テーマを深掘り', en: 'Explore the themes and messages of the book and connect them to the learner\'s own life and society.' },
  retell: { label: 'あらすじを説明', en: 'Have the learner retell the story in their own words. Help them structure it (beginning, turning point, ending) with gentle prompts.' },
  free: { label: 'フリートーク', en: 'Chat freely about reading, books, and anything the learner wants to talk about.' },
};

const LEVELS = {
  A2: 'A2 (elementary): very short simple sentences, common words, speak slowly',
  B1: 'B1 (intermediate): clear everyday language, explain any less common word',
  B2: 'B2 (upper-intermediate): natural speed and idioms, occasionally explain nuance',
  C1: 'C1 (advanced): natural native-like discussion, challenge their ideas',
};

let live = null;

function buildInstructions(book, modeKey, avatarKey, level) {
  const a = AVATARS[avatarKey];
  const bookPart = book
    ? `The book: "${book.title}"${book.author ? ` by ${book.author}` : ''}. ${book.status === 'finished'
      ? 'The learner has finished it.'
      : 'The learner has NOT finished it yet — do not spoil anything beyond what they mention.'}${book.memo ? ` Learner's own notes (may be Japanese): ${book.memo}` : ''}`
    : 'No specific book was chosen.';
  return `You are ${a.name}, an English conversation partner in "Yosho Talk" (洋書トーク), a learning app linked to the YouTube show "Yosho Radio" (洋書ラジオ), where two English teachers talk about English-language books.
Personality: ${a.persona}.
The learner is a Japanese speaker. Level: ${LEVELS[level]}.
${bookPart}
Focus for today: ${MODES[modeKey].en}

How to talk:
- Speak only English, except a few Japanese words if the learner is really stuck.
- Keep each turn short (1-3 sentences) and usually end with one open question. Let the learner do most of the talking.
- Show real interest and react to what they say; share your own opinion briefly sometimes.
- When the learner makes a meaningful mistake, recast it naturally ("Oh, you mean ...?") instead of lecturing.
- When they struggle to express an idea, offer one useful word or phrase.
- If they ask you to save or remember a word or phrase, delegate it so it is saved to their word book, then confirm briefly.
- Open with a friendly greeting and one easy question about the book.`;
}

const BACKEND_INSTRUCTIONS = `You are the backend helper for "Yosho Talk", an English book-discussion app for Japanese learners.
When the learner wants a word or phrase saved, call save_vocabulary once per item with: the term in its dictionary/base form, a concise natural Japanese meaning, and a short natural English example sentence (ideally connected to the book or conversation).
For factual questions about a book or author, answer briefly and avoid spoilers. Keep answers short and plain so they can be spoken aloud.`;

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

export function renderTalk(el, [bookIdParam]) {
  const s = data.settings;
  const state = {
    bookId: bookIdParam || data.books.find((b) => b.status === 'reading')?.id || data.books[0]?.id || '',
    mode: 'impressions',
    avatar: s.avatar,
    level: s.level,
    status: 'idle',
    turns: [],
    saved: [],
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
        <div class="card transcript-card">
          <div class="transcript" id="transcript">
            <p class="muted mini placeholder">「トークを始める」を押すと、マイクがオンになります。<br>英語で話しかけてみましょう。言いたい単語が分からなければ “How do you say … in English?” と聞いてもOK。<br>「Can you save that word?」と頼むと単語帳に保存されます。</p>
          </div>
        </div>
        <div id="review"></div>
      </div>
    </section>`;

  const setup = $('#setup', el);
  const transcriptEl = $('#transcript', el);

  function drawSetup() {
    const locked = state.status !== 'idle';
    setup.innerHTML = `
      <h2>トークの準備</h2>
      <label>本
        <select id="selBook" ${locked ? 'disabled' : ''}>
          ${data.books.map((b) => `<option value="${b.id}" ${b.id === state.bookId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
          <option value="" ${!state.bookId ? 'selected' : ''}>（本を選ばない）</option>
        </select>
      </label>
      <label>テーマ
        <select id="selMode" ${locked ? 'disabled' : ''}>
          ${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${k === state.mode ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </label>
      <label>英語レベル
        <select id="selLevel" ${locked ? 'disabled' : ''}>
          ${Object.keys(LEVELS).map((k) => `<option ${k === state.level ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
      </label>
      <div class="avatar-pick">
        ${Object.entries(AVATARS).map(([k, a]) => `
          <button class="avatar-opt ${k === state.avatar ? 'on' : ''}" data-av="${k}" ${locked ? 'disabled' : ''}>
            ${avatarSVG(k)}<span><b>${a.name}</b><small>${a.tagline}</small></span>
          </button>`).join('')}
      </div>
      <div class="saved-box">
        <h3>このトークで保存した語 <small class="muted">${state.saved.length}</small></h3>
        <ul class="chips">${state.saved.map((v) => `<li title="${esc(v.meaning)}">${esc(v.term)}</li>`).join('') || '<li class="muted mini plain">まだありません</li>'}</ul>
      </div>`;
    if (locked) return;
    $('#selBook', setup).onchange = (e) => (state.bookId = e.target.value);
    $('#selMode', setup).onchange = (e) => (state.mode = e.target.value);
    $('#selLevel', setup).onchange = (e) => { state.level = e.target.value; s.level = state.level; save(); };
    $$('[data-av]', setup).forEach((b) => (b.onclick = () => {
      state.avatar = b.dataset.av;
      s.avatar = state.avatar;
      save();
      drawSetup();
      drawStage();
    }));
  }

  function drawStage() {
    const a = AVATARS[state.avatar];
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
      $('#hint', c).onclick = () => appendInstruction('The learner pressed the HINT button: they are stuck. Rephrase your last question more simply and give two short example sentence starters they could use.');
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

  function addTranscript(role, delta) {
    if (!delta) return;
    $('.placeholder', transcriptEl)?.remove();
    let last = state.turns[state.turns.length - 1];
    if (!last || last.role !== role) {
      last = { role, text: '' };
      state.turns.push(last);
      const p = document.createElement('p');
      p.className = `line ${role}`;
      p.innerHTML = `<b>${role === 'user' ? 'You' : esc(AVATARS[state.avatar].name)}</b> <span></span>`;
      transcriptEl.appendChild(p);
    }
    last.text += delta;
    transcriptEl.lastElementChild.querySelector('span').textContent = last.text;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  async function start() {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast('先に「設定」で OpenAI API キーを入力してください', 'error');
      location.hash = '#/settings';
      return;
    }
    const book = getBook(state.bookId);
    state.turns = [];
    state.saved = [];
    state.muted = false;
    transcriptEl.innerHTML = '';
    $('#review', el).innerHTML = '';
    state.status = 'connecting';
    drawSetup();
    drawStage();

    meter = createMeter();
    live = new LiveSession({
      apiKey,
      apiBase: s.apiBase,
      session: {
        model: 'gpt-live-1',
        instructions: buildInstructions(book, state.mode, state.avatar, state.level),
        audio: { output: { voice: AVATARS[state.avatar].voice } },
        delegation: {
          type: 'responses',
          responses: {
            model: s.backendModel,
            instructions: BACKEND_INSTRUCTIONS,
            tools: [SAVE_TOOL],
            tool_choice: 'auto',
            parallel_tool_calls: false,
          },
        },
      },
      onStatus: (st) => {
        if (st === 'live' && state.status !== 'live') {
          state.startedAt = Date.now();
          timer = setInterval(() => ($('#clock', el).textContent = formatDuration((Date.now() - state.startedAt) / 1000)), 1000);
        }
        if (st === 'ended' && state.status === 'ending') return;
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
      onFunctionCall: (name, args) => {
        if (name !== 'save_vocabulary') return { ok: false, error: 'unknown function' };
        const v = addVocab({ term: args.term, meaning: args.meaning_ja, example: args.example_en, note: args.note_ja, bookId: state.bookId || null, source: 'talk' });
        if (v && !state.saved.includes(v)) state.saved.push(v);
        drawSetup();
        return { ok: true, saved: args.term };
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
      apiKey: getApiKey(),
      apiBase: s.apiBase,
      model: s.backendModel,
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
