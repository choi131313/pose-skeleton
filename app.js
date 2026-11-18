// 포즈 뼈대 만들기 — 사진 → (기기 안) MediaPipe PoseLandmarker → 3D OpenPose 18점 뼈대
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// ---------- OpenPose (COCO 18) 정의 ----------
export const NAMES = ['nose','neck','r_shoulder','r_elbow','r_wrist','l_shoulder','l_elbow','l_wrist',
  'r_hip','r_knee','r_ankle','l_hip','l_knee','l_ankle','r_eye','l_eye','r_ear','l_ear'];
const KO = ['코','목','오른어깨','오른팔꿈치','오른손목','왼어깨','왼팔꿈치','왼손목','오른골반','오른무릎','오른발목','왼골반','왼무릎','왼발목','오른눈','왼눈','오른귀','왼귀'];
// MediaPipe 33점 → OpenPose 18점 (-1 = 목: 두 어깨의 가운데)
const MP = [0,-1,12,14,16,11,13,15,24,26,28,23,25,27,5,2,8,7];
const LIMBS = [[1,2],[1,5],[2,3],[3,4],[5,6],[6,7],[1,8],[8,9],[9,10],[1,11],[11,12],[12,13],[1,0],[0,14],[14,16],[0,15],[15,17]];
const COLORS = [[255,0,0],[255,85,0],[255,170,0],[255,255,0],[170,255,0],[85,255,0],[0,255,0],[0,255,85],[0,255,170],
  [0,255,255],[0,170,255],[0,85,255],[0,0,255],[85,0,255],[170,0,255],[255,0,255],[255,0,170],[255,0,85]];
const FACE = new Set([14,15,16,17]);
const FOV = 35;

// 기본 자세 (미터, y 위, 정면 카메라는 +z 쪽, 사람의 오른쪽 = 화면 왼쪽 = -x)
const DEFAULT_POSE = [[0,0.62,0.09],[0,0.5,0],[-0.18,0.48,0],[-0.24,0.22,0],[-0.26,-0.03,0.03],[0.18,0.48,0],[0.24,0.22,0],[0.26,-0.03,0.03],
  [-0.1,0,0],[-0.11,-0.42,0.01],[-0.12,-0.82,-0.03],[0.1,0,0],[0.11,-0.42,0.01],[0.12,-0.82,-0.03],
  [-0.035,0.665,0.07],[0.035,0.665,0.07],[-0.075,0.64,0],[0.075,0.64,0]];

const $ = (id) => document.getElementById(id);
export const state = { people: [], photo: null, landmarker: {}, busy: false };
let pid = 0;

function setStatus(msg, cls='') { const el=$('status'); el.textContent = msg; el.className = 'status ' + cls; }
function showLoading(on, text='분석 중…') { $('loading').hidden = !on; $('loadingText').textContent = text; }

// ---------- three.js ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
const grid = new THREE.GridHelper(4, 20, 0x333a46, 0x1f242c);
scene.add(grid);
const peopleRoot = new THREE.Group(); scene.add(peopleRoot);

// 관절 끌기: OrbitControls보다 먼저 pointerdown을 받아야 해서 컨트롤 생성 전에 등록
const raycaster = new THREE.Raycaster();
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!$('editJoints').checked || e.button !== 0) return;
  const hit = pickJoint(e);
  if (!hit) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const n = new THREE.Vector3(); camera.getWorldDirection(n);
  drag = { p: hit.p, j: hit.j, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.p.pts[hit.j]), id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id) {
    setRay(e); const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(drag.plane, out)) { drag.p.pts[drag.j].copy(out); updatePerson(drag.p); dirty(); }
  } else if (!drag && e.pointerType === 'mouse') {
    canvas.style.cursor = ($('editJoints').checked && pickJoint(e)) ? 'grab' : '';
  }
});
const endDrag = (e) => { if (drag && e.pointerId === drag.id) { drag = null; dirty(); } };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.addEventListener('change', dirty);

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1), camera);
}
function pickJoint(e) {
  setRay(e);
  const hits = raycaster.intersectObjects(state.people.flatMap(p => p.hitMeshes), false);
  return hits.length ? hits[0].object.userData : null;
}

const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12); // 높이 1, y축
const rgb = (c, k=1) => new THREE.Color(c[0]*k/255, c[1]*k/255, c[2]*k/255);
const jointMats = COLORS.map(c => new THREE.MeshBasicMaterial({ color: rgb(c) }));
const limbMats = COLORS.map(c => new THREE.MeshBasicMaterial({ color: rgb(c, 0.6) }));
const hiddenMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5 });

function buildPerson(p) {
  p.group = new THREE.Group();
  p.jointMeshes = []; p.hitMeshes = []; p.limbMeshes = [];
  for (let j = 0; j < 18; j++) {
    const m = new THREE.Mesh(sphereGeo, jointMats[j]); m.scale.setScalar(0.022); p.group.add(m); p.jointMeshes.push(m);
    const h = new THREE.Mesh(sphereGeo, hiddenMat); h.visible = false; h.scale.setScalar(0.06); h.userData = { p, j }; p.group.add(h); p.hitMeshes.push(h);
  }
  LIMBS.forEach((l, i) => { const m = new THREE.Mesh(cylGeo, limbMats[i]); p.group.add(m); p.limbMeshes.push(m); });
  peopleRoot.add(p.group);
  updatePerson(p);
}
const UP = new THREE.Vector3(0,1,0);
function isOn(p, j) {
  if (p.vis[j] <= 0) return false;
  if (!$('face').checked && FACE.has(j)) return false;
  if ($('hideLow').checked && p.vis[j] < 0.5) return false;
  return true;
}
function updatePerson(p) {
  for (let j = 0; j < 18; j++) {
    p.jointMeshes[j].position.copy(p.pts[j]); p.hitMeshes[j].position.copy(p.pts[j]);
    const on = isOn(p, j);
    p.jointMeshes[j].material = on ? jointMats[j] : hiddenMat;
    p.jointMeshes[j].visible = p.vis[j] > 0;
  }
  LIMBS.forEach(([a, b], i) => {
    const m = p.limbMeshes[i], A = p.pts[a], B = p.pts[b];
    const d = new THREE.Vector3().subVectors(B, A), len = d.length();
    m.position.copy(A).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, len > 1e-6 ? d.clone().normalize() : UP);
    m.scale.set(0.012, Math.max(len, 1e-4), 0.012);
    m.visible = p.vis[a] > 0 && p.vis[b] > 0;
    m.material = (isOn(p, a) && isOn(p, b)) ? limbMats[i] : hiddenMat;
  });
}
function clearPeople() { state.people.forEach(p => peopleRoot.remove(p.group)); state.people = []; }
function addPerson(pts, vis, img2d=null) {
  const p = { id: ++pid, pts: pts.map(v => v.clone()), orig: pts.map(v => v.clone()), vis: vis.slice(), img2d };
  buildPerson(p); state.people.push(p); return p;
}

// ---------- 시점 ----------
function bounds() {
  const box = new THREE.Box3();
  state.people.forEach(p => p.pts.forEach((v, j) => { if (p.vis[j] > 0) box.expandByPoint(v); }));
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1,1.8,0.5));
  return box;
}
export function setView(yawDeg = 0, pitchDeg = 0) {
  const box = bounds(); const c = box.getCenter(new THREE.Vector3()); const s = box.getBoundingSphere(new THREE.Sphere());
  const dist = Math.max(s.radius, 0.3) / Math.sin(THREE.MathUtils.degToRad(FOV/2)) * 1.05;
  const y = THREE.MathUtils.degToRad(yawDeg), pt = THREE.MathUtils.degToRad(Math.max(-89.9, Math.min(89.9, pitchDeg)));
  controls.target.copy(c);
  camera.position.set(c.x + dist*Math.sin(y)*Math.cos(pt), c.y + dist*Math.sin(pt), c.z + dist*Math.cos(y)*Math.cos(pt));
  camera.up.set(0,1,0); camera.lookAt(c); controls.update();
  grid.position.y = box.min.y - 0.01; grid.position.x = c.x; grid.position.z = c.z;
  dirty();
}
function currentYawPitch() {
  const d = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  return { yaw_deg: +THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)).toFixed(1), pitch_deg: +THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, d.y)))).toFixed(1) };
}
const VIEWS = { front: [0,0], right: [90,0], back: [180,0], left: [-90,0], top: [0,89] };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(...VIEWS[b.dataset.view]));
$('resetView').onclick = () => setView(0, 0);
$('resetPose').onclick = () => { state.people.forEach(p => { p.pts = p.orig.map(v => v.clone()); updatePerson(p); }); dirty(); };
$('grid').onchange = () => { grid.visible = $('grid').checked; dirty(); };
['face','hideLow'].forEach(id => $(id).onchange = () => { state.people.forEach(updatePerson); dirty(); });

// ---------- 저장 크기 / 프레임 ----------
function exportSize() {
  const v = $('size').value;
  if (v === 'custom') return [clampSize($('cw').value), clampSize($('ch').value)];
  if (v === 'photo') {
    if (!state.photo) return [768, 1024];
    const { width: w, height: h } = state.photo; const k = 1024 / Math.max(w, h);
    return [Math.round(w*k/8)*8, Math.round(h*k/8)*8];
  }
  return v.split('x').map(Number);
}
const clampSize = (x) => Math.max(64, Math.min(4096, Math.round(+x || 512)));
$('size').onchange = () => { $('customWrap').hidden = $('size').value !== 'custom'; dirty(); };
['cw','ch','thick'].forEach(id => $(id).oninput = dirty);

function frameRect() { // 뷰포트 픽셀 기준 저장 범위
  const vw = canvas.clientWidth, vh = canvas.clientHeight, [W, H] = exportSize();
  const ae = W / H, m = 0.94; let fw, fh;
  if (ae > vw / vh) { fw = vw*m; fh = fw/ae; } else { fh = vh*m; fw = fh*ae; }
  return { x: (vw-fw)/2, y: (vh-fh)/2, w: fw, h: fh, vw, vh, W, H };
}

// 현재 시점에서 18점을 저장 이미지 좌표로 투영
function projectPeople(W, H) {
  const f = frameRect();
  return state.people.map(p => p.pts.map((v, j) => {
    if (!isOn(p, j)) return null;
    const n = v.clone().project(camera); if (n.z > 1 || n.z < -1) return null;
    const px = (n.x+1)/2*f.vw, py = (1-n.y)/2*f.vh;
    return [ (px-f.x)/f.w*W, (py-f.y)/f.h*H ];
  }));
}

// OpenPose(ControlNet) 방식 그리기: 타원 팔다리(색×0.6) + 관절 원(원색)
export function drawOpenPose(ctx, W, H, people, thickness = 1, bg = true) {
  if (bg) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  const k = Math.max(W, H) / 512 * thickness; const stick = 4 * k, rad = 4 * k;
  for (const pts of people) {
    LIMBS.forEach(([a, b], i) => {
      const A = pts[a], B = pts[b]; if (!A || !B) return;
      const mx = (A[0]+B[0])/2, my = (A[1]+B[1])/2, len = Math.hypot(B[0]-A[0], B[1]-A[1]);
      const c = COLORS[i];
      ctx.fillStyle = `rgb(${Math.floor(c[0]*0.6)},${Math.floor(c[1]*0.6)},${Math.floor(c[2]*0.6)})`;
      ctx.beginPath(); ctx.ellipse(mx, my, Math.max(len/2, 0.5), stick, Math.atan2(B[1]-A[1], B[0]-A[0]), 0, Math.PI*2); ctx.fill();
    });
    pts.forEach((P, j) => { if (!P) return; const c = COLORS[j];
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.beginPath(); ctx.arc(P[0], P[1], rad, 0, Math.PI*2); ctx.fill(); });
  }
}

// ---------- 렌더 루프 ----------
let needs = true;
function dirty() { needs = true; }
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w*renderer.getPixelRatio()) || canvas.height !== Math.floor(h*renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); needs = true;
  }
}
function updateFrameAndPreview() {
  const f = frameRect(); const el = $('frame');
  Object.assign(el.style, { left: f.x+'px', top: f.y+'px', width: f.w+'px', height: f.h+'px' });
  $('frameLabel').textContent = `${f.W} × ${f.H}`;
  const pc = $('outPreview'); const s = Math.min(1, 300 / Math.max(f.W, f.H));
  pc.width = Math.round(f.W*s); pc.height = Math.round(f.H*s);
  const ctx = pc.getContext('2d'); ctx.save(); ctx.scale(s, s);
  drawOpenPose(ctx, f.W, f.H, projectPeople(f.W, f.H), +$('thick').value); ctx.restore();
}
function loop() {
  requestAnimationFrame(loop);
  resize(); controls.update();
  if (needs) { needs = false; renderer.render(scene, camera); updateFrameAndPreview(); }
}

// ---------- 저장 ----------
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => new Date().toISOString().slice(0,19).replace(/[-:T]/g, '');
export function renderPng() {
  const [W, H] = exportSize(); const c = document.createElement('canvas'); c.width = W; c.height = H;
  drawOpenPose(c.getContext('2d'), W, H, projectPeople(W, H), +$('thick').value); return c;
}
$('savePng').onclick = () => renderPng().toBlob(b => download(b, `pose_${stamp()}.png`), 'image/png');

export function buildJson() {
  const [W, H] = exportSize(); const proj = projectPeople(W, H);
  return {
    format: 'pose-skeleton/v1',
    keypoint_names: NAMES,
    coordinate_system: '3D: meters, y up, x = viewer right in front view, z = toward front camera. Person facing camera has right side at -x.',
    canvas_width: W, canvas_height: H,
    view: currentYawPitch(),
    people: state.people.map((p, i) => ({
      pose_keypoints_2d: proj[i].flatMap((P, j) => P ? [+P[0].toFixed(2), +P[1].toFixed(2), +Math.max(0.01, Math.min(1, p.vis[j])).toFixed(3)] : [0, 0, 0]),
      pose_keypoints_3d: p.pts.flatMap((v, j) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4), +Math.max(0, Math.min(1, p.vis[j])).toFixed(3)]),
    })),
  };
}
$('saveJson').onclick = () => download(new Blob([JSON.stringify(buildJson(), null, 1)], { type: 'application/json' }), `pose_${stamp()}.json`);


// ---------- 여러 각도 저장 (자동 맞춤 · render_pose.py와 같은 계산) ----------
export const ANGLES = [
  { key: 'front', name: '정면', yaw: 0, pitch: 0, on: true },
  { key: 'r45', name: '오른쪽 45°', yaw: 45, pitch: 0, on: true },
  { key: 'right', name: '오른쪽 옆', yaw: 90, pitch: 0, on: true },
  { key: 'back', name: '뒤', yaw: 180, pitch: 0, on: true },
  { key: 'l45', name: '왼쪽 45°', yaw: -45, pitch: 0, on: false },
  { key: 'left', name: '왼쪽 옆', yaw: -90, pitch: 0, on: false },
  { key: 'high', name: '위에서 (30°)', yaw: 0, pitch: 30, on: true },
  { key: 'low', name: '아래에서 (-20°)', yaw: 0, pitch: -20, on: true },
  { key: 'high45', name: '오른쪽 45° 위에서', yaw: 45, pitch: 25, on: false },
  { key: 'top', name: '바로 위', yaw: 0, pitch: 89, on: false },
];
// 사람 좌표 → (yaw, pitch) 카메라 기준 정규화 2D (원근 투영)
function projectAngle(peoplePts, yawDeg, pitchDeg) {
  const all = peoplePts.flat().filter(Boolean);
  const box = new THREE.Box3().setFromPoints(all.length ? all : [new THREE.Vector3()]);
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.3);
  const half = THREE.MathUtils.degToRad(FOV / 2), dist = r / Math.sin(half) * 1.05;
  const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(Math.max(-89.9, Math.min(89.9, pitchDeg)));
  const pos = new THREE.Vector3(c.x + dist*Math.sin(y)*Math.cos(p), c.y + dist*Math.sin(p), c.z + dist*Math.cos(y)*Math.cos(p));
  const f = c.clone().sub(pos).normalize(), rt = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0,1,0)).normalize(), up = new THREE.Vector3().crossVectors(rt, f);
  return peoplePts.map(pts => pts.map(v => { if (!v) return null; const d = v.clone().sub(pos); const z = d.dot(f); if (z <= 1e-3) return null; return [d.dot(rt)/z, -d.dot(up)/z]; }));
}
function fitScale(proj, W, H, margin) {
  const xs = [], ys = []; proj.flat().forEach(q => { if (q) { xs.push(q[0]); ys.push(q[1]); } });
  if (!xs.length) return { s: 1, cx: 0, cy: 0 };
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { s: Math.min(W*(1-2*margin)/Math.max(x1-x0,1e-6), H*(1-2*margin)/Math.max(y1-y0,1e-6)), cx: (x0+x1)/2, cy: (y0+y1)/2 };
}
export function renderAngles(list, W, H, thickness = 1, margin = 0.08) {
  const peoplePts = state.people.map(p => p.pts.map((v, j) => isOn(p, j) ? v : null));
  const projs = list.map(a => projectAngle(peoplePts, a.yaw, a.pitch));
  const fits = projs.map(pr => fitScale(pr, W, H, margin));
  const s = Math.min(...fits.map(f => f.s)); // 모든 각도에서 같은 크기
  return projs.map((pr, i) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const pts2 = pr.map(pts => pts.map(q => q ? [W/2 + (q[0]-fits[i].cx)*s, H/2 + (q[1]-fits[i].cy)*s] : null));
    drawOpenPose(c.getContext('2d'), W, H, pts2, thickness); return { angle: list[i], canvas: c, points: pts2 };
  });
}
export function contactSheet(results, W, H) {
  const n = results.length, cols = Math.min(n, n <= 4 ? n : Math.ceil(Math.sqrt(n * 1.5)));
  const rows = Math.ceil(n / cols), tile = Math.min(1, 360 / Math.max(W, H)), tw = Math.round(W*tile), th = Math.round(H*tile), gap = 6, lab = 22;
  const c = document.createElement('canvas'); c.width = cols*tw + (cols+1)*gap; c.height = rows*(th+lab) + (rows+1)*gap;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
  results.forEach((r, i) => { const x = gap + (i%cols)*(tw+gap), y = gap + Math.floor(i/cols)*(th+lab+gap);
    ctx.fillStyle = '#ddd'; ctx.font = '14px sans-serif'; ctx.fillText(`${r.angle.name}  (yaw ${r.angle.yaw}°, pitch ${r.angle.pitch}°)`, x+2, y+15);
    ctx.drawImage(r.canvas, x, y+lab, tw, th); });
  return c;
}
// 최소 ZIP (무압축)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function makeZip(files) { // [{name, data:Uint8Array}]
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true);
    h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, off, true);
    central.push(new Uint8Array(cd.buffer), name); off += 30 + name.length + f.data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const canvasBytes = (c) => new Promise(res => c.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/png'));
(function initAngles() {
  const box = $('angles');
  ANGLES.forEach(a => { const l = document.createElement('label'); l.className = 'chk';
    l.innerHTML = `<input type="checkbox" data-angle="${a.key}" ${a.on ? 'checked' : ''}> ${a.name}`; box.appendChild(l); });
})();
export function selectedAngles() { return ANGLES.filter(a => document.querySelector(`[data-angle="${a.key}"]`).checked); }
export async function multiExport(download_ = true) {
  const list = selectedAngles(); if (!list.length) { setStatus('저장할 각도를 하나 이상 골라 주세요.', 'err'); return null; }
  const [W, H] = exportSize(); const res = renderAngles(list, W, H, +$('thick').value); const st = stamp();
  const out = { zip: null, sheet: null };
  if ($('multiZip').checked) {
    const files = []; for (const [i, r] of res.entries()) files.push({ name: `pose_${String(i+1).padStart(2,'0')}_${r.angle.key}_yaw${r.angle.yaw}_pitch${r.angle.pitch}.png`, data: await canvasBytes(r.canvas) });
    out.zip = makeZip(files); if (download_) download(out.zip, `pose_angles_${st}.zip`);
  }
  if ($('multiSheet').checked) { out.sheet = contactSheet(res, W, H); if (download_) out.sheet.toBlob(b => download(b, `pose_sheet_${st}.png`), 'image/png'); }
  setStatus(`${list.length}개 각도를 저장했어요.`, 'ok'); return { res, ...out };
}
$('saveMulti').onclick = () => multiExport(true);

// ---------- 포즈 파일 불러오기 ----------
export function loadPoseJson(data) {
  if (typeof data === 'string') data = JSON.parse(data);
  let people = Array.isArray(data) ? data : data.people;
  if (!people && data.pose_keypoints_3d) people = [data];
  if (!Array.isArray(people) || !people.length) throw new Error('people 배열이 없어요');
  const out = [];
  for (const person of people) {
    let pts = [], vis = [];
    if (person.keypoints && !Array.isArray(person.keypoints)) { // { keypoints: { nose:[x,y,z], ... } }
      NAMES.forEach(n => { const k = person.keypoints[n]; pts.push(k ? new THREE.Vector3(k[0], k[1], k[2]) : new THREE.Vector3()); vis.push(k ? (k[3] ?? 1) : 0); });
    } else if (Array.isArray(person.pose_keypoints_3d) && person.pose_keypoints_3d.length >= 18*3) {
      const a = person.pose_keypoints_3d, st = a.length >= 18*4 ? 4 : 3;
      for (let j = 0; j < 18; j++) { pts.push(new THREE.Vector3(a[j*st], a[j*st+1], a[j*st+2])); vis.push(st === 4 ? a[j*st+3] : 1); }
    } else if (Array.isArray(person.pose_keypoints_2d) && person.pose_keypoints_2d.length >= 18*3) {
      // 일반 OpenPose JSON(2D만): 키 1.7m 정도로 맞춰 z=0 평면에 놓기
      const a = person.pose_keypoints_2d, H = data.canvas_height || 512, s = 1.7 / H * 1.15;
      for (let j = 0; j < 18; j++) { pts.push(new THREE.Vector3(a[j*3]*s, -a[j*3+1]*s, 0)); vis.push(a[j*3+2] > 0 ? 1 : 0); }
    } else throw new Error('pose_keypoints_3d(18점 × x,y,z,c)가 필요해요');
    out.push({ pts, vis });
  }
  clearPeople(); out.forEach(o => addPerson(o.pts, o.vis));
  state.photo = null; $('photo').parentElement.hidden = true;
  renderPeopleChips();
  const v = data.view || {}; setView(+v.yaw_deg || 0, +v.pitch_deg || 0);
  return out.length;
}
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const n = loadPoseJson(await f.text()); setStatus(`포즈 파일을 불러왔어요 (${n}명). 돌려 보고 관절을 끌어 고칠 수 있어요.`, 'ok'); }
  catch (err) { console.error(err); setStatus('포즈 파일을 읽지 못했어요: ' + err.message, 'err'); }
};

// ---------- 사진 → 포즈 ----------
const MODEL_URL = { full: 'models/pose_landmarker_full.task', heavy: 'models/pose_landmarker_heavy.task' };
let visionMod = null, fileset = null;
async function getLandmarker(kind) {
  if (state.landmarker[kind]) return state.landmarker[kind];
  visionMod ??= await import('./vendor/mediapipe/vision_bundle.mjs');
  fileset ??= await visionMod.FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
  const make = (delegate) => visionMod.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL(MODEL_URL[kind], location.href).href, delegate },
    runningMode: 'IMAGE', numPoses: 5, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4,
  });
  let lm;
  try { lm = await make('GPU'); lm._delegate = 'GPU'; } catch (e) { console.warn('GPU 실패 → CPU', e); lm = await make('CPU'); lm._delegate = 'CPU'; }
  state.landmarker[kind] = lm; return lm;
}

async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async'; img.src = url;
    await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth*k); c.height = Math.round(img.naturalHeight*k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  } finally { URL.revokeObjectURL(url); }
}

function mpTo18(arr, conv) {
  return MP.map(i => i >= 0 ? conv(arr[i]) : conv({ x: (arr[11].x+arr[12].x)/2, y: (arr[11].y+arr[12].y)/2, z: (arr[11].z+arr[12].z)/2,
    visibility: Math.min(arr[11].visibility ?? 1, arr[12].visibility ?? 1) }));
}

async function handleFile(file) {
  if (!file || state.busy) return;
  if (file.type === 'application/json' || /\.json$/i.test(file.name)) {
    try { const n = loadPoseJson(await file.text()); setStatus(`포즈 파일을 불러왔어요 (${n}명).`, 'ok'); } catch (e) { setStatus('포즈 파일을 읽지 못했어요: ' + e.message, 'err'); }
    return;
  }
  state.busy = true; showLoading(true, '사진 여는 중…');
  try {
    let img;
    try { img = await loadImageFile(file); }
    catch { throw new Error('이 사진 형식은 브라우저에서 열 수 없어요. JPG나 PNG로 바꿔서 넣어 주세요.'); }
    state.photo = img; drawPhoto();
    const kind = $('model').value;
    showLoading(true, state.landmarker[kind] ? '자세 분석 중…' : '분석 도구 준비 중… (처음 한 번만 몇 초 걸려요)');
    const lm = await getLandmarker(kind);
    showLoading(true, '자세 분석 중…');
    await lm.setOptions({ numPoses: +$('numPoses').value });
    let res;
    try { res = lm.detect(img); }
    catch (e) {
      if (lm._delegate !== 'GPU') throw e;
      console.warn('GPU 분석 실패 → CPU', e); state.landmarker[kind] = null;
      visionMod ??= await import('./vendor/mediapipe/vision_bundle.mjs');
      const cpu = await visionMod.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: new URL(MODEL_URL[kind], location.href).href, delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: +$('numPoses').value });
      cpu._delegate = 'CPU'; state.landmarker[kind] = cpu; res = cpu.detect(img);
    }
    applyResult(res, img);
  } catch (e) {
    console.error(e); setStatus(e.message || String(e), 'err');
  } finally { state.busy = false; showLoading(false); }
}

function applyResult(res, img) {
  const n = res.worldLandmarks?.length || 0;
  if (!n) { drawPhoto(); setStatus('사람을 찾지 못했어요. 몸 전체가 잘 보이는 사진으로 다시 해 보세요.', 'err'); return; }
  const W = img.width, H = img.height, ar = W / H;
  // 사람마다 엉덩이 중심 기준 좌표라서, 사진 속 위치로 옆으로 배치
  const info = res.worldLandmarks.map((wl, i) => {
    const il = res.landmarks[i];
    const mid = (a, b, o) => ({ x: (o[a].x+o[b].x)/2, y: (o[a].y+o[b].y)/2, z: (o[a].z+o[b].z)/2 });
    const ws = mid(11,12,wl), wh = mid(23,24,wl), is = mid(11,12,il), ih = mid(23,24,il);
    const wlen = Math.hypot(ws.x-wh.x, ws.y-wh.y, ws.z-wh.z), ilen = Math.hypot((is.x-ih.x)*ar, is.y-ih.y);
    return { s: ilen > 1e-4 ? wlen/ilen : 1, hip: ih };
  });
  const ss = info.map(o => o.s).sort((a,b) => a-b), s = ss[Math.floor(ss.length/2)];
  clearPeople();
  res.worldLandmarks.forEach((wl, i) => {
    const off = n > 1 ? new THREE.Vector3((info[i].hip.x-0.5)*ar*s, -(info[i].hip.y-0.5)*s, 0) : new THREE.Vector3();
    const pts = mpTo18(wl, l => new THREE.Vector3(l.x, -l.y, -l.z).add(off));
    const vis = mpTo18(wl, l => l.visibility ?? 1).map(v => Math.max(0.01, v));
    const img2d = mpTo18(res.landmarks[i], l => [l.x, l.y, l.visibility ?? 1]);
    addPerson(pts, vis, img2d);
  });
  renderPeopleChips(); drawPhoto(); setView(0, 0);
  setStatus(`${n}명을 찾았어요. 3D 뼈대를 돌려 보고 원하는 각도에서 저장하세요.`, 'ok');
}

function drawPhoto() {
  const c = $('photo'), img = state.photo; if (!img) return;
  c.parentElement.hidden = false;
  const k = Math.min(1, 900 / Math.max(img.width, img.height));
  c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  const people = state.people.filter(p => p.img2d).map(p => p.img2d.map((q, j) => isOn(p, j) ? [q[0]*c.width, q[1]*c.height] : null));
  ctx.globalAlpha = 0.9; drawOpenPose(ctx, c.width, c.height, people, 0.8, false); ctx.globalAlpha = 1;
}

function renderPeopleChips() {
  const box = $('people'); box.innerHTML = '';
  if (state.people.length < 2) return;
  state.people.forEach((p, i) => {
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${i+1}번 사람`;
    const b = document.createElement('button'); b.textContent = '✕'; b.title = '이 사람 빼기';
    b.onclick = () => { peopleRoot.remove(p.group); state.people = state.people.filter(q => q !== p); renderPeopleChips(); drawPhoto(); dirty(); };
    chip.appendChild(b); box.appendChild(chip);
  });
}

// ---------- 입력 ----------
$('file').onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
['dragenter','dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });
document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) handleFile(f); });
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('file').click(); });
$('model').onchange = () => { if (state.photo && !state.busy) setStatus('정밀도를 바꿨어요. 사진을 다시 넣으면 새 설정으로 분석해요.'); };

// ---------- 시작 ----------
addPerson(DEFAULT_POSE.map(a => new THREE.Vector3(...a)), new Array(18).fill(1));
resize(); setView(0, 0); loop();
window.poseApp = { camera, canvas, loadPoseJson, buildJson, renderPng, setView, handleFile, state, NAMES, renderAngles, contactSheet, multiExport, makeZip, ANGLES };
