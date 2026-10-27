// Talk partners. `voice` is a GPT-Live output voice (fixed for a session).

export const AVATARS = {
  emma: {
    name: 'Emma',
    voice: 'marin',
    tagline: '明るく聞き上手な読書仲間',
    persona: 'warm, curious and encouraging; loves YA and contemporary fiction; laughs easily',
    skin: '#F4C9A8', hair: '#7A4A2A', shirt: '#1F3A5F',
  },
  leo: {
    name: 'Leo',
    voice: 'cedar',
    tagline: '落ち着いた文学好きの先生タイプ',
    persona: 'calm, thoughtful and a little witty; loves classics, mysteries and asking "why?"',
    skin: '#E8B58F', hair: '#2B2B33', shirt: '#B8860B',
  },
};

export function avatarSVG(key) {
  const a = AVATARS[key] || AVATARS.emma;
  const hair = key === 'leo'
    ? `<path d="M52 92c-4-38 22-62 50-62s54 22 48 60c-8-16-22-26-48-28-22-2-40 10-50 30z" fill="${a.hair}"/>`
    : `<path d="M44 120c-10-56 18-92 58-92s70 32 58 94c-6-22-10-40-24-52-24 8-52 6-74-8-10 14-14 34-18 58z" fill="${a.hair}"/>
       <path d="M44 120c-4 30 0 48 10 60l8-62zM160 122c4 30 0 46-10 58l-8-62z" fill="${a.hair}"/>`;
  return `
  <svg viewBox="0 0 204 220" class="avatar-svg" aria-label="${a.name}">
    <path d="M36 220c4-40 30-58 66-58s62 18 66 58z" fill="${a.shirt}"/>
    <rect x="88" y="140" width="28" height="28" rx="10" fill="${a.skin}"/>
    <ellipse cx="102" cy="104" rx="54" ry="60" fill="${a.skin}"/>
    <ellipse cx="48" cy="108" rx="9" ry="13" fill="${a.skin}"/>
    <ellipse cx="156" cy="108" rx="9" ry="13" fill="${a.skin}"/>
    ${hair}
    <g class="eyes">
      <ellipse cx="80" cy="104" rx="6" ry="7.5" fill="#22252b"/>
      <ellipse cx="124" cy="104" rx="6" ry="7.5" fill="#22252b"/>
      <circle cx="82" cy="101" r="2" fill="#fff"/>
      <circle cx="126" cy="101" r="2" fill="#fff"/>
    </g>
    <path d="M70 88q10-6 20 0M114 88q10-6 20 0" stroke="${a.hair}" stroke-width="4" stroke-linecap="round" fill="none" class="brows"/>
    <ellipse cx="68" cy="124" rx="10" ry="6" fill="#F28B82" opacity=".35"/>
    <ellipse cx="136" cy="124" rx="10" ry="6" fill="#F28B82" opacity=".35"/>
    <g class="mouth-wrap" transform="translate(102 136)">
      <ellipse class="mouth" rx="13" ry="3" fill="#7A2E2E"/>
      <path class="smile" d="M-14 -2q14 12 28 0" stroke="#7A2E2E" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    </g>
    ${key === 'leo' ? `<g fill="none" stroke="#22252b" stroke-width="3"><circle cx="80" cy="104" r="15"/><circle cx="124" cy="104" r="15"/><path d="M95 104h14"/></g>` : ''}
  </svg>`;
}
