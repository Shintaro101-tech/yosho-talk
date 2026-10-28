// Calls to the relay server (Cloudflare Worker). With accounts (cloud.js) each call
// carries the login token and the relay applies the account's monthly allowance;
// without them, a shared passcode is asked once and remembered in this browser.

import { WORKER_URL } from './config.js';
import { openDialog, esc, toast } from './util.js';
import { CLOUD, signedIn, hasAccess, getToken, redeem } from './cloud.js';

const KEY_PASS = 'yoshotalk:passcode';
export const getPasscode = () => localStorage.getItem(KEY_PASS) || '';
export const setPasscode = (p) => (p ? localStorage.setItem(KEY_PASS, p) : localStorage.removeItem(KEY_PASS));

function base() {
  if (!WORKER_URL) throw new Error('中継サーバーのURLが設定されていません（js/config.js）。');
  return WORKER_URL.replace(/\/$/, '');
}

// Returns 'ok' | 'wrong' | 'error:<message>'
export async function checkPasscode(pass) {
  try {
    const res = await fetch(`${base()}/check`, { headers: { 'X-Passcode': pass } });
    if (res.ok) return 'ok';
    if (res.status === 401) return 'wrong';
    const j = await res.json().catch(() => ({}));
    return `error:${j.error?.message || `HTTP ${res.status}`}`;
  } catch (err) {
    return `error:中継サーバーに接続できませんでした（${err.message}）`;
  }
}

// True when relay features (talk, feedback, dictionary…) can be used right now.
export const relayReady = () => (CLOUD ? signedIn() && hasAccess() : Boolean(getPasscode()));
// Photo search is free, so every signed-in account may use it.
export const relayOpen = () => (CLOUD ? signedIn() : Boolean(getPasscode()));

// Makes sure relay features can be used: with accounts, a login and a plan (an invite
// code for now); otherwise a valid passcode. Resolves true when ready, false if not.
export async function ensurePasscode(message = '', force = false) {
  if (CLOUD) return ensureAccess();
  if (getPasscode() && !message && !force) return true;
  return new Promise((resolve) => {
    let ok = false;
    const dlg = openDialog(`
      <form class="form">
        <h2>🔒 合言葉を入力</h2>
        <p class="mini muted">トーク機能を使うための合言葉です。一度入力すると、このブラウザに記憶されます。</p>
        ${message ? `<p class="mini ng">${esc(message)}</p>` : ''}
        <input name="pass" type="password" required autocomplete="current-password" placeholder="合言葉">
        <p class="mini ng" id="passErr"></p>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
          <button class="btn btn-primary">OK</button>
        </div>
      </form>`, {
      onOpen: (d) => d.querySelector('input').focus(),
      onSubmit: async (fd, form) => {
        const pass = String(fd.get('pass')).trim();
        const btn = form.querySelector('.btn-primary');
        btn.disabled = true;
        const r = await checkPasscode(pass);
        btn.disabled = false;
        if (r === 'ok') { setPasscode(pass); ok = true; return true; }
        form.querySelector('#passErr').textContent = r === 'wrong' ? '合言葉が違います。' : r.slice(6);
        return false;
      },
    });
    dlg.addEventListener('close', () => resolve(ok), { once: true });
  });
}

async function ensureAccess() {
  if (!signedIn()) {
    toast('ログインしてください');
    location.hash = '#/login';
    return false;
  }
  if (hasAccess()) return true;
  return new Promise((resolve) => {
    let ok = false;
    const dlg = openDialog(`
      <form class="form">
        <h2>🎟️ 招待コードを入力</h2>
        <p class="mini muted">トーク・フィードバック・辞書などは、招待コードを入力すると使えるようになります。</p>
        <input name="code" required autocomplete="off" autocapitalize="off" placeholder="招待コード">
        <p class="mini ng" id="codeErr"></p>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
          <button class="btn btn-primary">OK</button>
        </div>
      </form>`, {
      onOpen: (d) => d.querySelector('input').focus(),
      onSubmit: async (fd, form) => {
        const btn = form.querySelector('.btn-primary');
        btn.disabled = true;
        try {
          await redeem(String(fd.get('code')).trim());
          ok = hasAccess();
          toast('使えるようになりました！', 'success');
          return true;
        } catch (err) {
          form.querySelector('#codeErr').textContent = err.message;
          return false;
        } finally {
          btn.disabled = false;
        }
      },
    });
    dlg.addEventListener('close', () => resolve(ok), { once: true });
  });
}

async function headers() {
  if (CLOUD) {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  return { 'X-Passcode': getPasscode() };
}

export async function relayGet(path) {
  return fetch(`${base()}${path}`, { headers: await headers() });
}

// POST JSON to the relay. Re-asks the passcode once if it was rejected.
export async function relayPost(path, body) {
  const send = async () => fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await headers()) },
    body: JSON.stringify(body),
  });
  let res;
  try {
    res = await send();
    if (res.status === 401 && CLOUD) {
      location.hash = '#/login';
      throw new Error('ログインの有効期限が切れました。もう一度ログインしてください。');
    }
    if (res.status === 401) {
      setPasscode('');
      if (!(await ensurePasscode('合言葉が変更されたようです。もう一度入力してください。'))) throw new Error('合言葉が入力されませんでした。');
      res = await send();
    }
  } catch (err) {
    if (err instanceof TypeError) throw new Error('中継サーバーに接続できませんでした。ネットワークを確認してください。');
    throw err;
  }
  return res;
}
