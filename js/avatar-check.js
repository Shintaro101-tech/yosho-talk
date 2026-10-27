// Avatar check page (#/avatars): see the eyes-closed / mouth-open overlays on top of
// the base artwork, and nudge their position. Tweaks are kept in this browser.

import { $, $$, esc, toast } from './util.js';
import { AVATARS, avatarHTML, overlayBoxes, getTweaks, setTweaks, lipSync } from './avatars.js';

const PARTS = { eyes: '目（閉じ）', mouth: '口（開き）' };
const FIELDS = ['x', 'y', 'w', 'h'];

export function renderAvatarCheck(el) {
  const timers = [];
  el.innerHTML = `
    <section class="hero"><div><h1>Avatars</h1><p class="muted">アバターの表示確認（瞬き・口パクのオーバーレイ）</p></div></section>
    ${Object.entries(AVATARS).map(([k, a]) => `
      <section class="card av-check" data-key="${k}">
        <div class="av-check-stage" data-stage></div>
        <div class="av-check-side">
          <h2>${esc(a.fullName)} <small class="muted">voice: ${a.voice}</small></h2>
          <p class="mini muted">${esc(a.profile)}</p>
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
  });

  return () => timers.forEach(clearInterval);
}
