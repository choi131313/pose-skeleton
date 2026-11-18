// pose-proxy — 포즈 만들기 전용 xAI(Grok) 프록시 (Cloudflare Worker)
// - https://choi131313.github.io 에서 오는 요청만 (CORS)
// - 비밀번호(PAGE_PASSWORD) 확인: 상수 시간 비교 + 틀리면 지연 + IP별 잠금
// - 시스템 프롬프트·JSON 스키마는 서버가 고정 → 일반 Grok 무료 사용 불가
// - 모델 허용 목록, max_tokens 상한, 입력 길이 상한, 하루 요청 상한(DAILY_LIMIT)
// - 키·비밀번호·요청 내용은 절대 로그에 남기지 않음
import { SYSTEM, SCHEMA } from '../../pose-prompt.js';

const DEFAULTS = {
  ALLOWED_ORIGIN: 'https://choi131313.github.io',
  ALLOWED_MODELS: 'grok-4.7,grok-4.3,grok-4.20-0309-non-reasoning',
  DEFAULT_MODEL: 'grok-4.7',
  MAX_TOKENS: '6000',
  MAX_INPUT_CHARS: '12000',
  DAILY_LIMIT: '200',
  MAX_FAILS: '5',          // 이만큼 틀리면
  LOCK_SECONDS: '900',     // 이 시간 동안 잠금
  XAI_URL: 'https://api.x.ai/v1/chat/completions',
};
const cfg = (env, k) => (env[k] ?? DEFAULTS[k]) + '';
const mem = { fails: new Map(), day: { key: '', n: 0 } }; // KV가 없을 때만 쓰는 임시 메모리(인스턴스별)

function cors(env, origin) {
  const allowed = cfg(env, 'ALLOWED_ORIGIN').split(',').map(s => s.trim());
  if (!origin || !allowed.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
const json = (obj, status, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function safeEqual(a, b) { // 길이와 상관없이 같은 시간: 둘 다 SHA-256으로 바꿔 XOR 비교
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  const u = new Uint8Array(x), w = new Uint8Array(y); let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ w[i];
  return d === 0;
}
function seoulDay() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }

// ---- 카운터 (KV 있으면 KV, 없으면 메모리) ----
async function getFails(env, ip) {
  if (env.POSE_KV) return +(await env.POSE_KV.get('fail:' + ip)) || 0;
  const e = mem.fails.get(ip); if (!e || e.until < Date.now()) return 0; return e.n;
}
async function addFail(env, ip) {
  const ttl = Math.max(60, +cfg(env, 'LOCK_SECONDS'));
  const n = (await getFails(env, ip)) + 1;
  if (env.POSE_KV) await env.POSE_KV.put('fail:' + ip, String(n), { expirationTtl: ttl });
  else mem.fails.set(ip, { n, until: Date.now() + ttl * 1000 });
  return n;
}
async function clearFails(env, ip) { if (env.POSE_KV) await env.POSE_KV.delete('fail:' + ip); else mem.fails.delete(ip); }
async function dayCount(env) {
  const k = 'day:' + seoulDay();
  if (env.POSE_KV) return +(await env.POSE_KV.get(k)) || 0;
  return mem.day.key === k ? mem.day.n : 0;
}
async function dayIncr(env) {
  const k = 'day:' + seoulDay(), n = (await dayCount(env)) + 1;
  if (env.POSE_KV) await env.POSE_KV.put(k, String(n), { expirationTtl: 3 * 86400 });
  else mem.day = { key: k, n };
  return n;
}

function validate(body, env) {
  if (!body || typeof body !== 'object') return 'bad_request';
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) return 'bad_request';
  let total = 0;
  for (const m of messages) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') return 'bad_request';
    total += m.content.length;
  }
  if (messages[0].role !== 'user' || messages.at(-1).role !== 'user') return 'bad_request';
  if (total > +cfg(env, 'MAX_INPUT_CHARS')) return 'too_large';
  const models = cfg(env, 'ALLOWED_MODELS').split(',').map(s => s.trim()).filter(Boolean);
  if (body.model != null && !models.includes(body.model)) return 'model_not_allowed';
  return null;
}

async function callXai(env, model, messages) {
  const base = { model, messages: [{ role: 'system', content: SYSTEM }, ...messages.map(m => ({ role: m.role, content: m.content }))],
    max_tokens: Math.min(+cfg(env, 'MAX_TOKENS'), 8000) };
  const post = (rf) => fetch(cfg(env, 'XAI_URL'), { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XAI_API_KEY}` },
    body: JSON.stringify({ ...base, response_format: rf }) });
  let r = await post({ type: 'json_schema', json_schema: { name: 'pose', schema: SCHEMA, strict: true } });
  let data = await r.json().catch(() => null);
  const em = String(typeof data?.error === 'string' ? data.error : data?.error?.message || '').toLowerCase();
  if (r.status === 400 && /response_format|json_schema|schema/.test(em)) {
    r = await post({ type: 'json_object' }); data = await r.json().catch(() => null);
  }
  return { status: r.status, data };
}

function upstreamError(status, data) {
  const msg = String(typeof data?.error === 'string' ? data.error : data?.error?.message || '').toLowerCase();
  if (status === 401 || msg.includes('incorrect api key') || msg.includes('api key')) return ['upstream_auth', 502];
  if (msg.includes('credits') || msg.includes('spending limit') || status === 402) return ['no_credits', 402];
  if (status === 429) return ['upstream_rate', 429];
  return ['upstream_error', 502];
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const ch = cors(env, origin);
    if (req.method === 'OPTIONS') return ch ? new Response(null, { status: 204, headers: ch }) : new Response(null, { status: 403 });
    if (!ch) return json({ error: 'bad_origin' }, 403);
    if (req.method === 'GET' && url.pathname === '/health') return json({ ok: true, configured: !!env.XAI_API_KEY && !!env.PAGE_PASSWORD }, 200, ch);
    if (req.method !== 'POST' || url.pathname !== '/v1/pose') return json({ error: 'not_found' }, 404, ch);
    if (!env.XAI_API_KEY || !env.PAGE_PASSWORD) return json({ error: 'not_configured' }, 503, ch);
    const len = +(req.headers.get('Content-Length') || 0);
    if (len > 64 * 1024) return json({ error: 'too_large' }, 413, ch);
    const raw = await req.text();
    if (raw.length > 64 * 1024) return json({ error: 'too_large' }, 413, ch);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400, ch); }

    // 비밀번호
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const maxFails = +cfg(env, 'MAX_FAILS');
    if ((await getFails(env, ip)) >= maxFails) return json({ error: 'locked', retry_after: +cfg(env, 'LOCK_SECONDS') }, 429, ch);
    if (typeof body.password !== 'string' || !(await safeEqual(body.password, env.PAGE_PASSWORD))) {
      const n = await addFail(env, ip);
      await sleep(800 + Math.random() * 700); // 무차별 대입 늦추기
      return json({ error: n >= maxFails ? 'locked' : 'bad_password', remaining: Math.max(0, maxFails - n) }, n >= maxFails ? 429 : 401, ch);
    }
    await clearFails(env, ip);

    const bad = validate(body, env);
    if (bad) return json({ error: bad }, bad === 'too_large' ? 413 : 400, ch);

    // 하루 상한 (0이면 무제한)
    const limit = +cfg(env, 'DAILY_LIMIT');
    if (limit > 0 && (await dayCount(env)) >= limit) return json({ error: 'daily_limit', limit }, 429, ch);
    const used = await dayIncr(env);

    const model = body.model || cfg(env, 'DEFAULT_MODEL');
    let up;
    try { up = await callXai(env, model, body.messages); }
    catch { return json({ error: 'upstream_down' }, 502, ch); }
    if (up.status !== 200) { const [code, st] = upstreamError(up.status, up.data); return json({ error: code }, st, ch); }
    const choice = up.data?.choices?.[0];
    const c = choice?.message?.content;
    return json({ content: Array.isArray(c) ? c.map(x => x.text || '').join('') : (c || ''), refusal: choice?.message?.refusal || null,
      finish_reason: choice?.finish_reason || null, model, used_today: used, daily_limit: limit }, 200, ch);
  },
};
