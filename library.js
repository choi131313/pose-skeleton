// 보관함 — 말로 만든 포즈(프롬프트 + 결과 포즈)와 직접 담은 포즈를 이 브라우저(IndexedDB)에 저장
import { loadPoseJson, buildJson, renderAngles, state } from './app.js';

const $ = (id) => document.getElementById(id);
const DB = 'pose-skeleton', STORE = 'library', FORMAT = 'pose-skeleton-library/v1';
let db = null, items = [], memOnly = false;

function openDb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = (mode, fn) => new Promise((res, rej) => {
  if (memOnly) return res(fn(null));
  const t = db.transaction(STORE, mode), st = t.objectStore(STORE); let out; const r = fn(st);
  if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
  t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
});
const putItem = (it) => memOnly ? null : tx('readwrite', st => st.put(it));
const delItem = (id) => memOnly ? null : tx('readwrite', st => st.delete(id));
async function loadAll() { items = memOnly ? items : ((await tx('readonly', st => st.getAll())) || []); items.sort((a, b) => (b.created || '').localeCompare(a.created || '')); }

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
function say(msg, cls = 'ok') { const el = $('status'); if (el) { el.textContent = msg; el.className = 'status ' + cls; } }
function thumb(view) { // 지금 포즈를 같은 각도에서 작은 마네킹 그림으로
  try { const [r] = renderAngles([{ key: 'thumb', name: '', yaw: view?.yaw_deg || 0, pitch: view?.pitch_deg || 0 }], 120, 160, 1, 0.05, 'mannequin');
    return r.canvas.toDataURL('image/jpeg', 0.82); } catch (e) { console.warn('thumb', e); return ''; }
}
const dateKo = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const shortName = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '이름 없는 포즈';

export async function addCurrent({ prompt = '', description = '', source = 'manual', name, usage = null } = {}) {
  if (!state.people.length) { say('담을 포즈가 없어요.', 'err'); return null; }
  const pose = buildJson();
  const it = { id: newId(), name: name || shortName(prompt) || '포즈', prompt, description, source, created: new Date().toISOString(),
    thumb: thumb(pose.view), pose, usage: usage && usage.requests ? { total: usage.total, usd: usage.usd } : undefined };
  items.unshift(it); await putItem(it); render(); return it;
}

function render() {
  const q = ($('libSearch').value || '').trim().toLowerCase();
  const list = q ? items.filter(it => `${it.name} ${it.prompt} ${it.description}`.toLowerCase().includes(q)) : items;
  $('libCount').textContent = items.length ? `(${items.length})` : '';
  const ul = $('libList'); ul.innerHTML = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'libEmpty';
    li.textContent = items.length ? '찾는 포즈가 없어요.' : '아직 비어 있어요. 말로 포즈를 만들거나 ‘지금 포즈 담기’를 눌러 보세요.'; ul.appendChild(li); return; }
  for (const it of list) {
    const li = document.createElement('li'); li.className = 'libItem'; li.dataset.id = it.id;
    const img = document.createElement('img'); img.alt = ''; if (it.thumb) img.src = it.thumb; img.title = '불러오기'; img.onclick = () => loadItem(it);
    const meta = document.createElement('div'); meta.className = 'libMeta';
    const nm = document.createElement('div'); nm.className = 'libName'; nm.textContent = it.name;
    const pr = document.createElement('div'); pr.className = 'libPrompt'; pr.textContent = it.prompt ? (it.source === 'edit' ? '✏️ ' : '💬 ') + it.prompt : (it.description || '직접 담은 포즈'); pr.title = it.prompt || '';
    const dt = document.createElement('div'); dt.textContent = dateKo(it.created) + (it.usage?.total ? ` · ${it.usage.total.toLocaleString('ko-KR')}토큰` : '');
    meta.append(nm, pr, dt);
    const btns = document.createElement('div'); btns.className = 'libBtns';
    const mk = (t, title, fn) => { const b = document.createElement('button'); b.textContent = t; b.title = title; b.onclick = fn; btns.appendChild(b); return b; };
    mk('불러오기', '보기에 불러오기', () => loadItem(it)).className = 'libLoad';
    mk('✏️', '이름 바꾸기', () => renameItem(it)).className = 'libRename';
    mk('🗑', '삭제', () => deleteItem(it)).className = 'libDelete';
    meta.appendChild(btns); li.append(img, meta); ul.appendChild(li);
  }
}
function loadItem(it) {
  try { loadPoseJson(it.pose); if (it.prompt) $('aiText').value = it.prompt; if ($('aiEdit')) $('aiEdit').checked = true;
    say(`보관함에서 ‘${it.name}’을(를) 불러왔어요.`); } catch (e) { console.error(e); say('불러오지 못했어요: ' + e.message, 'err'); }
}
async function renameItem(it) {
  const v = prompt('새 이름', it.name); if (v == null) return; const n = v.trim().slice(0, 60); if (!n) return;
  it.name = n; await putItem(it); render();
}
async function deleteItem(it) {
  if (!confirm(`‘${it.name}’을(를) 지울까요?`)) return;
  items = items.filter(x => x.id !== it.id); await delItem(it.id); render();
}
function exportAll() {
  const data = { format: FORMAT, exported: new Date().toISOString(), items };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `pose_library_${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  say(`보관함 ${items.length}개를 파일로 내보냈어요.`); return data;
}
export async function importData(data) {
  if (typeof data === 'string') data = JSON.parse(data);
  let list = Array.isArray(data) ? data : data?.format === FORMAT ? data.items : null;
  if (!list && (data?.people || data?.pose_keypoints_3d)) list = [{ name: '가져온 포즈', pose: data }]; // 포즈 파일 하나
  if (!Array.isArray(list)) throw new Error('보관함 파일 형식이 아니에요');
  const have = new Set(items.map(x => x.id)); let added = 0;
  const keep = state.people.length ? buildJson() : null; let touched = false;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || !raw.pose || !(raw.pose.people || raw.pose.pose_keypoints_3d)) continue;
    if (raw.id && have.has(raw.id)) continue;
    const it = { id: raw.id && typeof raw.id === 'string' ? raw.id : newId(), name: shortName(raw.name || raw.prompt), prompt: String(raw.prompt || '').slice(0, 2000),
      description: String(raw.description || '').slice(0, 400), source: ['ai', 'edit', 'manual'].includes(raw.source) ? raw.source : 'manual',
      created: raw.created && !isNaN(new Date(raw.created)) ? raw.created : new Date().toISOString(),
      thumb: typeof raw.thumb === 'string' && raw.thumb.startsWith('data:image/') ? raw.thumb : '', pose: raw.pose, usage: raw.usage };
    if (!it.thumb) { try { loadPoseJson(it.pose); touched = true; it.thumb = thumb(it.pose.view); } catch { continue; } }
    items.push(it); have.add(it.id); await putItem(it); added++;
  }
  if (touched && keep) loadPoseJson(keep); // 썸네일 만들려고 바꾼 화면 되돌리기
  items.sort((a, b) => (b.created || '').localeCompare(a.created || '')); render(); return added;
}

async function init() {
  try { db = await openDb(); } catch { memOnly = true; }
  await loadAll().catch(() => { memOnly = true; });
  $('libAuto').checked = localStorage.getItem('poseSkel.lib.auto') !== '0';
  $('libAuto').onchange = () => localStorage.setItem('poseSkel.lib.auto', $('libAuto').checked ? '1' : '0');
  $('libSave').onclick = async () => { const it = await addCurrent({ name: `포즈 ${dateKo(new Date().toISOString())}` }); if (it) say(`보관함에 ‘${it.name}’을(를) 담았어요.`); };
  $('libExport').onclick = exportAll;
  $('libImportBtn').onclick = () => $('libImport').click();
  $('libImport').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const n = await importData(await f.text()); say(n ? `보관함에 ${n}개를 가져왔어요.` : '새로 가져올 포즈가 없어요 (이미 있는 것은 건너뛰어요).'); }
    catch (err) { console.error(err); say('가져오지 못했어요: ' + err.message, 'err'); } };
  $('libSearch').oninput = render;
  document.addEventListener('pose:generated', (e) => { if (!$('libAuto').checked) return; const d = e.detail || {};
    addCurrent({ prompt: d.prompt, description: d.description, source: d.edited ? 'edit' : 'ai', usage: d.usage }).catch(err => console.warn('보관함 저장 실패', err)); });
  render();
  if (memOnly) say('이 브라우저에서는 보관함을 저장할 수 없어서, 새로고침하면 사라져요.', 'err');
}
init();
window.poseLib = { addCurrent, importData, exportAll, get items() { return items; } };
