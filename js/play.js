import { $, $$, esc, shuffle, speak, today, addDays, toast } from './util.js';
import { data, addXP, levelInfo, currentStreak, review, isDue, isMastered } from './store.js';

export function renderPlay(el, [game]) {
  if (game === 'flash') return flashcards(el);
  if (game === 'quiz') return quiz(el);
  if (game === 'listen') return listening(el);
  dashboard(el);
}

// ---------------------------------------------------------------- dashboard
function badges() {
  const finished = data.books.filter((b) => b.status === 'finished').length;
  const talkMin = data.talks.reduce((a, t) => a + (t.durationSec || 0), 0) / 60;
  const mastered = data.vocab.filter(isMastered).length;
  const best = Math.max(data.stats.bestStreak || 0, currentStreak());
  return [
    ['📖', 'はじめの一冊', '本を1冊登録', data.books.length >= 1],
    ['📚', '本の虫', '5冊読了', finished >= 5],
    ['🏛️', '読書家', '20冊読了', finished >= 20],
    ['🎙️', '初トーク', 'アバターと1回トーク', data.talks.length >= 1],
    ['🗣️', 'おしゃべり上手', '合計60分トーク', talkMin >= 60],
    ['🗂️', '単語コレクター', '単語を50個登録', data.vocab.length >= 50],
    ['💎', '定着の達人', '10語をマスター', mastered >= 10],
    ['🔥', '7日連続', '7日連続で学習', best >= 7],
    ['🌋', '30日連続', '30日連続で学習', best >= 30],
  ];
}

function dashboard(el) {
  const { level, into, need } = levelInfo();
  const streak = currentStreak();
  const goal = data.settings.dailyGoal || 50;
  const todayXP = data.stats.log[today()] || 0;
  const week = [...Array(7)].map((_, i) => addDays(today(), i - 6));
  const maxXP = Math.max(goal, ...week.map((d) => data.stats.log[d] || 0));
  const due = data.vocab.filter(isDue).length;
  const pct = Math.min(100, (todayXP / goal) * 100);

  el.innerHTML = `
    <section class="hero"><div><h1>Learn &amp; Play</h1><p class="muted">ためた単語をゲームで定着させよう</p></div></section>
    <div class="stats-grid">
      <div class="card stat">
        <span class="stat-label">レベル</span>
        <span class="stat-big">Lv.${level}</span>
        <span class="bar"><span style="width:${(into / need) * 100}%"></span></span>
        <span class="mini muted">次のレベルまで ${need - into} XP（累計 ${data.stats.xp} XP）</span>
      </div>
      <div class="card stat">
        <span class="stat-label">連続学習</span>
        <span class="stat-big">🔥 ${streak}<small>日</small></span>
        <span class="mini muted">最高記録 ${Math.max(data.stats.bestStreak || 0, streak)} 日</span>
      </div>
      <div class="card stat">
        <span class="stat-label">今日の目標</span>
        <div class="ring" style="--p:${pct}"><span>${todayXP}<small>/${goal}</small></span></div>
        <span class="mini muted">${todayXP >= goal ? '達成！🎉' : `あと ${goal - todayXP} XP`}</span>
      </div>
      <div class="card stat">
        <span class="stat-label">この7日間</span>
        <div class="week">
          ${week.map((d) => `<div class="wk"><span class="wk-bar ${d === today() ? 'now' : ''}" style="height:${((data.stats.log[d] || 0) / maxXP) * 100}%" title="${data.stats.log[d] || 0} XP"></span><small>${'日月火水木金土'[new Date(d + 'T00:00:00').getDay()]}</small></div>`).join('')}
        </div>
      </div>
    </div>

    <h2 class="section-title">ゲーム</h2>
    <div class="game-grid">
      <a class="card game" href="#/play/flash">
        <span class="game-ico">🃏</span><h3>フラッシュカード</h3>
        <p class="muted mini">忘れかけた頃に出題される復習（間隔反復）</p>
        <span class="badge ${due ? 'st-reading' : 'st-finished'}">${due ? `今日の復習 ${due}` : '今日の復習は完了'}</span>
      </a>
      <a class="card game" href="#/play/quiz">
        <span class="game-ico">⚡</span><h3>スピードクイズ</h3>
        <p class="muted mini">4択でテンポよく。連続正解でコンボボーナス！</p>
        <span class="badge">10問</span>
      </a>
      <a class="card game" href="#/play/listen">
        <span class="game-ico">🎧</span><h3>リスニング＆スペル</h3>
        <p class="muted mini">音声を聞いてつづりを入力</p>
        <span class="badge">10問</span>
      </a>
    </div>

    <h2 class="section-title">バッジ</h2>
    <div class="badge-grid">
      ${badges().map(([ico, name, desc, got]) => `
        <div class="card bdg ${got ? 'got' : ''}" title="${desc}">
          <span class="bdg-ico">${ico}</span><b>${name}</b><small class="muted">${desc}</small>
        </div>`).join('')}
    </div>`;
}

function needWords(el, min) {
  if (data.vocab.length >= min) return false;
  el.innerHTML = `
    <a href="#/play" class="back">‹ 学習</a>
    <div class="empty-state small"><h2>単語が足りません</h2>
    <p>このゲームには単語が ${min} 個以上必要です（現在 ${data.vocab.length} 個）。トークや単語帳から追加しましょう。</p>
    <a class="btn btn-primary" href="#/words">単語帳へ</a></div>`;
  return true;
}

function finishScreen(el, { title, lines, xp, again }) {
  if (xp) addXP(xp, 'ゲームクリア');
  el.innerHTML = `
    <a href="#/play" class="back">‹ 学習</a>
    <div class="card finish">
      <div class="confetti">🎉</div>
      <h2>${title}</h2>
      ${lines.map((l) => `<p>${l}</p>`).join('')}
      <p class="xp-gain">+${xp} XP</p>
      <div class="actions-center">
        <a class="btn" href="#/play">学習トップへ</a>
        <button class="btn btn-primary" id="again">もう一度</button>
      </div>
    </div>`;
  $('#again', el).onclick = again;
}

// ---------------------------------------------------------------- flashcards (SRS)
function flashcards(el) {
  if (needWords(el, 1)) return;
  let practice = false;
  let queue = shuffle(data.vocab.filter(isDue)).slice(0, 20);
  if (!queue.length) {
    practice = true;
    queue = shuffle(data.vocab).slice(0, 10);
  }
  const total = queue.length;
  let done = 0;
  let correct = 0;
  let flipped = false;

  const intervalHint = (v, g) => {
    if (g === 0) return 'もう一度';
    const s = v.srs;
    const n = g === 1 ? Math.max(1, Math.round(s.interval * 1.2))
      : s.reps === 0 ? (g === 3 ? 3 : 1)
        : s.reps === 1 ? (g === 3 ? 6 : 3)
          : Math.round(s.interval * s.ease * (g === 3 ? 1.3 : 1));
    return `${n}日後`;
  };

  const draw = () => {
    const v = queue[0];
    if (!v) {
      finishScreen(el, {
        title: practice ? '練習おわり！' : '今日の復習完了！',
        lines: [`${total} 枚中 ${correct} 枚を覚えていました`],
        xp: done * 2 + 10,
        again: () => flashcards(el),
      });
      return;
    }
    el.innerHTML = `
      <a href="#/play" class="back">‹ 学習</a>
      <div class="game-head">
        <h2>🃏 フラッシュカード ${practice ? '<small class="muted">（練習モード）</small>' : ''}</h2>
        <span class="muted">${done} / ${total}</span>
      </div>
      <span class="bar"><span style="width:${(done / total) * 100}%"></span></span>
      <div class="flashcard ${flipped ? 'flipped' : ''}" id="card" tabindex="0">
        <div class="fc-inner">
          <div class="fc-face fc-front">
            <h2>${esc(v.term)}</h2>
            <button class="icon-btn" id="say" aria-label="発音">🔊</button>
            <p class="mini muted">タップ / スペースキーで裏返す</p>
          </div>
          <div class="fc-face fc-back">
            <h3>${esc(v.term)}</h3>
            <p class="meaning">${esc(v.meaning) || '<span class="muted">（意味未登録）</span>'}</p>
            ${v.example ? `<p class="example">${esc(v.example)}</p>` : ''}
          </div>
        </div>
      </div>
      <div class="grade ${flipped ? '' : 'hidden'}">
        ${[['もう一度', 0, 'g-again'], ['難しい', 1, 'g-hard'], ['覚えた', 2, 'g-good'], ['簡単', 3, 'g-easy']]
          .map(([l, g, c]) => `<button class="btn ${c}" data-g="${g}"><b>${l}</b><small>${practice ? '' : intervalHint(v, g)}</small><kbd>${g + 1}</kbd></button>`).join('')}
      </div>`;
    const flip = () => { flipped = !flipped; draw(); if (flipped) speak(v.term); };
    $('#card', el).onclick = (e) => { if (e.target.id !== 'say') flip(); };
    $('#say', el).onclick = () => speak(v.term);
    $$('[data-g]', el).forEach((b) => (b.onclick = () => grade(+b.dataset.g)));
    onKey = (e) => {
      if (e.code === 'Space') { e.preventDefault(); flip(); }
      if (flipped && ['1', '2', '3', '4'].includes(e.key)) grade(+e.key - 1);
    };
  };

  const grade = (g) => {
    const v = queue.shift();
    if (!practice) review(v.id, g);
    if (g === 0) queue.push(v);
    else { done++; if (g >= 2) correct++; }
    flipped = false;
    draw();
  };

  let onKey = null;
  const keyHandler = (e) => onKey?.(e);
  document.addEventListener('keydown', keyHandler);
  draw();
  return () => document.removeEventListener('keydown', keyHandler);
}

// ---------------------------------------------------------------- speed quiz
function quiz(el) {
  const pool = data.vocab.filter((v) => v.meaning);
  if (pool.length < 4) { needWords(el, 4); return; }
  const qs = shuffle(pool).slice(0, 10).map((v) => {
    const toJa = Math.random() < 0.6;
    const others = shuffle(pool.filter((x) => x.id !== v.id)).slice(0, 3);
    return { v, toJa, choices: shuffle([v, ...others]) };
  });
  let i = 0;
  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let correct = 0;
  let timer = null;
  let locked = false;
  const LIMIT = 10000;

  const draw = () => {
    const q = qs[i];
    if (!q) {
      finishScreen(el, {
        title: 'クイズ終了！',
        lines: [`正解 ${correct} / ${qs.length}`, `スコア <b>${score}</b> ・ 最大コンボ ${bestCombo}`],
        xp: correct * 2 + bestCombo,
        again: () => quiz(el),
      });
      return;
    }
    locked = false;
    el.innerHTML = `
      <a href="#/play" class="back">‹ 学習</a>
      <div class="game-head">
        <h2>⚡ スピードクイズ</h2>
        <span>${i + 1}/${qs.length} ・ <b>${score}</b>点 ${combo > 1 ? `<span class="combo">🔥${combo} combo</span>` : ''}</span>
      </div>
      <span class="bar timer"><span id="tbar"></span></span>
      <div class="card question">
        <p class="mini muted">${q.toJa ? '意味はどれ？' : '英語はどれ？'}</p>
        <h2>${esc(q.toJa ? q.v.term : q.v.meaning)}</h2>
      </div>
      <div class="choices">
        ${q.choices.map((c, k) => `<button class="btn choice" data-k="${k}"><kbd>${k + 1}</kbd> ${esc(q.toJa ? c.meaning : c.term)}</button>`).join('')}
      </div>`;
    if (q.toJa) speak(q.v.term);
    const start = performance.now();
    const tbar = $('#tbar', el);
    clearInterval(timer);
    timer = setInterval(() => {
      const left = 1 - (performance.now() - start) / LIMIT;
      tbar.style.width = `${Math.max(0, left) * 100}%`;
      if (left <= 0) answer(-1);
    }, 50);
    $$('[data-k]', el).forEach((b) => (b.onclick = () => answer(+b.dataset.k, performance.now() - start)));
  };

  const answer = (k, ms = LIMIT) => {
    if (locked) return;
    locked = true;
    clearInterval(timer);
    const q = qs[i];
    const right = q.choices.findIndex((c) => c.id === q.v.id);
    const ok = k === right;
    $$('[data-k]', el).forEach((b, idx) => {
      b.disabled = true;
      if (idx === right) b.classList.add('right');
      else if (idx === k) b.classList.add('wrong');
    });
    if (ok) {
      combo++;
      correct++;
      bestCombo = Math.max(bestCombo, combo);
      score += 100 + Math.round((1 - ms / LIMIT) * 50) + (combo - 1) * 20;
    } else {
      combo = 0;
    }
    setTimeout(() => { i++; draw(); }, ok ? 650 : 1500);
  };

  const keyHandler = (e) => { if (['1', '2', '3', '4'].includes(e.key)) $(`[data-k="${+e.key - 1}"]`, el)?.click(); };
  document.addEventListener('keydown', keyHandler);
  draw();
  return () => { clearInterval(timer); document.removeEventListener('keydown', keyHandler); };
}

// ---------------------------------------------------------------- listening & spelling
function listening(el) {
  if (needWords(el, 1)) return;
  if (!('speechSynthesis' in window)) {
    el.innerHTML = `<a href="#/play" class="back">‹ 学習</a><p class="empty">このブラウザは音声合成に対応していません。</p>`;
    return;
  }
  const qs = shuffle(data.vocab).slice(0, 10);
  let i = 0;
  let correct = 0;
  let hints = 0;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();

  const draw = () => {
    const v = qs[i];
    if (!v) {
      finishScreen(el, {
        title: 'リスニング終了！',
        lines: [`正解 ${correct} / ${qs.length}`],
        xp: correct * 3,
        again: () => listening(el),
      });
      return;
    }
    hints = 0;
    el.innerHTML = `
      <a href="#/play" class="back">‹ 学習</a>
      <div class="game-head"><h2>🎧 リスニング＆スペル</h2><span>${i + 1}/${qs.length} ・ 正解 ${correct}</span></div>
      <div class="card question">
        <div class="row center">
          <button class="btn btn-primary btn-lg" id="play">🔊 聞く</button>
          <button class="btn" id="slow">🐢 ゆっくり</button>
        </div>
        <p class="mini muted">ヒント：${esc(v.meaning) || '—'}</p>
        <form id="f" class="row">
          <input id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="聞こえた英語を入力">
          <button class="btn btn-primary">答える</button>
        </form>
        <p id="letters" class="mono"></p>
        <button class="btn btn-ghost btn-sm" id="hint">💡 文字ヒント</button>
        <div id="res"></div>
      </div>`;
    const play = (rate) => speak(v.term, rate);
    $('#play', el).onclick = () => play(0.95);
    $('#slow', el).onclick = () => play(0.6);
    $('#hint', el).onclick = () => {
      hints++;
      $('#letters', el).textContent = [...v.term].map((c, k) => (c === ' ' ? '  ' : k < hints ? c : '＿')).join('');
    };
    $('#f', el).onsubmit = (e) => {
      e.preventDefault();
      const ok = norm($('#ans', el).value) === norm(v.term);
      if (ok) correct++;
      $('#res', el).innerHTML = `
        <p class="${ok ? 'ok' : 'ng'}">${ok ? '⭕ 正解！' : '❌ 正解は'} <strong>${esc(v.term)}</strong></p>
        ${v.example ? `<p class="example">${esc(v.example)}</p>` : ''}
        <button class="btn btn-primary" id="next">次へ ›</button>`;
      $('#f', el).querySelector('button').disabled = true;
      $('#next', el).onclick = () => { i++; draw(); };
      $('#next', el).focus();
    };
    setTimeout(() => play(0.95), 300);
    $('#ans', el).focus();
  };
  draw();
  return () => speechSynthesis.cancel();
}
