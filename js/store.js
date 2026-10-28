// The app's data, kept in this browser's localStorage. With accounts (cloud.js) it is
// also kept in the account; without them, 設定 > エクスポート backs it up.

import { uid, today, toast } from './util.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const KEY = 'yoshotalk:data:v1';

function fresh() {
  return {
    books: [],
    vocab: [],
    talks: [],
    stats: { xp: 0, streak: 0, lastActive: null, log: {} },
    settings: {
      avatar: 'emma',
      level: 'B1',
    },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const f = fresh();
      return { ...f, ...d, stats: { ...f.stats, ...d.stats }, settings: { ...f.settings, ...d.settings } };
    }
  } catch (e) {
    console.error(e);
  }
  return fresh();
}

export const data = load();
const listeners = new Set();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    toast('保存に失敗しました（ストレージがいっぱいかもしれません）', 'error');
  }
  listeners.forEach((fn) => fn());
}
export const onChange = (fn) => listeners.add(fn);

// Replaces everything (an account's data after login, or nothing after logout).
export function replaceData(d) {
  if (d !== data) {
    const f = fresh();
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, f, d || {}, { settings: { ...f.settings, ...(d?.settings || {}) } });
  }
  save();
}

// ---------- Monthly talk time ----------
// Talk time is capped per calendar month (resets on the 1st) to keep API costs predictable.
// With accounts, the relay counts it and the limit comes from the account's plan.
export const TALK_LIMIT_MIN = 60;
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function talkUsage() {
  const u = data.usage?.month === monthKey() ? data.usage : { seconds: 0 };
  const limit = (CLOUD ? data.usage?.limitMin ?? 0 : TALK_LIMIT_MIN) * 60;
  const now = new Date();
  const reset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { used: u.seconds, limit, left: Math.max(0, limit - u.seconds), resetLabel: `${reset.getMonth() + 1}月1日` };
}

export function addTalkSeconds(sec) {
  if (!(sec > 0) || CLOUD) return; // with accounts, the relay keeps the count
  const month = monthKey();
  const seconds = (data.usage?.month === month ? data.usage.seconds : 0) + Math.round(sec);
  data.usage = { month, seconds };
  save();
}

// ---------- Books ----------
export function addBook(b) {
  const book = { id: uid(), createdAt: Date.now(), status: 'reading', rating: 0, memo: '', ...b };
  data.books.unshift(book);
  save();
  return book;
}
export function updateBook(id, patch) {
  const b = data.books.find((x) => x.id === id);
  if (!b) return;
  Object.assign(b, patch);
  save();
}
export function deleteBook(id) {
  data.books = data.books.filter((b) => b.id !== id);
  save();
}
export const getBook = (id) => data.books.find((b) => b.id === id);

// ---------- Vocab ----------
export function addVocab(v) {
  const term = (v.term || '').trim();
  if (!term) return null;
  const existing = data.vocab.find((x) => x.term.toLowerCase() === term.toLowerCase());
  if (existing) {
    for (const k of ['meaning', 'example', 'note', 'emoji', 'imageQuery']) if (!existing[k] && v[k]) existing[k] = v[k];
    if ('emoji' in v) existing.visualDone = true;
    save();
    return existing;
  }
  const item = {
    id: uid(),
    term,
    meaning: v.meaning || '',
    example: v.example || '',
    note: v.note || '',
    emoji: v.emoji || '',
    imageQuery: v.imageQuery || '',
    visualDone: 'emoji' in v, // emoji chosen (by the dictionary or the word book's batch)
    bookId: v.bookId || null,
    source: v.source || 'manual',
    createdAt: Date.now(),
  };
  data.vocab.unshift(item);
  save();
  return item;
}
export function updateVocab(id, patch) {
  const v = data.vocab.find((x) => x.id === id);
  if (v) Object.assign(v, patch);
  save();
}
export function deleteVocab(id) {
  data.vocab = data.vocab.filter((v) => v.id !== id);
  save();
}

// ---------- Talks ----------
export function addTalk(t) {
  const talk = { id: uid(), date: today(), createdAt: Date.now(), ...t };
  data.talks.unshift(talk);
  save();
  return talk;
}
export function deleteTalk(id) {
  data.talks = data.talks.filter((t) => t.id !== id);
  save();
}

// ---------- Backup ----------
export function exportJSON() {
  return JSON.stringify({ app: 'yosho-talk', version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
}
export function importJSON(text) {
  const parsed = JSON.parse(text);
  const d = parsed.data || parsed;
  if (!Array.isArray(d.books) || !Array.isArray(d.vocab)) throw new Error('洋書トークのバックアップファイルではありません');
  const f = fresh();
  // This month's talk time stays as it is (it isn't part of the backup's data).
  Object.assign(data, f, d, { stats: { ...f.stats, ...d.stats }, settings: { ...f.settings, ...d.settings }, usage: data.usage });
  save();
}
export function resetAll() {
  Object.assign(data, fresh(), { usage: data.usage });
  save();
}
