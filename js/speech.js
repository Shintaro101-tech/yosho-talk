// Reading English aloud, free of charge: recordings of real speakers for single words
// (Free Dictionary API / Wiktionary), otherwise the device's own voice. Devices carry
// voices of very different quality, so the most natural one is picked (or the one
// chosen in Settings).

import { data, save } from './store.js';
import { toast } from './util.js';

// Joke and novelty voices (macOS and iOS ship many) are never picked automatically.
const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Princess|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley/i;

// Higher is more natural: neural voices (Edge "Natural"/"Online"), Apple's Premium and
// Enhanced downloads, Google's voices, then well-known good voices.
function score(v) {
  const n = v.name;
  let s = 0;
  if (NOVELTY.test(n)) s -= 100;
  if (/Natural|Online|Neural/i.test(n)) s += 50;
  if (/Premium|プレミアム/i.test(n)) s += 40;
  if (/Enhanced|拡張/i.test(n)) s += 30;
  if (/Google/i.test(n)) s += 20;
  if (/Ava|Zoe|Samantha|Allison|Aria|Jenny|Guy|Evan|Nathan|Daniel|Serena|Karen|Moira|Tessa|Libby|Sonia/i.test(n)) s += 10;
  const lang = v.lang.replace('_', '-');
  if (lang === 'en-US') s += 5;
  else if (lang === 'en-GB') s += 4;
  return s;
}

const lang = (v) => v.lang.replace('_', '-');

// English voices on this device, the most natural first.
export function englishVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}

// The voice to use: the one chosen in Settings (if this device has it), otherwise the
// most natural one — of the accent asked for ('us' / 'uk'), when there is one.
export function pickVoice(accent) {
  const voices = englishVoices();
  const want = accent === 'uk' ? 'en-GB' : accent === 'us' ? 'en-US' : null;
  const chosen = voices.find((v) => v.voiceURI === data.settings.ttsVoice);
  if (chosen && (!want || lang(chosen) === want)) return chosen;
  return (want && voices.find((v) => lang(v) === want)) || voices[0] || null;
}

// Voices arrive a moment after the page loads on some browsers.
export function onVoices(fn) {
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', fn);
}

export function setVoice(voiceURI) {
  data.settings.ttsVoice = voiceURI || '';
  save();
}

// Reads text with the device's voice. accent: 'us' | 'uk' | undefined (any English).
export function speak(text, { accent, rate = 0.95 } = {}) {
  if (!text) return;
  if (!('speechSynthesis' in window)) { toast('この端末では音声を再生できません'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(accent);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = accent === 'uk' ? 'en-GB' : 'en-US';
  u.rate = rate;
  speechSynthesis.speak(u);
}

// Recordings by accent ({ us, uk, au }: mp3 URLs) for a single word, remembered here
// so a word is looked up once ({} when it has none).
const REC_KEY = 'yoshotalk:rec';
const REC_MAX = 400;
const isWord = (t) => /^[a-z][a-z'-]*$/i.test(t);
function savedRecordings() {
  try { return JSON.parse(localStorage.getItem(REC_KEY)) || {}; } catch { return {}; }
}
export async function findRecordings(word) {
  const key = word.trim().toLowerCase();
  const saved = savedRecordings();
  if (saved[key]) return saved[key];
  const found = {};
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
    if (res.ok) {
      for (const e of await res.json()) {
        for (const p of e.phonetics || []) {
          const m = (p.audio || '').match(/-(us|uk|au)\.mp3$/);
          if (m && !found[m[1]]) found[m[1]] = p.audio;
        }
      }
    } else if (res.status !== 404) return {}; // try again another time
  } catch { return {}; }
  const now = savedRecordings();
  now[key] = found;
  const keys = Object.keys(now);
  for (const k of keys.slice(0, Math.max(0, keys.length - REC_MAX))) delete now[k];
  try { localStorage.setItem(REC_KEY, JSON.stringify(now)); } catch { /* full */ }
  return found;
}

// Looks up recordings ahead of time (one at a time, in the background), so that a tap
// can play one at once: phones only allow sound that starts right in the tap.
let fetching = false;
export async function prefetchRecordings(terms) {
  if (fetching) return;
  fetching = true;
  const saved = savedRecordings();
  for (const t of terms.map((x) => String(x || '').trim().toLowerCase()).filter((x) => isWord(x) && !saved[x]).slice(0, 40)) {
    await findRecordings(t);
  }
  fetching = false;
}

// A word or phrase: a real speaker's recording when it is a single word that has one,
// otherwise the device's voice (and the recording is looked up for next time).
export function speakTerm(term) {
  const t = String(term || '').trim();
  if (isWord(t)) {
    const rec = savedRecordings()[t.toLowerCase()];
    const url = rec && (rec.us || rec.uk || rec.au);
    if (url) {
      new Audio(url).play().catch(() => speak(t));
      return;
    }
    if (!rec) findRecordings(t);
  }
  speak(t);
}
