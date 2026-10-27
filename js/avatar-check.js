// Avatar page (#/avatars): choose and audition each avatar's voice, see the
// eyes-closed / mouth-open overlays on top of the artwork, and nudge their position.
// Overlay tweaks are kept in this browser.

import { $, $$, esc, toast } from './util.js';
import { data, save } from './store.js';
import { ensurePasscode, relayPost } from './api.js';
import { AVATARS, VOICES, VOICE_PROMPTS, avatarHTML, overlayBoxes, getTweaks, setTweaks, lipSync, voiceFor } from './avatars.js';
import { LiveSession } from './live.js';
import { createMeter } from './talk.js';

const PARTS = { eyes: '目（閉じ）', mouth: '口（開き）' };

let preview = null; // the voice preview playing now: { live, meter, button, timers }
const FIELDS = ['x', 'y', 'w', 'h'];

export function renderAvatarCheck(el) {
  const timers = [];
  el.innerHTML = `
    <section class="hero"><div><h1>Avatars</h1><p class="muted">アバターの声と、瞬き・口パクの表示</p></div></section>
    ${Object.entries(AVATARS).map(([k, a]) => `
      <section class="card av-check" data-key="${k}">
        <div class="av-check-stage" data-stage></div>
        <div class="av-check-side">
          <h2>${esc(a.fullName)} <small class="muted">voice: ${a.voice}</small></h2>
          <p class="mini muted">${esc(a.profile)}</p>
          <div class="voice-box" data-voices></div>
          <h3 class="pick-title">表示の確認</h3>
          <div class="seg seg-sm" data-framing>
            <button data-f="view" class="on">バストアップ</button><button data-f="face">顔</button><button data-f="full">全体</button>
          </div>
          <div class="av-check-toggles">
            <label><input type="checkbox" data-t="eyes-closed"> 目を閉じる</label>
            <label><input type="checkbox" data-t="mouth-open"> 口を開ける</label>
            <label><input type="checkbox" data-t="auto" checked> 自動（瞬き＋口パク）</label>
            <label><input type="checkbox" data-t="boxes"> 重ねる範囲を表示</label>
          </div>
          ${Object.entries(PARTS).map(([part, label]) => `
            <fieldset class="av-nudge" data-part="${part}">
              <legend>${label}</legend>
              ${FIELDS.map((f) => `<label>${f}<input type="number" step="1" data-f="${f}"></label>`).join('')}
            </fieldset>`).join('')}
          <p class="mini muted">数値は元画像（1254×1254px）上の位置です。変更はこのブラウザのアプリ全体に反映されます。</p>
          <div class="row">
            <button class="btn btn-sm" data-copy>📋 数値をコピー</button>
            <button class="btn btn-sm btn-ghost" data-reset>元に戻す</button>
          </div>
        </div>
      </section>`).join('')}`;

  $$('.av-check', el).forEach((card) => {
    const key = card.dataset.key;
    const stage = $('[data-stage]', card);
    const opts = { framing: 'view', 'eyes-closed': false, 'mouth-open': false, auto: true, boxes: false };
    let sync = null;

    const draw = () => {
      stage.innerHTML = avatarHTML(key, { framing: opts.framing, background: opts.framing !== 'full' });
      const av = $('.av', stage);
      av.classList.toggle('eyes-closed', opts['eyes-closed']);
      av.classList.toggle('mouth-open', opts['mouth-open']);
      av.classList.toggle('no-blink', !opts.auto);
      av.classList.toggle('show-boxes', opts.boxes);
      sync = lipSync(av);
      const o = overlayBoxes(key);
      $$('.av-nudge', card).forEach((fs) => $$('input', fs).forEach((inp) => (inp.value = o[fs.dataset.part][inp.dataset.f])));
    };

    // Fake speech: bursts of syllables with pauses, so the mouth flaps like in a talk.
    let t = 0;
    timers.push(setInterval(() => {
      if (!opts.auto || opts['mouth-open']) return;
      t += 1;
      const speaking = t % 40 < 26;
      sync?.(speaking ? Math.random() * 0.4 : 0);
    }, 60));

    $$('[data-f]', $('[data-framing]', card)).forEach((b) => (b.onclick = () => {
      opts.framing = b.dataset.f;
      $$('[data-framing] button', card).forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }));
    $$('[data-t]', card).forEach((c) => (c.onchange = () => {
      opts[c.dataset.t] = c.checked;
      if (c.dataset.t === 'mouth-open' || c.dataset.t === 'auto') $('.av', stage).classList.remove('mouth-open');
      draw();
    }));
    $$('.av-nudge input', card).forEach((inp) => (inp.oninput = () => {
      const part = inp.closest('.av-nudge').dataset.part;
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      const all = getTweaks();
      all[key] = all[key] || {};
      all[key][part] = { ...overlayBoxes(key)[part], [inp.dataset.f]: v };
      setTweaks(all);
      draw();
    }));
    $('[data-reset]', card).onclick = () => {
      const all = getTweaks();
      delete all[key];
      setTweaks(all);
      draw();
      toast('元の位置に戻しました');
    };
    $('[data-copy]', card).onclick = async () => {
      const text = `${key}: ${JSON.stringify(overlayBoxes(key))}`;
      try { await navigator.clipboard.writeText(text); toast('コピーしました', 'success'); }
      catch { prompt('この数値をコピーしてください', text); }
    };
    draw();
    drawVoices(card, key, stage);
  });

  return () => {
    timers.forEach(clearInterval);
    stopPreview();
  };
}

// ---- voices

function drawVoices(card, key, stage) {
  const box = $('[data-voices]', card);
  const current = data.settings.voices?.[key] || AVATARS[key].voice;
  const customs = (data.settings.customVoices || []).filter((v) => v.avatar === key);
  const row = (id, title, sub, extra = '') => `
    <li class="voice-row ${id === current ? 'on' : ''}">
      <label><input type="radio" name="voice-${key}" value="${esc(id)}" ${id === current ? 'checked' : ''}>
        <span><b>${esc(title)}</b>${extra}<small>${esc(sub)}</small></span></label>
      <button class="btn btn-sm" data-play="${esc(id)}">▶ 試聴</button>
    </li>`;
  box.innerHTML = `
    <h3 class="pick-title">🎙️ 声</h3>
    <ul class="voice-list">
      ${customs.map((v) => row(v.id, v.name, 'オリジナルの声（イギリス英語）', ' <span class="badge">オリジナル</span>')).join('')}
      ${VOICES.map((v) => row(v.id, v.label, `${v.sex}・${v.accent}`, AVATARS[key].voice === v.id ? ' <span class="badge">デフォルト</span>' : '')).join('')}
    </ul>
    <details class="voice-make">
      <summary>＋ 説明文からオリジナルの声を作る</summary>
      <p class="mini muted">声の特徴を英語で書くと、GPT-Live 用の声が作られます（作成は無料、試聴とトークは通常の会話料金）。下はイギリス英語の${esc(AVATARS[key].name)}向けの例です。</p>
      <form class="form-inline" data-make>
        <input name="name" maxlength="60" value="${esc(AVATARS[key].name)} (British)" placeholder="声の名前">
        <textarea name="prompt" rows="5" maxlength="2000">${esc(VOICE_PROMPTS[key] || '')}</textarea>
        <button class="btn btn-primary btn-sm">声を作る</button>
      </form>
    </details>`;

  $$('input[type=radio]', box).forEach((r) => (r.onchange = () => {
    data.settings.voices = { ...data.settings.voices, [key]: r.value };
    save();
    toast(`${AVATARS[key].name} の声を ${voiceFor(key).label} にしました`, 'success');
    drawVoices(card, key, stage);
  }));
  $$('[data-play]', box).forEach((b) => (b.onclick = () => playPreview(key, b.dataset.play, b, stage)));
  $('[data-make]', box).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    if (!(await ensurePasscode())) return;
    btn.disabled = true;
    btn.textContent = '作成中…';
    try {
      const res = await relayPost('/voices', { name: String(fd.get('name')).trim(), prompt: String(fd.get('prompt')).trim() });
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('中継サーバーの更新が必要です（npx wrangler deploy）。');
      if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
      data.settings.customVoices = [...(data.settings.customVoices || []), { id: j.id, name: j.name, prompt: j.prompt || String(fd.get('prompt')), avatar: key }];
      save();
      toast('声を作りました。「▶ 試聴」で聞いてみてください', 'success');
      drawVoices(card, key, stage);
    } catch (err) {
      toast(`声を作れませんでした: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = '声を作る';
    }
  };
}

// A short GPT-Live session in which the avatar introduces itself in the chosen voice.
async function playPreview(key, voiceId, button, stage) {
  const wasMine = preview?.button === button;
  stopPreview();
  if (wasMine) return;
  if (!(await ensurePasscode())) return;
  const a = AVATARS[key];
  const custom = (data.settings.customVoices || []).find((v) => v.id === voiceId);
  const p = { button, timers: [] };
  preview = p;
  button.textContent = '接続中…';
  p.meter = createMeter();
  let lastSpeech = 0;
  p.live = new LiveSession({
    session: {
      model: 'gpt-live-1',
      instructions: `You are ${a.persona}\n${a.accent}${custom ? `\nYour voice: ${custom.prompt}` : ''}
This is a short voice preview, not a conversation. When asked, introduce yourself in two or three short sentences (your name and one favourite novel), then stop.`,
      audio: { output: { voice: custom ? { id: custom.id } : voiceId } },
    },
    onStatus: (st) => {
      if (preview !== p) return;
      if (st === 'live') {
        button.textContent = '■ 停止';
        p.live.setMuted(true);
        p.live.send({ type: 'session.commentary.append', event_id: `hello_${Date.now()}`, delegation_id: null, content: 'Introduce yourself now.' });
        lastSpeech = Date.now() + 3000; // allow a moment before the first words
        // Stop after the introduction has finished (a few seconds of quiet), or after 30 s.
        p.timers.push(setInterval(() => { if (Date.now() - lastSpeech > 3500) stopPreview(); }, 500));
        p.timers.push(setTimeout(stopPreview, 30000));
      } else if (st === 'lost') stopPreview();
    },
    onRemoteStream: (stream) => p.meter.attach(stream, stage),
    onEvent: (ev) => {
      if (ev.type === 'session.output_transcript.delta') lastSpeech = Date.now();
      if (ev.type === 'error') toast(`エラー: ${ev.error?.message || '不明なエラー'}`, 'error');
    },
  });
  try {
    await p.live.start();
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'マイクの使用が許可されていません。' : err.message, 'error');
    stopPreview();
  }
}

function stopPreview() {
  const p = preview;
  if (!p) return;
  preview = null;
  p.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  p.button.textContent = '▶ 試聴';
  p.live?.close(1500);
  p.meter?.stop();
}
