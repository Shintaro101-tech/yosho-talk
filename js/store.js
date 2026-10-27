// All app data lives in this browser's localStorage (personal use).
// Use 設定 > エクスポート to back it up or move it to another device.

import { uid, today, addDays, toast } from './util.js';

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
      dailyGoal: 50,
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

// ---------- XP / level / streak ----------
export function levelInfo(xp = data.stats.xp) {
  // Level n needs n*100 XP to reach n+1.
  let level = 1;
  let rest = xp;
  while (rest >= level * 100) {
    rest -= level * 100;
    level++;
  }
  return { level, into: rest, need: level * 100 };
}

export function currentStreak() {
  const { lastActive, streak } = data.stats;
  if (!lastActive) return 0;
  return lastActive === today() || lastActive === addDays(today(), -1) ? streak : 0;
}

export function addXP(n, reason = '') {
  const s = data.stats;
  const t = today();
  const before = levelInfo().level;
  if (s.lastActive !== t) {
    s.streak = s.lastActive === addDays(t, -1) ? s.streak + 1 : 1;
    s.lastActive = t;
    s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
  }
  s.xp += n;
  s.log[t] = (s.log[t] || 0) + n;
  save();
  const after = levelInfo().level;
  if (after > before) toast(`🎉 レベルアップ！ Lv.${after}`, 'success');
  else if (reason) toast(`+${n} XP ${reason}`, 'xp');
}

// ---------- Books ----------
export function addBook(b) {
  const book = { id: uid(), createdAt: Date.now(), status: 'reading', rating: 0, memo: '', ...b };
  data.books.unshift(book);
  save();
  addXP(20, '本を登録');
  if (book.status === 'finished') addXP(50, '読了！');
  return book;
}
export function updateBook(id, patch) {
  const b = data.books.find((x) => x.id === id);
  if (!b) return;
  const wasFinished = b.status === 'finished';
  Object.assign(b, patch);
  save();
  if (!wasFinished && b.status === 'finished') addXP(50, '読了！');
}
export function deleteBook(id) {
  data.books = data.books.filter((b) => b.id !== id);
  save();
}
export const getBook = (id) => data.books.find((b) => b.id === id);

// ---------- Vocab + spaced repetition ----------
export function addVocab(v) {
  const term = (v.term || '').trim();
  if (!term) return null;
  const existing = data.vocab.find((x) => x.term.toLowerCase() === term.toLowerCase());
  if (existing) {
    for (const k of ['meaning', 'example', 'note']) if (!existing[k] && v[k]) existing[k] = v[k];
    save();
    return existing;
  }
  const item = {
    id: uid(),
    term,
    meaning: v.meaning || '',
    example: v.example || '',
    note: v.note || '',
    bookId: v.bookId || null,
    source: v.source || 'manual',
    createdAt: Date.now(),
    srs: { ease: 2.5, interval: 0, reps: 0, due: today(), lapses: 0 },
  };
  data.vocab.unshift(item);
  save();
  addXP(3, `「${term}」を追加`);
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

export const isDue = (v) => v.srs.due <= today();
export const isMastered = (v) => v.srs.interval >= 21;

// grade: 0=Again 1=Hard 2=Good 3=Easy (simplified SM-2)
export function review(id, grade) {
  const v = data.vocab.find((x) => x.id === id);
  if (!v) return;
  const s = v.srs;
  if (grade === 0) {
    s.reps = 0;
    s.lapses++;
    s.interval = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
  } else {
    if (grade === 1) {
      s.interval = Math.max(1, Math.round(s.interval * 1.2));
      s.ease = Math.max(1.3, s.ease - 0.15);
    } else if (s.reps === 0) {
      s.interval = grade === 3 ? 3 : 1;
    } else if (s.reps === 1) {
      s.interval = grade === 3 ? 6 : 3;
    } else {
      s.interval = Math.round(s.interval * s.ease * (grade === 3 ? 1.3 : 1));
    }
    if (grade === 3) s.ease += 0.15;
    s.reps++;
  }
  s.due = addDays(today(), s.interval);
  s.lastReviewed = today();
  save();
}

// ---------- Talks ----------
export function addTalk(t) {
  const talk = { id: uid(), date: today(), createdAt: Date.now(), ...t };
  data.talks.unshift(talk);
  save();
  return talk;
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
  Object.assign(data, f, d, { stats: { ...f.stats, ...d.stats }, settings: { ...f.settings, ...d.settings } });
  save();
}
export function resetAll() {
  Object.assign(data, fresh());
  save();
}
