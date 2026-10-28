// Minimal GPT-Live (gpt-live-1) WebRTC client for the browser.
//
// The SDP exchange (POST /v1/live/sessions) goes through our Cloudflare Worker relay,
// which adds the OpenAI API key. Audio then flows directly between browser and OpenAI.
//
// Docs: https://developers.openai.com/api/docs/guides/live
//       https://developers.openai.com/api/docs/guides/live-delegation

import { relayPost } from './api.js';
import { reportTalk } from './cloud.js';

export class LiveSession {
  constructor({ session, onEvent, onStatus, onRemoteStream, onFunctionCall }) {
    Object.assign(this, { session, onEvent, onStatus, onRemoteStream, onFunctionCall });
    this.delegations = new Map(); // delegation_id -> { running, sent, completed }
    this.closed = false;
  }

  async start() {
    this.onStatus?.('connecting');
    this.pc = new RTCPeerConnection();
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
    this.pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      this.audioEl.srcObject = stream;
      this.onRemoteStream?.(stream);
    };
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(this.pc.connectionState) && !this.closed) this.onStatus?.('lost');
    };

    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.mic.getTracks().forEach((t) => this.pc.addTrack(t, this.mic));

    // Data channel must exist before the offer.
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      this.handle(ev);
    };

    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitForIce(this.pc, 2500);

    let res;
    try {
      res = await relayPost('/live/sessions', {
        session: this.session,
        transport: { type: 'webrtc', sdp: this.pc.localDescription.sdp },
      });
    } catch (err) {
      this.cleanup();
      throw err;
    }
    if (!res.ok) {
      const body = await res.text();
      this.cleanup();
      let msg = body;
      try { msg = JSON.parse(body).error?.message || body; } catch {}
      throw new Error(`セッション作成に失敗しました (${res.status}): ${msg}`);
    }
    const j = await res.json();
    this.id = j.session?.id ?? j.id;
    const answer = j.transport?.sdp ?? j.sdp;
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  send(ev) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(ev));
  }

  handle(ev) {
    switch (ev.type) {
      case 'session.started':
        // With accounts, the relay counted the first minute; report each further minute.
        this.liveAt = Date.now();
        this.reported = 60;
        this.beat = setInterval(() => {
          if ((Date.now() - this.liveAt) / 1000 - this.reported >= 60) {
            this.reported += 60;
            reportTalk(60).catch(() => {});
          }
        }, 5000);
        this.onStatus?.('live');
        break;
      case 'session.closed':
        this.closeResolve?.(ev);
        break;
      case 'response.event':
        this.handleDelegated(ev);
        break;
    }
    this.onEvent?.(ev);
  }

  // Function calls come from the Responses backend, wrapped in response.event envelopes.
  // Once the backend response has completed and every call has a result, ask it to continue.
  async handleDelegated(envelope) {
    const inner = envelope.event || {};
    const id = envelope.delegation_id;
    if (!this.delegations.has(id)) this.delegations.set(id, { running: 0, sent: 0, completed: false });
    const st = this.delegations.get(id);

    if (inner.type === 'response.output_item.done' && inner.item?.type === 'function_call') {
      const { call_id, name, arguments: argStr } = inner.item;
      st.running++;
      let output;
      try {
        const args = JSON.parse(argStr || '{}');
        output = (await this.onFunctionCall?.(name, args)) ?? { ok: true };
      } catch (err) {
        output = { ok: false, error: String(err.message || err) };
      }
      this.send({
        type: 'response.item.create',
        event_id: `out_${call_id}`,
        item: { type: 'function_call_output', call_id, output: JSON.stringify(output) },
      });
      st.running--;
      st.sent++;
    } else if (inner.type === 'response.created') {
      st.completed = false;
      return;
    } else if (inner.type === 'response.completed') {
      st.completed = true;
    } else {
      return;
    }

    if (st.completed && st.running === 0 && st.sent > 0) {
      Object.assign(st, { sent: 0, completed: false });
      this.send({ type: 'response.create', event_id: `continue_${Date.now()}` });
    }
  }

  setMuted(muted) {
    this.send({ type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: `mute_${Date.now()}` });
  }

  // Graceful close: wait for session.closed (final usage) before releasing devices.
  async close(timeoutMs = 4000) {
    if (this.closed) return null;
    this.closed = true;
    let result = null;
    if (this.dc?.readyState === 'open') {
      const done = new Promise((r) => (this.closeResolve = r));
      this.send({ type: 'session.close', event_id: `close_${Date.now()}` });
      result = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    }
    this.cleanup();
    if (this.liveAt) {
      const total = result?.usage?.seconds ?? (Date.now() - this.liveAt) / 1000;
      await reportTalk(Math.max(1, total - this.reported), true).catch(() => {});
    }
    return result;
  }

  cleanup() {
    clearInterval(this.beat);
    this.mic?.getTracks().forEach((t) => t.stop());
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    if (this.audioEl) this.audioEl.srcObject = null;
    this.onStatus?.('ended');
  }
}

function waitForIce(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

// One-shot Responses API call that returns parsed JSON (structured output).
// The model is chosen by the relay (BACKEND_MODEL).
// light: use the cheaper model (dictionary, questions, emoji); feedback uses the main one.
export async function responsesJSON({ instructions, input, schemaName, schema, light = false }) {
  const res = await relayPost('/responses', {
    light,
    instructions,
    input,
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  const text = j.output_text
    ?? (j.output || []).flatMap((o) => o.content || []).find((c) => c.type === 'output_text')?.text;
  return JSON.parse(text);
}

// One-shot Responses API call that returns plain text (e.g. the review chat).
// input: a string, or [{ role: 'user' | 'assistant', content }].
export async function responsesText({ instructions, input, light = false }) {
  const res = await relayPost('/responses', { instructions, input, light });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  return (j.output_text
    ?? (j.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('')).trim();
}
