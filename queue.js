// 대기열 — 여러 프롬프트를 한 번에 하나씩 차례로 만들기 (병렬 없음). 결과는 보관함에 항상 저장
const $ = (id) => document.getElementById(id);
const LSQ = 'poseSkel.queue', MAX = 100, EST = [40, 70]; // 1개 어림 요금(원)
const FATAL = new Set(['password', 'locked', 'daily', 'quota', 'auth', 'origin', 'nokey', 'forbidden', 'model', 'too_large']);
const LABEL = { wait: '대기', run: '만드는 중', done: '완료', fail: '실패' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

let deps = null, items = [], running = false, pausing = false, stopping = false, stopCtrl = null;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function save() { try { localStorage.setItem(LSQ, JSON.stringify(items)); } catch {} }
function load() {
  try { const a = JSON.parse(localStorage.getItem(LSQ)); if (Array.isArray(a)) items = a.filter(x => x && typeof x.text === 'string').slice(0, MAX); } catch {}
  items.forEach(x => { if (x.status === 'run' || !LABEL[x.status]) x.status = 'wait'; x.tokens = +x.tokens || 0; x.usd = +x.usd || 0; x.usdUnknown = +x.usdUnknown || 0; });
}
function say(msg, cls = '') { const el = $('qStatus'); el.textContent = msg; el.className = 'status ' + cls; el.hidden = !msg; }
function remaining() { const sd = deps.provider() === 'server' ? deps.serverDay() : null; return sd ? Math.max(0, sd.daily_limit - sd.used_today) : null; }
const LIMIT_MSG = () => `오늘 서버에서 쓸 수 있는 횟수(${deps.serverDay()?.daily_limit ?? 200}번)를 다 써서 대기열을 멈췄어요. 남은 항목은 그대로 있으니 내일 ‘시작’을 눌러 주세요.`;

export function addPrompts(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
  const room = MAX - items.length, add = lines.slice(0, Math.max(0, room));
  add.forEach(t => items.push({ id: newId(), text: t.slice(0, 1000), status: 'wait', tokens: 0, usd: 0, usdUnknown: 0 }));
  save(); render();
  if (lines.length > add.length) say(`대기열은 ${MAX}개까지예요. ${lines.length - add.length}개는 넣지 못했어요.`, 'err');
  return add.length;
}

function render() {
  const ul = $('qList'); ul.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li'); li.className = 'qItem q-' + it.status; li.dataset.id = it.id;
    const badge = document.createElement('span'); badge.className = 'qBadge'; badge.textContent = LABEL[it.status] + (it.status === 'run' && it.attempt > 1 ? ' (재시도)' : '');
    const tx = document.createElement('span'); tx.className = 'qText'; tx.textContent = it.text; tx.title = it.text + (it.error ? `\n실패: ${it.error}` : '');
    const info = document.createElement('span'); info.className = 'qInfo';
    info.textContent = it.status === 'fail' ? (it.error || '실패') : it.tokens ? `${fmt(it.tokens)}토큰` : '';
    const btns = document.createElement('span'); btns.className = 'qBtns';
    const mk = (t, title, fn, cls) => { const b = document.createElement('button'); b.textContent = t; b.title = title; b.className = cls; b.onclick = fn; btns.appendChild(b); };
    if (it.status !== 'run') {
      if (i > 0) mk('▲', '위로', () => move(i, -1), 'qUp');
      if (i < items.length - 1) mk('▼', '아래로', () => move(i, 1), 'qDown');
      if (it.status === 'fail' || it.status === 'done') mk('↻', '다시 만들기', () => { it.status = 'wait'; it.error = ''; save(); render(); }, 'qRetry');
      mk('✕', '빼기', () => { items = items.filter(x => x !== it); save(); render(); }, 'qDel');
    }
    li.append(badge, tx, info, btns); ul.appendChild(li);
  });
  const n = (s) => items.filter(x => x.status === s).length, wait = n('wait');
  const tot = items.reduce((a, x) => ({ t: a.t + x.tokens, u: a.u + x.usd, k: a.k + x.usdUnknown }), { t: 0, u: 0, k: 0 });
  const rem = remaining();
  $('qEst').textContent = wait ? `대기 ${wait}개 · 예상 약 ₩${fmt(EST[0] * wait)}~${fmt(EST[1] * wait)}${rem != null && wait > rem ? ` · 오늘 남은 횟수 ${rem}번보다 많아요` : ''}` : '';
  const done = n('done'), fail = n('fail');
  $('qTotal').hidden = !(done || fail || tot.t);
  $('qTotal').textContent = `대기열 합계: 완료 ${done} · 실패 ${fail} · ${fmt(tot.t)}토큰 · 약 ₩${fmt(tot.u * deps.KRW_PER_USD)}${tot.k ? '+α' : ''} ($${tot.u.toFixed(3)})`;
  $('qCount').textContent = items.length ? `(${items.length})` : '';
  $('qStart').disabled = running || !wait; $('qStart').textContent = done || fail ? '이어서 시작' : '시작';
  $('qPause').disabled = !running || pausing; $('qStop').disabled = !running;
  $('qClear').disabled = running || !(done || fail);
}
function move(i, d) { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; save(); render(); }

async function start() {
  if (running) return;
  if (deps.isBusy()) { say('지금 다른 포즈를 만드는 중이에요. 끝난 뒤 시작해 주세요.', 'err'); return; }
  if (!items.some(x => x.status === 'wait')) { say('대기 중인 항목이 없어요.', 'err'); return; }
  if (remaining() === 0) { say(LIMIT_MSG(), 'err'); return; }
  running = true; pausing = false; stopping = false; stopCtrl = new AbortController(); render();
  let endMsg = null, endCls = 'ok';
  while (true) {
    if (stopping) { endMsg = '대기열을 멈췄어요. 만들던 항목은 대기로 돌려놨어요.'; endCls = ''; break; }
    if (pausing) { endMsg = '일시정지했어요. ‘이어서 시작’을 누르면 계속해요.'; endCls = ''; break; }
    const it = items.find(x => x.status === 'wait');
    if (!it) break;
    if (remaining() === 0) { endMsg = LIMIT_MSG(); endCls = 'err'; break; }
    const pos = items.filter(x => x.status !== 'wait').length + 1;
    it.status = 'run'; it.error = ''; save();
    let ok = false, err = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      it.attempt = attempt; render();
      say(`${pos}/${items.length}번째 만드는 중… ${attempt > 1 ? '(한 번 더 시도) ' : ''}(하나에 20초~2분)`);
      try {
        await deps.runOne({ text: it.text, current: null, signal: stopCtrl.signal, force: true,
          onUsage: (t) => { it.tokens += t.total; it.usd += t.usd; it.usdUnknown += t.usdUnknown; } });
        ok = true; break;
      } catch (e) {
        err = e; console.warn('대기열 실패', it.text, e);
        if (stopping || FATAL.has(e.kind)) break;
        if (attempt === 1) await sleep(e.kind === 'rate' ? 5000 : 1500);
      }
    }
    if (stopping) { it.status = 'wait'; continue; }
    if (ok) it.status = 'done';
    else if (err && FATAL.has(err.kind)) { // 계속해도 똑같이 실패할 오류 → 멈춤
      it.status = 'wait'; save(); endCls = 'err';
      endMsg = err.kind === 'daily' ? LIMIT_MSG() : `${err.message} (대기열을 멈췄어요)`; break;
    } else { it.status = 'fail'; it.error = (err && err.message) || '포즈를 만들지 못했어요.'; }
    save(); render();
  }
  running = false; pausing = false; stopCtrl = null; save(); render();
  if (endMsg) say(endMsg, endCls);
  else { const f = items.filter(x => x.status === 'fail').length;
    say(`대기열을 다 돌았어요.${f ? ` 실패 ${f}개는 ↻로 다시 할 수 있어요.` : ''} 결과는 📚 보관함에 있어요.`, f ? 'err' : 'ok'); }
  stopping = false;
}

export function initQueue(d) {
  deps = d; load();
  $('qAdd').onclick = () => { const n = addPrompts($('qText').value); if (n) { $('qText').value = ''; say(`${n}개를 대기열에 넣었어요.`, 'ok'); } else say('넣을 내용을 한 줄에 하나씩 적어 주세요.', 'err'); };
  $('qFromAi').onclick = () => { const t = $('aiText').value.trim(); if (!t) { say('위 입력칸이 비어 있어요.', 'err'); return; } addPrompts(t.replace(/\r?\n/g, ' ')); say('위 입력칸 내용을 대기열에 넣었어요.', 'ok'); };
  $('qStart').onclick = start;
  $('qPause').onclick = () => { if (!running) return; pausing = true; render(); say('지금 만드는 항목이 끝나면 멈춰요.'); };
  $('qStop').onclick = () => { if (!running) return; stopping = true; stopCtrl?.abort(); render(); };
  $('qClear').onclick = () => { items = items.filter(x => x.status === 'wait' || x.status === 'run'); save(); render(); say(''); };
  document.addEventListener('pose:generated', () => render()); document.addEventListener('pose:usage', () => render()); // 서버 남은 횟수 갱신
  render(); say('');
  if (items.some(x => x.status === 'wait')) $('queueBox').open = true;
}
window.poseQueue = { running: () => running, items: () => items, addPrompts };
