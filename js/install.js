// "Add to home screen". Android Chrome/Edge offer a real install prompt
// (beforeinstallprompt), so one tap installs the app. iPhone/iPad have no such API,
// so we show the Share → "ホーム画面に追加" steps instead.

import { $, openDialog, toast } from './util.js';

let deferred = null; // the saved beforeinstallprompt event
const listeners = new Set();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  toast('ホーム画面に追加しました', 'success');
  listeners.forEach((fn) => fn());
});

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isPhone = () => matchMedia('(max-width: 900px)').matches || 'ontouchstart' in window;

export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function installApp() {
  if (deferred) {
    const e = deferred;
    deferred = null;
    e.prompt();
    await e.userChoice.catch(() => null);
    listeners.forEach((fn) => fn());
    return;
  }
  showSteps();
}

const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

function showSteps() {
  const ios = isIOS();
  openDialog(`
    <div class="form">
      <h2>📲 ホーム画面に追加</h2>
      ${ios ? `
        <ol class="install-steps">
          <li>画面下（iPad は上）の <span class="key">${SHARE_ICON} 共有</span> ボタンをタップ</li>
          <li>メニューを下にスクロールして <span class="key">ホーム画面に追加</span> をタップ</li>
          <li>名前が「洋書トーク」になっていることを確かめて <span class="key">追加</span> をタップ</li>
        </ol>
        <p class="mini muted">Safari で開いているときの手順です。iPhone では、ホーム画面のアプリと Safari でデータ（本・単語・合言葉）が別々に保存されます。今のデータを使い続けるときは、「設定 › エクスポート」したファイルをアプリ側でインポートしてください。</p>`
      : `
        <ol class="install-steps">
          <li>ブラウザのメニュー <span class="key">⋮</span> をタップ</li>
          <li><span class="key">ホーム画面に追加</span> または <span class="key">アプリをインストール</span> をタップ</li>
          <li><span class="key">追加</span>（<span class="key">インストール</span>）をタップ</li>
        </ol>
        <p class="mini muted">Chrome では、このボタンからそのまま追加できることがあります。ボタンを押しても何も出ないときは、上の手順で追加してください。</p>`}
      <div class="actions"><button class="btn btn-primary" data-close>OK</button></div>
    </div>`);
}

// A dismissible banner for phones (books page), hidden once installed.
const DISMISS_KEY = 'yoshotalk:installDismissed';
export function installBanner(container) {
  const draw = () => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch {}
    if (isInstalled() || dismissed || !(isPhone() || deferred)) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="install-banner">
        <img src="assets/brand/app-icon-192.png" alt="">
        <p><b>洋書トーク</b>をホーム画面に追加すると、アプリのようにすぐ開けます。</p>
        <button class="btn btn-sm btn-primary" data-install>追加する</button>
        <button class="icon-btn" data-dismiss aria-label="閉じる">✕</button>
      </div>`;
    $('[data-install]', container).onclick = installApp;
    $('[data-dismiss]', container).onclick = () => {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
      draw();
    };
  };
  draw();
  return onInstallChange(draw);
}
