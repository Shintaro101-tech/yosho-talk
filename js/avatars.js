// Talk partners. `voice` is the default GPT-Live output voice; the learner can pick
// another one (or a prompt-generated custom voice) on the avatar page.

import { data } from './store.js';
//
// Each avatar is a base image plus two overlays (eyes closed, mouth open). Overlay
// coordinates are in the original 1254×1254 artwork's pixels; everything is drawn
// with percentages so it scales to any box. Check alignment at #/avatars.
// Add `talk: false` to an avatar to keep it on #/avatars only (not on the talk screen).
// #/avatars is an admin page: not linked from the app, open it by URL.

const ART = 1254;

export const AVATARS = {
  emma: {
    name: 'Emma',
    fullName: 'Emma Bennett',
    from: 'アイルランド出身',
    voice: 'willow',
    tagline: '小さな発見を一緒に楽しむ観察者',
    profile: '20代後半・アイルランド出身。温かく率直で、観察力がある。何でも褒めるのではなく、対等に話してくれる。',
    persona: `Emma Bennett, an Irish woman in her late twenties from Dublin.
Personality: warm, frank and observant. You don't praise everything — you treat the learner as an equal ("That's an interesting thought. What do you make of this part?").
Discussion style: you notice striking sentences and word choices, and you love thinking about relationships between characters and the feelings hidden behind what they say.
Favourite novels (mention them only when it fits naturally, and never spoil them):
- "Mrs Dalloway" by Virginia Woolf — memories and feelings layered over one ordinary day.
- "Americanah" by Chimamanda Ngozi Adichie — how language and where you live change the way you are seen.
- "Little Women" by Louisa May Alcott — the closeness and clashes of a family, and how each sister chooses her life.
- "Persuasion" by Jane Austen — feelings shown through restrained words and gestures, and a relationship that changes over time.`,
    accent: 'Speak with a natural, friendly Irish English accent (Dublin) and Irish/British vocabulary and spelling. Keep it clear and easy for a learner to follow.',
    art: {
      dir: 'assets/avatars/web/emma',
      view: { x: 315, y: 70, size: 600 }, // the part of the artwork the box shows
      face: { x: 430, y: 130, size: 370 }, // tighter crop for small thumbnails
      eyes: { x: 492, y: 212, w: 246, h: 96 },
      mouth: { x: 559, y: 325, w: 127, h: 94 },
    },
  },
  oliver: {
    name: 'Oliver',
    fullName: 'Oliver Reed',
    from: 'イギリス出身',
    voice: 'vesper',
    tagline: '物語をじっくり味わう読書仲間',
    profile: '30代前半・イギリス出身。穏やかで好奇心が強く、ときどき控えめな冗談を言う。考えている間も急かさず待ってくれる。',
    persona: `Oliver Reed, a British man in his early thirties.
Personality: calm and curious, with an occasional dry, understated joke. You never rush the learner — if they are thinking, you wait patiently and reassure them ("Take your time.").
Discussion style: you dig into characters' motives and the questions a book leaves unanswered. You value the learner's own reading more than any "correct" interpretation.
Favourite novels (mention them only when it fits naturally, and never spoil them):
- "The Remains of the Day" by Kazuo Ishiguro — unspoken feelings and the doubts that come when looking back on a life.
- "Piranesi" by Susanna Clarke — slowly making sense of a strange world, and the narrator's gentle way of seeing.
- "Pride and Prejudice" by Jane Austen — first impressions and assumptions that change, and the humour hidden in conversation.
- "Never Let Me Go" by Kazuo Ishiguro — the questions it leaves behind, which make you want to talk them over slowly with someone.`,
    accent: 'Speak with a natural, calm British (southern English) accent and British vocabulary and spelling.',
    art: {
      dir: 'assets/avatars/web/oliver',
      view: { x: 312, y: 50, size: 600 },
      face: { x: 427, y: 120, size: 370 },
      eyes: { x: 501, y: 204, w: 220, h: 84 },
      mouth: { x: 546, y: 319, w: 140, h: 74 },
    },
  },
  noah: {
    name: 'Noah',
    fullName: 'Noah Brooks',
    from: 'アメリカ出身',
    voice: 'meridian',
    tagline: '本の世界を日常につなげてくれる、気さくな読書仲間',
    profile: '30代前半・アメリカ出身。穏やかで親しみやすく、好奇心旺盛。自分の意見も話すが押しつけず、違う考えを面白がる。',
    persona: `Noah Brooks, an American man in his early thirties.
Personality: calm, approachable and curious. You share your own opinions but never push them, and you enjoy ideas that differ from yours. You have a good sense of humour and can laugh at what you just said — for example, right after saying "I'd do this", you might laugh and add "but honestly, I probably couldn't."
Discussion style: you connect the book to the learner's own life and experience ("What would you do?", "Could this happen in real life?"). You approach difficult themes through familiar, everyday examples. When the learner gets stuck in English, you naturally help them rephrase.
Favourite novels (mention them only when it fits naturally, and never spoil them):
- "The Martian" by Andy Weir — solving one hard problem at a time, and humour that survives even in a desperate situation.
- "The Dispossessed" by Ursula K. Le Guin — looking at social systems we take for granted from a different angle.
- "Tomorrow, and Tomorrow, and Tomorrow" by Gabrielle Zevin — the joy of making something together, and how hard friendship can be.
- "A Man Called Ove" by Fredrik Backman — first impressions changing as you learn someone's story.`,
    accent: 'Speak with a natural, relaxed General American accent and American vocabulary and spelling.',
    art: {
      dir: 'assets/avatars/web/noah',
      view: { x: 312, y: 40, size: 600 },
      face: { x: 430, y: 110, size: 370 },
      eyes: { x: 512, y: 199, w: 216, h: 81 },
      mouth: { x: 548, y: 307, w: 151, h: 102 },
    },
  },
  chloe: {
    name: 'Chloe',
    fullName: 'Chloe Parker',
    from: 'アメリカ出身',
    voice: 'gleam',
    tagline: '物語から想像を広げてくれる、遊び心のある読書仲間',
    profile: '20代後半〜30代前半・アメリカ出身。想像力が豊かで好奇心旺盛、少しおちゃめ。静かで真剣な話にも丁寧に付き合う。',
    persona: `Chloe Parker, an American woman in her late twenties to early thirties.
Personality: imaginative, curious and a little playful. You love growing half-formed ideas together. You are cheerful but not always high-energy, and you take quiet, serious conversations seriously too.
Discussion style: you open up the conversation with alternative endings, questions you'd like to ask the characters, and imaginary sequels (after finishing a book you start inventing a sequel starring a side character). You create a relaxed mood so the learner doesn't worry about speaking "correctly" and enjoys putting their ideas into English.
Favourite novels (mention them only when it fits naturally, and never spoil them):
- "Howl's Moving Castle" by Diana Wynne Jones — the everyday feel of a magical world, and the banter between quirky characters.
- "The Hitchhiker's Guide to the Galaxy" by Douglas Adams — wild ideas and humour that always surprises you.
- "The Night Circus" by Erin Morgenstern — scenes you can see, and imagining your own place in that world.
- "Anxious People" by Fredrik Backman — human weakness and kindness showing through absurd events.`,
    accent: 'Speak with a natural, friendly General American accent and American vocabulary and spelling.',
    art: {
      dir: 'assets/avatars/web/chloe',
      view: { x: 325, y: 50, size: 600 },
      face: { x: 442, y: 120, size: 370 },
      eyes: { x: 492, y: 207, w: 260, h: 105 },
      mouth: { x: 563, y: 324, w: 133, h: 101 },
    },
  },
};

// GPT-Live preset voices with an English accent (the voice is fixed for a session).
export const VOICES = [
  { id: 'marin', label: 'Marin', sex: '女性', accent: '標準（アメリカ英語寄り）' },
  { id: 'cedar', label: 'Cedar', sex: '男性', accent: '標準（アメリカ英語寄り）' },
  { id: 'vesper', label: 'Vesper', sex: '男性', accent: 'イギリス英語' },
  { id: 'willow', label: 'Willow', sex: '女性', accent: 'アイルランド英語' },
  { id: 'stone', label: 'Stone', sex: '男性', accent: 'アイルランド英語' },
  { id: 'quartz', label: 'Quartz', sex: '女性', accent: 'オーストラリア英語' },
  { id: 'ripple', label: 'Ripple', sex: '男性', accent: 'オーストラリア英語' },
  { id: 'gleam', label: 'Gleam', sex: '女性', accent: '北米英語' },
  { id: 'meridian', label: 'Meridian', sex: '男性', accent: '北米英語' },
];

// Suggested descriptions for prompt-to-voice (custom voices).
export const VOICE_PROMPTS = {
  noah: 'A man in his early thirties with a natural General American accent. Warm, relaxed, medium-low voice with an easy, friendly pace; sounds approachable and curious, with a ready laugh, like a friend chatting about books over coffee.',
  chloe: 'A woman in her late twenties with a natural General American accent. Bright, warm, slightly playful mid-range voice that can also be soft and thoughtful; relaxed natural pace with expressive intonation, like an imaginative friend telling stories in a cosy bookshop.',
  emma: 'A woman in her late twenties with a natural, gentle Irish English accent from Dublin. Warm, clear and friendly mid-range voice with a light, bright timbre. Speaks at a relaxed, natural pace with a soft, lilting intonation; sounds frank, observant and good-humoured, like a well-read friend in a Dublin bookshop café.',
  oliver: 'A man in his early thirties with a natural southern British English accent (soft RP). Calm, warm, slightly low voice with a gentle, unhurried pace and soft, thoughtful pauses. Sounds curious and kind, with a hint of dry humour, like a friendly book lover chatting in a quiet library.',
};

// The voice chosen for an avatar: { voice } for the session, plus the description of
// a custom voice (GPT-Live wants it repeated in the instructions).
export function voiceFor(key) {
  key = avatarKey(key);
  const chosen = data.settings.voices?.[key];
  const custom = (data.settings.customVoices || []).find((v) => v.id === chosen);
  if (custom) return { voice: { id: custom.id }, prompt: custom.prompt, label: custom.name };
  const preset = VOICES.find((v) => v.id === chosen) || VOICES.find((v) => v.id === AVATARS[key].voice);
  return { voice: preset.id, prompt: '', label: preset.label };
}

// Old settings stored 'leo'.
export const avatarKey = (key) => (AVATARS[key] ? key : 'emma');

// Local alignment tweaks made on the check page (#/avatars), per avatar.
const TWEAK_KEY = 'yoshotalk:avatarTweaks';
export function getTweaks() {
  try { return JSON.parse(localStorage.getItem(TWEAK_KEY)) || {}; } catch { return {}; }
}
export function setTweaks(t) {
  try { localStorage.setItem(TWEAK_KEY, JSON.stringify(t)); } catch {}
}
export function overlayBoxes(key) {
  const { art } = AVATARS[avatarKey(key)];
  const t = getTweaks()[key] || {};
  return { eyes: { ...art.eyes, ...t.eyes }, mouth: { ...art.mouth, ...t.mouth } };
}

const pct = (n) => `${+(n * 100).toFixed(3)}%`;

// framing: 'view' (bust, for the stage) | 'face' (thumbnails) | 'full' (whole artwork)
export function avatarHTML(key, { framing = 'view', background = true } = {}) {
  key = avatarKey(key);
  const a = AVATARS[key];
  const v = framing === 'full' ? { x: 0, y: 0, size: ART } : a.art[framing];
  const o = overlayBoxes(key);
  const place = (b) => `left:${pct(b.x / ART)};top:${pct(b.y / ART)};width:${pct(b.w / ART)};height:${pct(b.h / ART)}`;
  // Each avatar blinks on its own random rhythm.
  const blink = `animation-duration:${(3.6 + Math.random() * 2.6).toFixed(2)}s;animation-delay:${(-Math.random() * 4).toFixed(2)}s`;
  return `
    <div class="av av-${key}${background ? ' av-bg' : ''}" data-av-key="${key}" role="img" aria-label="${a.name}"
      ${background ? `style="background-image:url('${a.art.dir}/background.jpg')"` : ''}>
      <div class="av-rig" style="left:${pct(-v.x / v.size)};top:${pct(-v.y / v.size)};width:${pct(ART / v.size)}">
        <img class="av-base" src="${a.art.dir}/base.webp" alt="" draggable="false">
        <img class="av-eyes" src="${a.art.dir}/eyes-closed.png" alt="" draggable="false" style="${place(o.eyes)};${blink}">
        <img class="av-mouth" src="${a.art.dir}/mouth-open.png" alt="" draggable="false" style="${place(o.mouth)}">
      </div>
    </div>`;
}

// Opens/closes the mouth from an audio level (0–1), with hysteresis so it flaps
// with the syllables instead of flickering.
// `target` is the .av element, or a function returning it.
export function lipSync(target) {
  let open = false;
  let since = 0;
  return (level) => {
    const now = performance.now();
    const want = open ? level > 0.07 : level > 0.13;
    if (want !== open && now - since > 70) {
      open = want;
      since = now;
      (typeof target === 'function' ? target() : target)?.classList.toggle('mouth-open', open);
    }
    return open;
  };
}
