// 洋書トーク API relay (Cloudflare Worker)
//
// Holds the OpenAI API key so the browser never sees it.
//   GET  /check          -> passcode check
//   POST /live/sessions  -> OpenAI POST /v1/live/sessions (GPT-Live WebRTC SDP exchange)
//   POST /responses      -> OpenAI POST /v1/responses   (word extraction / feedback)
//   POST /voices         -> OpenAI POST /v1/audio/voices (prompt-to-voice: create a custom voice)
//
// Only the WebRTC handshake passes through here; the voice audio itself flows
// directly between the browser and OpenAI.
//
// Secrets (wrangler secret put): OPENAI_API_KEY, PASSCODE
// Vars (wrangler.toml): ALLOWED_ORIGINS, BACKEND_MODEL

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
        'Access-Control-Allow-Headers': 'Content-Type, X-Passcode',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
      : { Vary: 'Origin' };

    if (req.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (!originOk) return error(403, 'This origin is not allowed.', cors);

    if (env.LIMITER) {
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return error(429, 'Too many requests. Please wait a minute.', cors);
    }

    if (!env.PASSCODE || !env.OPENAI_API_KEY) return error(500, 'Server is not configured (missing secrets).', cors);
    if (!(await sameText(req.headers.get('X-Passcode') || '', env.PASSCODE))) return error(401, 'Wrong passcode.', cors);

    const { pathname } = new URL(req.url);

    if (req.method === 'GET' && pathname === '/check') return json({ ok: true }, 200, cors);

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
function error(status, message, headers) {
  return json({ error: { message } }, status, headers);
}
