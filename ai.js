// 말로 포즈 만들기 — 사용자 본인의 API 키로 xAI Grok(기본) / OpenAI / Gemini를 브라우저에서 직접 호출
import { loadPoseJson, buildJson, NAMES, state } from './app.js';

const $ = (id) => document.getElementById(id);
const LS = { provider: 'poseSkel.ai.provider', model: (p) => `poseSkel.ai.model.${p}`, key: (p) => `poseSkel.ai.key.${p}` };
export const PROVIDERS = {
  xai: { name: 'xAI Grok', defaultModel: 'grok-4.7', models: ['grok-4.7', 'grok-4.3', 'grok-4.20-0309-non-reasoning', 'grok-4.20-0309-reasoning'],
    keyUrl: 'https://console.x.ai', keyHint: 'xai-로 시작해요' },
  openai: { name: 'OpenAI', defaultModel: 'gpt-6.1-terra', models: ['gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
    keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-로 시작해요' },
  gemini: { name: 'Google Gemini', defaultModel: 'gemini-flash-latest', models: ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza로 시작해요' },
};

// ---------- 기준 자세 / 뼈 길이 ----------
const REF = { nose:[0,0.62,0.09], neck:[0,0.5,0], r_shoulder:[-0.18,0.48,0], r_elbow:[-0.24,0.22,0], r_wrist:[-0.26,-0.03,0.03],
  l_shoulder:[0.18,0.48,0], l_elbow:[0.24,0.22,0], l_wrist:[0.26,-0.03,0.03], r_hip:[-0.1,0,0], r_knee:[-0.11,-0.42,0.01], r_ankle:[-0.12,-0.82,-0.03],
  l_hip:[0.1,0,0], l_knee:[0.11,-0.42,0.01], l_ankle:[0.12,-0.82,-0.03], r_eye:[-0.035,0.665,0.07], l_eye:[0.035,0.665,0.07], r_ear:[-0.075,0.64,0], l_ear:[0.075,0.64,0] };
// [부모, 자식] — 부모부터 순서대로 고치고, 자식 쪽은 통째로 따라 움직임
const BONES = [['mid_hip','r_hip'],['mid_hip','l_hip'],['r_hip','r_knee'],['r_knee','r_ankle'],['l_hip','l_knee'],['l_knee','l_ankle'],
  ['neck','r_shoulder'],['r_shoulder','r_elbow'],['r_elbow','r_wrist'],['neck','l_shoulder'],['l_shoulder','l_elbow'],['l_elbow','l_wrist'],['neck','nose']];
const CHILDREN = { r_hip:['r_knee','r_ankle'], l_hip:['l_knee','l_ankle'], r_knee:['r_ankle'], l_knee:['l_ankle'], r_shoulder:['r_elbow','r_wrist'],
  l_shoulder:['l_elbow','l_wrist'], r_elbow:['r_wrist'], l_elbow:['l_wrist'], nose:['r_eye','l_eye','r_ear','l_ear'] };
const v = { sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], mul:(a,k)=>[a[0]*k,a[1]*k,a[2]*k],
  len:(a)=>Math.hypot(a[0],a[1],a[2]), mid:(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],
  norm:(a)=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; }, cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]] };
const withMid = (k) => ({ ...k, mid_hip: v.mid(k.r_hip, k.l_hip) });
const REFM = withMid(REF);
const REF_LEN = Object.fromEntries(BONES.map(([a, b]) => [a+'>'+b, v.len(v.sub(REFM[b], REFM[a]))]));
const TORSO = v.len(v.sub(REFM.neck, REFM.mid_hip));

// ---------- 응답 검증 / 정리 ----------
export class PoseError extends Error {}
function toVec(x) {
  if (Array.isArray(x) && x.length >= 3) x = { x: x[0], y: x[1], z: x[2] };
  if (!x || typeof x !== 'object') return null;
  const a = [+x.x, +x.y, +x.z];
  return a.every(Number.isFinite) && a.every(n => Math.abs(n) < 1000) ? a : null;
}
function parseText(text) {
  if (typeof text !== 'string') throw new PoseError('빈 응답');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new PoseError('JSON이 아님');
  try { return JSON.parse(t.slice(s, e + 1)); } catch { throw new PoseError('JSON 문법 오류'); }
}
// 반환: { people:[{keypoints:{name:[x,y,z]}}], description, fixes:[...] }
export function sanitizeReply(raw) {
  const data = typeof raw === 'string' ? parseText(raw) : raw;
  let people = Array.isArray(data) ? data : data?.people;
  if (!people && data?.keypoints) people = [data];
  if (!Array.isArray(people) || !people.length) throw new PoseError('people 배열이 없음');
  if (people.length > 6) people = people.slice(0, 6);
  const fixes = [];
  const out = people.map((p, pi) => {
    const src = p?.keypoints || p;
    const k = {};
    NAMES.forEach(n => { const a = toVec(src?.[n]); if (a) k[n] = a; });
    const core = ['r_shoulder','l_shoulder','r_hip','l_hip'].filter(n => !k[n]);
    if (core.length) throw new PoseError(`${pi+1}번째 사람에 필수 관절(${core.join(', ')})이 없음`);
    for (const [a, b] of [['r_elbow','r_shoulder'],['r_wrist','r_elbow'],['l_elbow','l_shoulder'],['l_wrist','l_elbow'],['r_knee','r_hip'],['r_ankle','r_knee'],['l_knee','l_hip'],['l_ankle','l_knee']]) {
      if (!k[a]) { k[a] = v.add(k[b], v.sub(REF[a], REF[b])); fixes.push(`${a} 없음 → 기본 방향으로 채움`); }
    }
    if (!k.neck) { k.neck = v.mid(k.r_shoulder, k.l_shoulder); fixes.push('neck 없음 → 어깨 가운데'); }
    return k;
  });
  // 단위 맞추기 (cm 등) — 사람들 몸통 길이의 중앙값을 0.5m로
  const torsos = out.map(k => v.len(v.sub(k.neck, v.mid(k.r_hip, k.l_hip)))).sort((a, b) => a - b);
  const t = torsos[Math.floor(torsos.length / 2)];
  if (!(t > 1e-6)) throw new PoseError('몸통 길이가 0');
  const scale = TORSO / t;
  if (Math.abs(scale - 1) > 0.25) fixes.push(`크기 보정 ×${scale.toFixed(3)}`);
  out.forEach(k => Object.keys(k).forEach(n => k[n] = v.mul(k[n], scale)));
  // 뼈 길이 보정
  out.forEach((k0, pi) => {
    const k = withMid(k0);
    if (!k.nose) { const s = v.norm(v.sub(k.l_shoulder, k.r_shoulder)); const f = v.norm(v.cross(s, [0,1,0])); k.nose = v.add(k.neck, v.add([0,0.12,0], v.mul(f, 0.09))); fixes.push('nose 없음 → 채움'); }
    for (const [a, b] of BONES) {
      const exp = REF_LEN[a+'>'+b]; let d = v.sub(k[b], k[a]); const L = v.len(d);
      let target = null;
      if (L < 1e-4) { d = v.sub(REFM[b], REFM[a]); target = exp; }
      else if (L / exp < 0.6 || L / exp > 1.5) target = exp;
      if (target != null) {
        const nb = v.add(k[a], v.mul(v.norm(d), target)), delta = v.sub(nb, k[b]);
        k[b] = nb; (CHILDREN[b] || []).forEach(c => { if (k[c]) k[c] = v.add(k[c], delta); });
        fixes.push(`${pi+1}번 ${a}→${b} 길이 ${L.toFixed(2)}m → ${target.toFixed(2)}m`);
      }
    }
    // 눈·귀가 없으면 얼굴 방향으로 채움
    const s = v.norm(v.sub(k.l_shoulder, k.r_shoulder)); let f = v.norm(v.cross(s, [0,1,0]));
    const up = v.norm(v.sub(k.nose, k.neck)); const hc = v.sub(k.nose, v.mul(f, 0.08));
    const fill = (n, p) => { if (!k[n]) { k[n] = p; fixes.push(`${n} 없음 → 채움`); } };
    fill('r_eye', v.add(k.nose, v.add(v.mul(up, 0.04), v.add(v.mul(f, -0.02), v.mul(s, -0.035)))));
    fill('l_eye', v.add(k.nose, v.add(v.mul(up, 0.04), v.add(v.mul(f, -0.02), v.mul(s, 0.035)))));
    fill('r_ear', v.add(hc, v.add(v.mul(up, 0.02), v.mul(s, -0.075))));
    fill('l_ear', v.add(hc, v.add(v.mul(up, 0.02), v.mul(s, 0.075))));
    delete k.mid_hip; out[pi] = k;
  });
  const bad = fixes.filter(f => f.includes('길이')).length;
  return { people: out.map(k => ({ keypoints: k })), description: typeof data.description_ko === 'string' ? data.description_ko.slice(0, 300) : '', fixes, badBones: bad };
}
export function toPoseFile(res, view) {
  return { format: 'pose-skeleton/v1', view: view || { yaw_deg: 0, pitch_deg: 0 },
    people: res.people.map(p => ({ pose_keypoints_3d: NAMES.flatMap(n => [...p.keypoints[n].map(x => +x.toFixed(4)), 1]) })) };
}

// ---------- 프롬프트 / 스키마 ----------
const JOINT_SCHEMA = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x','y','z'], additionalProperties: false };
export const SCHEMA = { type: 'object', additionalProperties: false, required: ['description_ko', 'people'], properties: {
  description_ko: { type: 'string' },
  people: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keypoints'], properties: {
    keypoints: { type: 'object', additionalProperties: false, required: NAMES, properties: Object.fromEntries(NAMES.map(n => [n, JOINT_SCHEMA])) } } } } } };
const toGemini = (s) => { // OpenAPI 하위집합(대문자 타입, additionalProperties 없음)
  const o = { type: s.type.toUpperCase() };
  if (s.properties) { o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, x]) => [k, toGemini(x)])); o.propertyOrdering = Object.keys(s.properties); }
  if (s.required) o.required = s.required; if (s.items) o.items = toGemini(s.items); return o; };

const SYSTEM = `You convert a natural-language description (usually Korean) of a human body pose into 3D joint coordinates for a pose-reference tool (OpenPose COCO-18 skeleton).
Coordinate system: meters, right-handed. +y is UP, +x is the viewer's right in the front view, +z points toward the front camera (out of the screen).
In the neutral orientation the person FACES +z (toward the camera), so the person's RIGHT side is at -x and LEFT side is at +x.
"오른손/오른팔/오른쪽" always means the PERSON's right (r_*), not the viewer's. "몸을 왼쪽으로 튼다" = rotate the upper body about the vertical axis toward the person's left (the chest turns toward +x).
Origin: mid-point of the hips at (0,0,0). Feet are on the ground (ankles near y=-0.82 when standing straight; lower when crouching the hips drop instead — keep ankles at the lowest point).
Typical adult proportions (keep these lengths!): neck→mid-hip 0.50, neck→each shoulder 0.18, upper arm 0.27, forearm 0.25, mid-hip→each hip 0.10, thigh 0.42, shin 0.40, neck→nose 0.15, eyes 0.035 beside the nose midline and 0.045 above it, ears 0.075 to each side of the head center.
Reference standing pose (arms down): ${JSON.stringify(REF)}
Rules: output ONLY the JSON object matching the schema. Every person must have all 18 keypoints as {x,y,z}. Keep the body anatomically plausible (elbows/knees bend the natural way, no limb stretching). Eyes/ears/nose follow the head direction.
If several people are requested, place them side by side about 0.8 m apart in x, each with its own hips (do not overlap them).
"description_ko": one short polite Korean sentence (존댓말) describing what you made.`;

function userMessage(text, current) {
  if (current) return `Current pose (edit THIS pose; keep everything that the instruction does not mention unchanged):\n${JSON.stringify(current)}\n\nInstruction: ${text}`;
  return `Create this pose: ${text}`;
}
export function currentPoseForPrompt() {
  const j = buildJson();
  return { people: j.people.map(p => { const a = p.pose_keypoints_3d, k = {};
    NAMES.forEach((n, i) => { k[n] = { x: +a[i*4].toFixed(3), y: +a[i*4+1].toFixed(3), z: +a[i*4+2].toFixed(3) }; }); return { keypoints: k }; }) };
}

// ---------- 호출 ----------
export class ApiError extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }
async function postJson(url, headers, body, signal) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal }); }
  catch (e) { if (e.name === 'AbortError') throw new ApiError('응답이 너무 오래 걸려서 멈췄어요. 잠시 후 다시 해 주세요.', 'timeout');
    throw new ApiError('인터넷 연결을 확인해 주세요. (서버에 연결하지 못했어요)', 'network'); }
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function friendlyError(provider, status, data) {
  const err = typeof data?.error === 'string' ? { message: data.error, code: data.code } : (data?.error || {});
  const code = err.code || err.status || ''; const msg = (err.message || '').toLowerCase();
  const reason = JSON.stringify(err.details || '').toUpperCase();
  if (status === 401 || code === 'invalid_api_key' || reason.includes('API_KEY_INVALID') || msg.includes('api key not valid') || msg.includes('incorrect api key'))
    return new ApiError('API 키가 올바르지 않아요. 설정에서 키를 다시 확인해 주세요.', 'auth');
  if (code === 'insufficient_quota' || msg.includes('billing') || msg.includes('credits') || msg.includes('spending limit') || (msg.includes('quota') && provider !== 'gemini'))
    return new ApiError('API 사용 한도나 결제 잔액이 부족해요. 제공사 사이트에서 결제·한도를 확인해 주세요.', 'quota');
  if (status === 429) return new ApiError(provider === 'gemini' ? '무료 사용량(또는 분당 요청 수)을 넘었어요. 잠시 후 다시 해 주세요.' : '요청이 너무 많아요. 잠시 후 다시 해 주세요.', 'rate');
  if (status === 403) return new ApiError('이 키로는 이 모델을 쓸 권한이 없어요. 키 설정(또는 API 사용 설정)을 확인해 주세요.', 'forbidden');
  if (status === 404 || code === 'model_not_found' || (status === 400 && msg.includes('model') && /not found|does not exist|not supported|unsupported/.test(msg))) return new ApiError('모델 이름을 찾을 수 없어요. 설정에서 모델을 기본값으로 바꿔 보세요.', 'model');
  if (status >= 500) return new ApiError('AI 서버에 일시적인 문제가 있어요. 잠시 후 다시 해 주세요.', 'server');
  return new ApiError(`요청이 실패했어요 (${status}) ${err.message ? '· ' + err.message.slice(0, 120) : ''}`, 'other');
}
const reasoningModel = (m) => /^(gpt-5|gpt-6|o\d)/.test(m);
async function callOpenAI({ key, model, messages, signal }) {
  const body = { model, input: messages.map(m => ({ role: m.role === 'system' ? 'developer' : m.role, content: m.content })),
    text: { format: { type: 'json_schema', name: 'pose', schema: SCHEMA, strict: true } } };
  if (reasoningModel(model)) body.reasoning = { effort: 'low' };
  let status, data;
  try { ({ status, data } = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${key}` }, body, signal)); }
  catch (e) { // OpenAI는 키 오류(401) 응답에 CORS 헤더가 없어 브라우저에선 연결 실패처럼 보여요
    if (e.kind === 'network') throw new ApiError('OpenAI에 연결하지 못했어요. API 키가 맞는지, 인터넷이 연결돼 있는지 확인해 주세요.', 'network');
    throw e; }
  if (status !== 200) throw friendlyError('openai', status, data);
  if (data?.status === 'incomplete') throw new PoseError('응답이 중간에 끊김');
  const parts = (data?.output || []).flatMap(o => o.content || []);
  const refusal = parts.find(c => c.type === 'refusal'); if (refusal) throw new ApiError('AI가 이 요청을 거절했어요. 다르게 표현해 보세요.', 'refusal');
  const text = data?.output_text || parts.filter(c => c.type === 'output_text').map(c => c.text).join('');
  return text;
}
async function callXai({ key, model, messages, signal }) {
  const url = 'https://api.x.ai/v1/chat/completions';
  const base = { model, messages: messages.map(m => ({ role: m.role, content: m.content })) };
  let { status, data } = await postJson(url, { Authorization: `Bearer ${key}` }, { ...base,
    response_format: { type: 'json_schema', json_schema: { name: 'pose', schema: SCHEMA, strict: true } } }, signal);
  const em = String(typeof data?.error === 'string' ? data.error : data?.error?.message || '').toLowerCase();
  if (status === 400 && /response_format|json_schema|schema/.test(em)) { // 스키마를 못 받는 모델이면 json_object로
    ({ status, data } = await postJson(url, { Authorization: `Bearer ${key}` }, { ...base, response_format: { type: 'json_object' } }, signal));
  }
  if (status !== 200) throw friendlyError('xai', status, data);
  const ch = data?.choices?.[0];
  if (ch?.message?.refusal) throw new ApiError('AI가 이 요청을 거절했어요. 다르게 표현해 보세요.', 'refusal');
  if (ch?.finish_reason === 'content_filter') throw new ApiError('AI가 이 요청에 답하지 않았어요. 다르게 표현해 보세요.', 'blocked');
  const c = ch?.message?.content;
  return Array.isArray(c) ? c.map(x => x.text || '').join('') : (c || '');
}
async function callGemini({ key, model, messages, signal }) {
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { systemInstruction: { parts: [{ text: sys }] }, contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGemini(SCHEMA), temperature: 0.4 } };
  const { status, data } = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, body, signal);
  if (status !== 200) throw friendlyError('gemini', status, data);
  const cand = data?.candidates?.[0];
  if (!cand) throw new ApiError(data?.promptFeedback?.blockReason ? 'AI가 이 요청을 막았어요. 다르게 표현해 보세요.' : 'AI가 빈 응답을 보냈어요. 다시 해 주세요.', 'empty');
  if (cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) throw new ApiError('AI가 이 요청에 답하지 않았어요. 다르게 표현해 보세요.', 'blocked');
  return (cand.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
}

export async function generatePose({ provider, key, model, text, current, signal, onRetry }) {
  const call = { xai: callXai, gemini: callGemini, openai: callOpenAI }[provider] || callXai;
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMessage(text, current) }];
  let reply = await call({ key, model, messages, signal }), res, problem;
  try { res = sanitizeReply(reply); if (res.badBones > 3) problem = `Several limb lengths were implausible (${res.fixes.filter(f => f.includes('길이')).join('; ')}).`; }
  catch (e) { if (!(e instanceof PoseError)) throw e; problem = `Your reply was invalid: ${e.message}.`; }
  if (problem) { // 한 번만 다시 요청
    onRetry?.();
    messages.push({ role: 'assistant', content: String(reply).slice(0, 6000) },
      { role: 'user', content: `${problem} Reply again with ONLY valid JSON matching the schema, all 18 keypoints per person, realistic limb lengths (meters).` });
    reply = await call({ key, model, messages, signal });
    try { res = sanitizeReply(reply); }
    catch (e) { if (!res) throw new ApiError('AI가 올바른 포즈를 보내지 않았어요. 설명을 조금 바꿔서 다시 해 보세요.', 'invalid'); }
  }
  return res;
}

// ---------- UI ----------
function init() {
  const prov = $('aiProvider'), model = $('aiModel'), key = $('aiKey'), dl = $('aiModels');
  const load = () => {
    const p = prov.value, P = PROVIDERS[p];
    model.value = localStorage.getItem(LS.model(p)) || P.defaultModel; model.placeholder = P.defaultModel;
    key.value = localStorage.getItem(LS.key(p)) || ''; key.placeholder = `${P.name} API 키 (${P.keyHint})`;
    dl.innerHTML = P.models.map(m => `<option value="${m}">`).join('');
    $('aiKeyLink').href = P.keyUrl; $('aiKeyLink').textContent = `${P.name} 키 발급 페이지`;
    $('aiKeyState').textContent = key.value ? '키 저장됨 (이 브라우저)' : '키 없음';
  };
  prov.value = PROVIDERS[localStorage.getItem(LS.provider)] ? localStorage.getItem(LS.provider) : 'xai'; load();
  prov.onchange = () => { localStorage.setItem(LS.provider, prov.value); load(); };
  model.onchange = () => { const m = model.value.trim(); m ? localStorage.setItem(LS.model(prov.value), m) : localStorage.removeItem(LS.model(prov.value)); if (!m) load(); };
  key.onchange = () => { const k = key.value.trim(); k ? localStorage.setItem(LS.key(prov.value), k) : localStorage.removeItem(LS.key(prov.value)); load(); };
  $('aiClearKey').onclick = () => { Object.keys(PROVIDERS).forEach(p => localStorage.removeItem(LS.key(p))); load(); setAi('저장된 키를 모두 지웠어요.', 'ok'); };
  $('aiReset').onclick = () => { localStorage.removeItem(LS.model(prov.value)); load(); };

  let busy = false, ctrl = null;
  $('aiGo').onclick = async () => {
    if (busy) { ctrl?.abort(); return; }
    const text = $('aiText').value.trim(); if (!text) { setAi('어떤 자세인지 적어 주세요.', 'err'); return; }
    const p = prov.value, k = localStorage.getItem(LS.key(p)) || key.value.trim();
    if (!k) { $('aiSettings').open = true; setAi(`먼저 설정에서 ${PROVIDERS[p].name} API 키를 넣어 주세요.`, 'err'); key.focus(); return; }
    const m = model.value.trim() || PROVIDERS[p].defaultModel;
    const current = $('aiEdit').checked && state.people.length ? currentPoseForPrompt() : null;
    busy = true; ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
    $('aiGo').textContent = '멈추기'; setAi(current ? '지금 포즈를 고치는 중이에요…' : '포즈를 만드는 중이에요… (10~40초쯤 걸릴 수 있어요)');
    try {
      const res = await generatePose({ provider: p, key: k, model: m, text, current, signal: ctrl.signal, onRetry: () => setAi('응답이 이상해서 한 번 더 요청하는 중이에요…') });
      loadPoseJson(toPoseFile(res, { yaw_deg: 20, pitch_deg: 8 }));
      $('aiEdit').checked = true;
      const fixNote = res.fixes.length ? ` (자동 보정 ${res.fixes.length}곳)` : '';
      setAi((res.description || '포즈를 만들었어요.') + fixNote + ' 돌려 보거나 관절을 끌어 고칠 수 있어요.', 'ok');
      if (res.fixes.length) console.info('자동 보정:', res.fixes);
      const hist = $('aiHistory'); const li = document.createElement('li'); li.textContent = (current ? '✏️ ' : '🆕 ') + text; hist.prepend(li);
    } catch (e) {
      console.error(e);
      setAi(e instanceof ApiError ? e.message : (e.name === 'AbortError' ? '멈췄어요.' : '포즈를 만들지 못했어요. 다시 해 주세요.'), 'err');
    } finally { clearTimeout(timer); busy = false; $('aiGo').textContent = '만들기'; }
  };
  $('aiText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('aiGo').click(); });
}
function setAi(msg, cls = '') { const el = $('aiStatus'); el.textContent = msg; el.className = 'status ' + cls; }
init();
window.poseAI = { sanitizeReply, generatePose, SCHEMA, toPoseFile, PROVIDERS, currentPoseForPrompt };
