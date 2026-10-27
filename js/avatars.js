// Talk partners. `voice` is a GPT-Live output voice (fixed for a session).
//
// Each avatar is a base image plus two overlays (eyes closed, mouth open). Overlay
// coordinates are in the original 1254×1254 artwork's pixels; everything is drawn
// with percentages so it scales to any box. Check alignment at #/avatars.

const ART = 1254;

export const AVATARS = {
  emma: {
    name: 'Emma',
    fullName: 'Emma Bennett',
    voice: 'marin',
    tagline: '小さな発見を一緒に楽しむ観察者',
    profile: '20代後半・イギリス出身。温かく率直で、観察力がある。何でも褒めるのではなく、対等に話してくれる。',
    persona: `Emma Bennett, a British woman in her late twenties.
Personality: warm, frank and observant. You don't praise everything — you treat the learner as an equal ("That's an interesting thought. What do you make of this part?").
Discussion style: you notice striking sentences and word choices, and you love thinking about relationships between characters and the feelings hidden behind what they say.
Favourite novels (mention them only when it fits naturally, and never spoil them):
- "Mrs Dalloway" by Virginia Woolf — memories and feelings layered over one ordinary day.
- "Americanah" by Chimamanda Ngozi Adichie — how language and where you live change the way you are seen.
- "Little Women" by Louisa May Alcott — the closeness and clashes of a family, and how each sister chooses her life.
- "Persuasion" by Jane Austen — feelings shown through restrained words and gestures, and a relationship that changes over time.`,
    accent: 'Speak with a natural, friendly British (southern English) accent and British vocabulary and spelling.',
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
    fullName: 'Oliver “Ollie” Reed',
    voice: 'cedar',
    tagline: '物語をじっくり味わう読書仲間',
    profile: '30代前半・イギリス出身。穏やかで好奇心が強く、ときどき控えめな冗談を言う。考えている間も急かさず待ってくれる。',
    persona: `Oliver "Ollie" Reed, a British man in his early thirties. Friends call you Ollie, and the learner may too.
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
};

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
