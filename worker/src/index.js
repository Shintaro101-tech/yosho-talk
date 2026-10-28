// 洋書トーク API relay (Cloudflare Worker)
//
// Holds the OpenAI API key so the browser never sees it.
// Callers are either app accounts (Supabase login: "Authorization: Bearer <token>"),
// whose monthly use is limited by their plan, or the owner with the passcode.
//   GET  /check          -> passcode check
//   GET  /me             -> the account's plan and this month's usage
//   POST /redeem         -> { code }: an invite code turns a new account into a trial
//   POST /usage/talk     -> { seconds }: talk time, reported by the app every minute
//   POST /account/delete -> deletes the account and all its data
//   POST /live/sessions  -> OpenAI POST /v1/live/sessions (GPT-Live WebRTC SDP exchange)
//   POST /responses      -> OpenAI POST /v1/responses   (word extraction / feedback)
//   POST /voices         -> OpenAI POST /v1/audio/voices (prompt-to-voice: create a custom voice)
//   GET  /cover?isbn=…   -> a Japanese book's cover image (no passcode; images only)
//   POST /images         -> Pixabay image search for the dictionary ({ q } → a few pictures)
//
// Only the WebRTC handshake passes through here; the voice audio itself flows
// directly between the browser and OpenAI.
//
// Secrets (wrangler secret put): OPENAI_API_KEY, PASSCODE, PIXABAY_KEY (optional),
//   SUPABASE_SERVICE_KEY, INVITE_CODE (accounts)
// Vars (wrangler.toml): ALLOWED_ORIGINS, BACKEND_MODEL, SUPABASE_URL

const OPENAI = 'https://api.openai.com/v1';
const MAX_BODY = 200_000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = originOk
      ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Passcode, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
      : { Vary: 'Origin' };

    if (req.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (!originOk) return error(403, 'This origin is not allowed.', cors);

    // Covers: before the rate limit (a book search asks for up to 12 at once).
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/cover') return bookCover(url.searchParams.get('isbn'), cors);

    if (env.LIMITER) {
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return error(429, 'Too many requests. Please wait a minute.', cors);
    }

    if (!env.PASSCODE || !env.OPENAI_API_KEY) return error(500, 'Server is not configured (missing secrets).', cors);
    const { pathname } = url;

    // Who is calling: an account (limited by its plan) or the owner (passcode, no limits).
    const token = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/)?.[1];
    let account = null;
    if (token && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      account = await loadAccount(env, token);
      if (!account) return error(401, 'ログインの有効期限が切れました。もう一度ログインしてください。', cors, 'LOGIN');
    } else if (!(await sameText(req.headers.get('X-Passcode') || '', env.PASSCODE))) {
      return error(401, 'Wrong passcode.', cors);
    }

    if (req.method === 'GET' && pathname === '/check') return json({ ok: true }, 200, cors);

    if (account) {
      if (req.method === 'GET' && pathname === '/me') return json(publicAccount(account), 200, cors);

      if (req.method === 'POST' && pathname === '/redeem') {
        const code = String((await req.json().catch(() => ({}))).code || '').trim();
        if (!env.INVITE_CODE || !code || !(await sameText(code.toLowerCase(), env.INVITE_CODE.toLowerCase()))) {
          return error(400, '招待コードが違います。', cors, 'CODE');
        }
        if (account.plan === 'free') {
          await supabase(env, `/rest/v1/profiles?id=eq.${account.id}`, { method: 'PATCH', body: JSON.stringify({ plan: 'trial' }) });
        }
        return json(publicAccount(await loadAccount(env, token)), 200, cors);
      }

      if (req.method === 'POST' && pathname === '/usage/talk') {
        // At most a little over a minute per report (the app reports every minute).
        const seconds = Math.min(75, Math.max(0, Math.round(Number((await req.json().catch(() => ({}))).seconds) || 0)));
        const usage = await addUsage(env, account, seconds, 0);
        return json(publicAccount({ ...account, usage }), 200, cors);
      }

      if (req.method === 'POST' && pathname === '/account/delete') {
        const res = await supabase(env, `/auth/v1/admin/users/${account.id}`, { method: 'DELETE' });
        if (!res.ok) return error(502, 'アカウントを削除できませんでした。時間をおいてもう一度お試しください。', cors);
        return json({ ok: true }, 200, cors);
      }

      // Everything below uses OpenAI or Pixabay: check this month's allowance first.
      if (pathname === '/voices' && account.plan !== 'admin') return error(403, 'この機能は管理者だけが使えます。', cors);
      if (pathname === '/live/sessions') {
        if (account.limits.talk_minutes <= 0) return error(402, '招待コードを入力すると、トークを使えるようになります。', cors, 'PLAN');
        if (account.limits.talk_minutes * 60 - account.usage.talk_seconds < 30) return error(402, '今月のトーク時間を使い切りました。来月1日にリセットされます。', cors, 'TALK_LIMIT');
        // The first minute is counted when the talk starts; the app reports the rest.
        await addUsage(env, account, 60, 0);
      } else if (['/responses', '/images', '/voices'].includes(pathname)) {
        if (account.limits.ai_calls <= 0) return error(402, '招待コードを入力すると、この機能を使えるようになります。', cors, 'PLAN');
        if (account.usage.ai_calls >= account.limits.ai_calls) return error(402, '今月の AI 機能（辞書・フィードバックなど）の利用回数の上限に達しました。来月1日にリセットされます。', cors, 'AI_LIMIT');
        await addUsage(env, account, 0, 1);
      }
    }

    if (req.method === 'POST' && pathname === '/images') {
      if (!env.PIXABAY_KEY) return error(501, 'Image search is not set up (PIXABAY_KEY).', cors);
      let q = '';
      try { q = String((await req.json()).q || '').trim().slice(0, 100); } catch { /* checked below */ }
      if (!q) return error(400, 'Give a search word.', cors);
      const params = new URLSearchParams({ key: env.PIXABAY_KEY, q, lang: 'en', safesearch: 'true', per_page: '6', orientation: 'horizontal' });
      const upstream = await fetch(`https://pixabay.com/api/?${params}`);
      if (!upstream.ok) return error(502, `Pixabay returned ${upstream.status}.`, cors);
      const { hits = [] } = await upstream.json();
      // Only what the app shows: the picture, its Pixabay page and who made it.
      const images = hits.map((h) => ({ src: h.webformatURL, page: h.pageURL, user: h.user, tags: h.tags }));
      return json({ images }, 200, cors);
    }

    if (req.method === 'POST' && (pathname === '/live/sessions' || pathname === '/responses' || pathname === '/voices')) {
      const text = await req.text();
      if (text.length > MAX_BODY) return error(413, 'Request too large.', cors);
      let body;
      try { body = JSON.parse(text); } catch { return error(400, 'Invalid JSON.', cors); }

      // Pin the models server-side so the key can't be used for anything else.
      if (pathname === '/live/sessions') {
        if (!body.session || body.transport?.type !== 'webrtc') return error(400, 'Invalid session request.', cors);
        body.session.model = 'gpt-live-1';
        if (body.session.delegation?.type === 'responses') {
          body.session.delegation.responses = { ...body.session.delegation.responses, model: env.BACKEND_MODEL };
        }
      } else if (pathname === '/voices') {
        // Only prompt-generated voices, with a short name and description.
        const name = String(body.name || '').slice(0, 60);
        const prompt = String(body.prompt || '').slice(0, 2000);
        if (!name || prompt.length < 20) return error(400, 'Give a name and a voice description.', cors);
        body = { type: 'prompt', model: 'auto', name, prompt };
      } else {
        body = {
          model: env.BACKEND_MODEL,
          instructions: body.instructions,
          input: body.input,
          text: body.text,
          max_output_tokens: 4000,
        };
      }

      const upstream = await fetch(OPENAI + (pathname === '/voices' ? '/audio/voices' : pathname), {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // 401 from the relay means "wrong passcode" to the app, so report a bad key differently.
      if (upstream.status === 401) return error(502, 'OpenAI rejected the API key. Check OPENAI_API_KEY on the relay.', cors);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
      });
    }

    return error(404, 'Not found.', cors);
  },
};

// A book's cover by ISBN-13, from the first source that has one: openBD, 版元ドットコム,
// then Google Books. Google answers with a grey "no image" picture instead of an error,
// so that picture is recognised by its SHA-256 and skipped.
const GOOGLE_NO_COVER = 'a9af512c1e52ed9cafd06b8f212bf13940976703ee3a38573df558e28ce31a21';

async function bookCover(isbn, cors) {
  if (!/^97[89]\d{10}$/.test(isbn || '')) return error(400, 'Give a 13-digit ISBN.', cors);
  const sources = [
    async () => (await (await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`)).json())?.[0]?.summary?.cover,
    async () => `https://www.hanmoto.com/bd/img/${isbn}.jpg`,
    async () => `https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=1`,
  ];
  for (const source of sources) {
    try {
      const src = await source();
      if (!src) continue;
      const res = await fetch(src);
      const type = res.headers.get('Content-Type') || '';
      if (!res.ok || !type.startsWith('image/')) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 1000 || (await sha256(buf)) === GOOGLE_NO_COVER) continue;
      return new Response(buf, { headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' } });
    } catch { /* try the next source */ }
  }
  return error(404, 'No cover found.', cors);
}

async function sha256(buf) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison of two strings (via their SHA-256 digests).
async function sameText(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
function error(status, message, headers, code) {
  return json({ error: { message, ...(code ? { code } : {}) } }, status, headers);
}

// ---------------------------------------------------------------- accounts (Supabase)

// Calls Supabase with the service key (it can read and write every account's rows).
function supabase(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), // legacy service_role key
      ...init.headers,
    },
  });
}

// This month in Japan time, e.g. "2026-10" (usage resets on the 1st, JST).
const monthJST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

// The signed-in account behind a login token, with its plan and this month's usage.
async function loadAccount(env, token) {
  const who = await supabase(env, '/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } });
  if (!who.ok) return null;
  const { id, email } = await who.json();
  const month = monthJST();
  const [profiles, usage] = await Promise.all([
    supabase(env, `/rest/v1/profiles?id=eq.${id}&select=plan,plans(label,talk_minutes,ai_calls)`).then((r) => r.json()),
    supabase(env, `/rest/v1/usage?user_id=eq.${id}&month=eq.${month}&select=talk_seconds,ai_calls`).then((r) => r.json()),
  ]);
  const p = profiles?.[0] || { plan: 'free', plans: { label: '未登録', talk_minutes: 0, ai_calls: 0 } };
  return {
    id, email, month,
    plan: p.plan,
    label: p.plans?.label || p.plan,
    limits: { talk_minutes: p.plans?.talk_minutes ?? 0, ai_calls: p.plans?.ai_calls ?? 0 },
    usage: usage?.[0] || { talk_seconds: 0, ai_calls: 0 },
  };
}

async function addUsage(env, account, seconds, calls) {
  const res = await supabase(env, '/rest/v1/rpc/add_usage', {
    method: 'POST',
    body: JSON.stringify({ p_user: account.id, p_month: account.month, p_seconds: seconds, p_calls: calls }),
  });
  const row = await res.json();
  const u = Array.isArray(row) ? row[0] : row;
  return u?.talk_seconds != null ? { talk_seconds: u.talk_seconds, ai_calls: u.ai_calls } : account.usage;
}

const publicAccount = (a) => ({ email: a.email, plan: a.plan, label: a.label, month: a.month, limits: a.limits, usage: a.usage });
