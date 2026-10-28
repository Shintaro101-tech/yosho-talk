// Accounts (Supabase): login, and keeping books, words, talks and settings in the
// account so they are the same on every device. Used only when SUPABASE_URL and
// SUPABASE_ANON_KEY are set in config.js; otherwise the app keeps everything in this
// browser and uses the passcode, as before.
//
// The browser's copy (localStorage) stays the working copy. After each change the
// changed items are sent to Supabase; on start (and when the app comes back to the
// front) the account's rows are read back. "synced" remembers what Supabase has, so
// only real changes are sent.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { data, replaceData, onChange, TALK_DRAFT_KEY } from './store.js';
import { relayPost, relayGet } from './api.js';
import { toast } from './util.js';

export const CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const OWNER_KEY = 'yoshotalk:owner'; // the account this browser's data belongs to
const SYNCED_KEY = 'yoshotalk:synced'; // { "kind:id": hash } of what Supabase has
const KINDS = [['book', 'books'], ['vocab', 'vocab'], ['talk', 'talks']];

let sb = null;
let session = null;
let account = null; // { email, plan, label, limits, usage } from the relay
let applying = false; // true while server data is being put into the app
let pushTimer = null;
let lastPull = 0;

export const signedIn = () => Boolean(session);
export const currentAccount = () => account;
export const userEmail = () => session?.user?.email || '';
// Talk, feedback, dictionary… are available (a trial or paid plan).
export const hasAccess = () => Boolean(account && account.limits.talk_minutes + account.limits.dict_calls > 0);
// The question chat, dictionary… (not on the free plan, so they aren't shown there).
export const canUseAI = () => !CLOUD || (account ? account.limits.ask_calls : data.usage?.askLimit ?? 0) > 0;

export async function getToken() {
  if (!sb) return null;
  const { data: d } = await sb.auth.getSession();
  session = d.session;
  return session?.access_token || null;
}

// Before the first page is drawn: restore the login and load the account's data.
export async function initCloud() {
  if (!CLOUD) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'SIGNED_OUT') account = null;
    // Opened from a password reset email: choose the new password now.
    if (event === 'PASSWORD_RECOVERY') setTimeout(askNewPassword, 300);
  });
  onChange(() => { if (!applying && session) schedulePush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session && Date.now() - lastPull > 60_000) refresh();
  });
  if (session) await afterLogin().catch((err) => console.warn('sync', err));
}

// ---------------------------------------------------------------- login

export async function signUp(email, password, name) {
  const { data: d, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } });
  if (error) throw new Error(authMessage(error));
  session = d.session;
  if (!session) return 'confirm'; // the project asks new accounts to confirm their email first
  data.settings.userName ||= name;
  await afterLogin();
  return 'ok';
}

export async function signIn(email, password) {
  const { data: d, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authMessage(error));
  session = d.session;
  await afterLogin();
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#/settings` });
  if (error) throw new Error(authMessage(error));
}

export async function setPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(authMessage(error));
}

async function askNewPassword() {
  for (;;) {
    const p = prompt('新しいパスワードを入力してください（6文字以上）');
    if (p === null) return;
    try {
      await setPassword(p);
      toast('パスワードを変更しました', 'success');
      return;
    } catch (err) { alert(err.message); }
  }
}

export async function signOut() {
  await pushNow().catch(() => {});
  await sb.auth.signOut();
  session = null;
  account = null;
  forgetLocal();
}

export async function deleteAccount() {
  const res = await relayPost('/account/delete', {});
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || `HTTP ${res.status}`);
  await sb.auth.signOut().catch(() => {});
  session = null;
  account = null;
  forgetLocal();
}

export async function redeem(code) {
  const res = await relayPost('/redeem', { code });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  setAccount(j);
}

// Talk time for the relay to count. The meter in the app is updated only with the last
// report of a talk (apply), since the talk screen counts the running talk itself.
export async function reportTalk(seconds, apply = false) {
  if (!CLOUD || !session || !(seconds > 0)) return;
  const res = await relayPost('/usage/talk', { seconds: Math.round(seconds) });
  if (res.ok && apply) setAccount(await res.json());
}

export async function refreshAccount() {
  const res = await relayGet('/me');
  if (res.ok) setAccount(await res.json());
}

// The relay's view of this month's use becomes the app's talk-time meter.
export function setAccount(a) {
  account = a;
  applying = true;
  data.usage = { month: a.month, seconds: a.usage.talk_seconds, limitMin: a.limits.talk_minutes, askLimit: a.limits.ask_calls, plan: a.plan, label: a.label };
  replaceData(data);
  applying = false;
}

function authMessage(error) {
  const m = String(error.message || error);
  if (/invalid login credentials/i.test(m)) return 'メールアドレスかパスワードが違います。';
  if (/already registered|already exists/i.test(m)) return 'このメールアドレスはすでに登録されています。ログインしてください。';
  if (/password should be at least/i.test(m)) return 'パスワードは6文字以上にしてください。';
  if (/email not confirmed/i.test(m)) return 'メールアドレスの確認がまだです。届いたメールのリンクを開いてください。';
  if (/rate limit|too many/i.test(m)) return '短時間に何度も試したため、しばらく待ってからお試しください。';
  if (/invalid.*email|unable to validate email/i.test(m)) return 'メールアドレスの形が正しくありません。';
  return m;
}

// ---------------------------------------------------------------- sync

async function afterLogin() {
  const uid = session.user.id;
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner && owner !== uid) forgetLocal(); // another account's data was here
  const hadLocal = !owner && (data.books.length || data.vocab.length || data.talks.length);
  const remote = await pullRows();
  if (!owner && hadLocal) {
    // This browser's data from before accounts existed.
    const empty = !remote.items.length;
    const move = confirm(empty
      ? 'このブラウザに保存されている本・単語・トークの記録を、このアカウントに移しますか？\n（移さない場合、このブラウザのデータは消えます。先にエクスポートしておくこともできます）'
      : 'このブラウザに、アカウントにまだないデータ（本・単語・トーク）があります。アカウントに追加しますか？');
    localStorage.setItem(OWNER_KEY, uid);
    if (move) {
      apply(remote, { keepLocal: true });
      await pushNow();
    } else apply(remote);
  } else {
    if (owner === uid) await pushNow().catch(() => {}); // changes made here while offline
    localStorage.setItem(OWNER_KEY, uid);
    apply(await pullRows());
  }
  lastPull = Date.now();
  await refreshAccount().catch(() => {});
}

// Reads the profile and every item of this account (1000 rows per request).
async function pullRows() {
  const items = [];
  for (let from = 0; ; from += 1000) {
    const { data: rows, error } = await sb.from('items').select('kind,id,doc').order('kind').order('id').range(from, from + 999);
    if (error) throw error;
    items.push(...rows);
    if (rows.length < 1000) break;
  }
  const { data: profile } = await sb.from('profiles').select('name,settings').eq('id', session.user.id).maybeSingle();
  return { items, profile };
}

// Puts the account's data into the app. keepLocal: also keep items only this browser has.
function apply({ items, profile }, { keepLocal = false } = {}) {
  const next = { books: [], vocab: [], talks: [] };
  const synced = {};
  for (const row of items) {
    const list = KINDS.find(([k]) => k === row.kind)?.[1];
    if (!list) continue;
    next[list].push(row.doc);
    synced[`${row.kind}:${row.id}`] = hash(row.doc);
  }
  if (keepLocal) {
    for (const [, list] of KINDS) for (const it of data[list]) if (!next[list].some((x) => x.id === it.id)) next[list].push(it);
  }
  // Newest first, as the app lists them.
  for (const [, list] of KINDS) next[list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const settings = { ...data.settings, ...(profile?.settings || {}) };
  if (profile?.name && !settings.userName) settings.userName = profile.name;
  synced['settings:'] = hash(profile?.settings || {});
  applying = true;
  replaceData({ ...data, ...next, settings });
  applying = false;
  saveSynced(synced);
}

async function refresh() {
  try {
    await pushNow();
    const before = JSON.stringify([data.books, data.vocab, data.talks]);
    apply(await pullRows());
    lastPull = Date.now();
    await refreshAccount();
    // Redraw the page if another device changed something (not in the middle of a talk).
    if (JSON.stringify([data.books, data.vocab, data.talks]) !== before && !location.hash.startsWith('#/talk')) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  } catch (err) { console.warn('sync', err); }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow().catch((err) => {
    console.warn('sync', err);
    toast('アカウントへの保存に失敗しました。通信が戻ったら自動で保存します。', 'error');
  }), 1500);
}

// Sends what changed since the last sync: new/edited items, deleted items, settings.
export async function pushNow() {
  clearTimeout(pushTimer);
  if (!session) return;
  const uid = session.user.id;
  const synced = loadSynced();
  const next = { ...synced };
  const upserts = [];
  const deletes = [];
  for (const [kind, list] of KINDS) {
    const ids = new Set();
    for (const doc of data[list]) {
      const key = `${kind}:${doc.id}`;
      ids.add(key);
      const h = hash(doc);
      if (synced[key] !== h) { upserts.push({ user_id: uid, kind, id: doc.id, doc, updated_at: new Date().toISOString() }); next[key] = h; }
    }
    for (const key of Object.keys(synced)) {
      if (key.startsWith(`${kind}:`) && !ids.has(key)) { deletes.push([kind, key.slice(kind.length + 1)]); delete next[key]; }
    }
  }
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await sb.from('items').upsert(upserts.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
    if (error) throw error;
  }
  for (const [kind] of KINDS) {
    const ids = deletes.filter(([k]) => k === kind).map(([, id]) => id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from('items').delete().eq('kind', kind).in('id', ids.slice(i, i + 200));
      if (error) throw error;
    }
  }
  const settings = syncedSettings();
  const sh = hash(settings);
  if (synced['settings:'] !== sh) {
    const { error } = await sb.from('profiles').update({ settings, name: settings.userName || '' }).eq('id', uid);
    if (error) throw error;
    next['settings:'] = sh;
  }
  saveSynced(next);
}

// Settings worth keeping in the account (everything the learner chose).
const syncedSettings = () => ({ ...data.settings });

// Also the dictionary's history and photo searches, so the next person on this device
// doesn't see them.
function forgetLocal() {
  localStorage.removeItem(OWNER_KEY);
  localStorage.removeItem(SYNCED_KEY);
  localStorage.removeItem('yoshotalk:dict');
  localStorage.removeItem('yoshotalk:images');
  localStorage.removeItem(TALK_DRAFT_KEY);
  applying = true;
  replaceData(null);
  applying = false;
}

function loadSynced() {
  try { return JSON.parse(localStorage.getItem(SYNCED_KEY)) || {}; } catch { return {}; }
}
function saveSynced(s) {
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify(s)); } catch { /* full */ }
}

// A short fingerprint of an item (FNV-1a), to tell whether it changed.
function hash(obj) {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
