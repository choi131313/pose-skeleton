// 꼼꼼 분석 — 같은 사진을 여러 방식(사람 확대, 좌우 뒤집기, 돌리기, 밝기 보정)으로 다시 분석해서
// 서로 가장 잘 맞는 결과를 고르고, 결과끼리 어긋나는 관절은 '확실하지 않음'으로 표시해요. 전부 기기 안에서만 돌아가요.

// MediaPipe 33점의 왼쪽↔오른쪽 짝
const SWAP = (() => { const s = [...Array(33).keys()];
  [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]]
    .forEach(([a,b]) => { s[a] = b; s[b] = a; }); return s; })();
// 비교에 쓰는 관절 (코·눈·귀·어깨·팔꿈치·손목·골반·무릎·발목)
const CORE = [0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28];
const BODY = [11,12,13,14,15,16,23,24,25,26,27,28];

// ---------- 화면 만들기 (자르기 → 크기 → 돌리기 → 뒤집기) ----------
function makeView(src, { rect, rot = 0, flip = false, size = 0, enhance = null }) {
  const W = src.width, H = src.height;
  const r = rect || [0, 0, W, H];
  const k = size ? size / Math.max(r[2], r[3]) : 1;
  const sw = Math.max(1, Math.round(r[2] * k)), sh = Math.max(1, Math.round(r[3] * k));
  const c = document.createElement('canvas');
  const side = rot % 180 !== 0; c.width = side ? sh : sw; c.height = side ? sw : sh;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  if (flip) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rot * Math.PI / 180); ctx.translate(-sw / 2, -sh / 2);
  if (enhance) ctx.filter = enhance;
  ctx.drawImage(src, r[0], r[1], r[2], r[3], 0, 0, sw, sh);
  ctx.restore();
  return { canvas: c, rect: r, rot, flip, W, H };
}
// 화면 좌표(0~1) → 원래 사진 좌표(0~1)
function backPoint(v, u, w) {
  if (v.flip) u = 1 - u;
  let a, b;
  if (v.rot === 90) { a = w; b = 1 - u; } else if (v.rot === 180) { a = 1 - u; b = 1 - w; } else if (v.rot === 270) { a = 1 - w; b = u; } else { a = u; b = w; }
  return [(v.rect[0] + a * v.rect[2]) / v.W, (v.rect[1] + b * v.rect[3]) / v.H];
}
function backWorld(v, x, y) {
  if (v.flip) x = -x;
  if (v.rot === 90) return [y, -x]; if (v.rot === 180) return [-x, -y]; if (v.rot === 270) return [-y, x];
  return [x, y];
}
function run(lm, view) {
  const res = lm.detect(view.canvas);
  return (res.landmarks || []).map((L, i) => {
    const Wl = res.worldLandmarks[i];
    const pts = new Array(33), world = new Array(33);
    for (let j = 0; j < 33; j++) {
      const s = view.flip ? SWAP[j] : j; // 뒤집은 사진에선 왼쪽/오른쪽 이름이 바뀜
      const [x, y] = backPoint(view, L[s].x, L[s].y);
      pts[j] = { x, y, z: L[s].z, visibility: L[s].visibility ?? 1 };
      const [wx, wy] = backWorld(view, Wl[s].x, Wl[s].y);
      world[j] = { x: wx, y: wy, z: Wl[s].z, visibility: Wl[s].visibility ?? 1 };
    }
    return { pts, world, view };
  });
}

// ---------- 도우미 ----------
function bbox(c, ar) { // 사진 비율을 반영한 0~1 좌표 상자 (x는 ar배)
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const j of CORE) { const p = c.pts[j]; x0 = Math.min(x0, p.x*ar); x1 = Math.max(x1, p.x*ar); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1, s: Math.max(x1 - x0, y1 - y0, 1e-3), cx: (x0+x1)/2, cy: (y0+y1)/2 };
}
function torsoAngle(c, ar) { // 골반→어깨 방향 (도, 0 = 위쪽)
  const P = c.pts, sx = (P[11].x+P[12].x)/2*ar, sy = (P[11].y+P[12].y)/2, hx = (P[23].x+P[24].x)/2*ar, hy = (P[23].y+P[24].y)/2;
  return Math.atan2(sx - hx, -(sy - hy)) * 180 / Math.PI;
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy, u = (a.x1-a.x0)*(a.y1-a.y0) + (b.x1-b.x0)*(b.y1-b.y0) - i; return u > 0 ? i / u : 0;
}
function sameJoints(a, b, ar, s) { // 몇 개 관절이 같은 곳에 있나
  let n = 0; for (const j of CORE) if (Math.hypot((a.pts[j].x-b.pts[j].x)*ar, a.pts[j].y-b.pts[j].y) < 0.1*s) n++; return n;
}
function meanVis(c) { let s = 0; for (const j of CORE) s += c.pts[j].visibility; return s / CORE.length; }
function plausible(c) { // 왼쪽·오른쪽 팔다리 길이가 비슷한지 (실제 크기 좌표 기준), 0~1
  const W = c.world, d = (a, b) => Math.hypot(W[a].x-W[b].x, W[a].y-W[b].y, W[a].z-W[b].z);
  let bad = 0;
  for (const [a,b,c2,d2] of [[11,13,12,14],[13,15,14,16],[23,25,24,26],[25,27,26,28]]) {
    const r = d(a,b) / Math.max(1e-4, d(c2,d2)); if (r > 1.6 || r < 0.62) bad++;
  }
  const sh = d(11,12), hip = d(23,24); if (sh < 0.12 || hip < 0.06) bad++;
  return 1 - bad / 5;
}
function lumaStats(img) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data; let s = 0, s2 = 0;
  for (let i = 0; i < d.length; i += 4) { const l = (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) / 255; s += l; s2 += l*l; }
  const m = s / 4096; return { mean: m, std: Math.sqrt(Math.max(0, s2/4096 - m*m)) };
}
function enhanceFilter(st) {
  const b = Math.min(2.6, Math.max(1, 0.45 / Math.max(0.05, st.mean)));
  const ct = Math.min(1.8, Math.max(1.1, 0.22 / Math.max(0.05, st.std)));
  return `brightness(${b.toFixed(2)}) contrast(${ct.toFixed(2)})`;
}

// ---------- 본체 ----------
// 18점(OpenPose) 순서용 표
const MP18 = [0,-1,12,14,16,11,13,15,24,26,28,23,25,27,5,2,8,7];     // MediaPipe 33 → 18
const CO18 = [0,-1,6,8,10,5,7,9,12,14,16,11,13,15,2,1,4,3];          // COCO 17 → 18
const LIMB_CHAIN = [[2,3],[3,4],[5,6],[6,7],[8,9],[9,10],[11,12],[12,13]]; // 부모 → 자식 (18점 번호)
const MIRROR = { 2:5, 5:2, 3:6, 6:3, 4:7, 7:4, 8:11, 11:8, 9:12, 12:9, 10:13, 13:10 };
// 기본 뼈 길이 (m): 위팔·아래팔·허벅지·정강이
const DEF_LEN = { '2-3': 0.27, '3-4': 0.25, '5-6': 0.27, '6-7': 0.25, '8-9': 0.42, '9-10': 0.40, '11-12': 0.42, '12-13': 0.40 };

function to18(arr, get) { return (arr.length === 33 ? MP18 : CO18).map(i => i >= 0 ? get(arr[i]) : null); }
function mp18(c) { // MediaPipe 후보 → 18점 [x,y](0~1), vis, world
  const pts = MP18.map(i => i >= 0 ? [c.pts[i].x, c.pts[i].y] : [(c.pts[11].x+c.pts[12].x)/2, (c.pts[11].y+c.pts[12].y)/2]);
  const vis = MP18.map(i => i >= 0 ? c.pts[i].visibility : Math.min(c.pts[11].visibility, c.pts[12].visibility));
  const W = c.world, world = MP18.map(i => i >= 0 ? [W[i].x, W[i].y, W[i].z] : [(W[11].x+W[12].x)/2, (W[11].y+W[12].y)/2, (W[11].z+W[12].z)/2]);
  return { pts, vis, world };
}

// lm: MediaPipe PoseLandmarker, img: canvas, rtm: rtm.js 모듈(없으면 MediaPipe만)
// 결과 people: [{ img2d: [[x,y,c]×18](0~1), world: [[x,y,z]×18](m, x 오른쪽·y 아래·z 멀어짐), conf[18], unsure[18] }]
export async function analyzePose(lm, img, { maxPeople = 2, thorough = true, rtm = null } = {}) {
  const ar = img.width / img.height, t0 = performance.now(), W = img.width, H = img.height;
  const full = { canvas: img, rect: [0, 0, W, H], rot: 0, flip: false, W, H };
  const mpAll = run(lm, full); let passes = 1; const tR0 = performance.now();
  const done = (people, extra = {}) => ({ people, passes, ms: performance.now() - t0, ...extra });
  if (!thorough) return done(mpAll.slice(0, maxPeople).map(c => fromMp(c, [c], ar)), { mode: 'basic' });
  if (!rtm) return done(mpOnly(lm, img, mpAll, maxPeople, ar, () => passes++), { mode: 'mp' });

  // 1) 사람 상자 + 2D 관절 (RTMPose)
  let boxes = await rtm.detectPeople(img, 0.3);
  if (!boxes.length) boxes = await rtm.detectPeople(img, 0.15);
  // MediaPipe가 찾았는데 상자에 없는 사람도 넣기
  for (const c of mpAll) { const b = bbox(c, 1); const bx = { x0: b.x0*W, y0: b.y0*H, x1: b.x1*W, y1: b.y1*H, score: 0.3, mp: true };
    if (!boxes.some(q => iou(q, bx) > 0.3)) boxes.push(bx); }
  const rtmPeople = [];
  for (const box of boxes.slice(0, maxPeople + 2)) {
    let r = await rtm.poseInBox(img, box, 0);
    // 거꾸로·옆으로 누운 사람: 몸을 세워서 다시 보고 더 확실한 쪽
    const ang = angle17(r.kp);
    const rots = [];
    if (Math.abs(ang) > 120) rots.push(180); else if (ang > 50) rots.push(90); else if (ang < -50) rots.push(270);
    if (r.mean < 0.5 && !rots.length) rots.push(180);
    for (const k of rots) { const r2 = await rtm.poseInBox(img, box, k); if (r2.mean > r.mean + 0.03) r = r2; }
    if (r.mean < 0.25) continue;
    const kb = kpBox(r.kp);
    if (rtmPeople.some(q => iou(q.kb, kb) > 0.6)) continue;
    const rf = await rtm.poseInBox(img, box, r.rot, true); // 좌우 뒤집어서 한 번 더 (서로 비교용)
    rtmPeople.push({ box, kp: r.kp, kpF: rf.kp, mean: r.mean, kb, rot: r.rot });
  }
  // 군중 속 작은 사람·흐릿한 사람은 빼기 (첫 번째 사람 기준)
  const area = (q) => (q.kb.x1-q.kb.x0)*(q.kb.y1-q.kb.y0);
  rtmPeople.sort((a, b) => area(b) * (0.5 + b.mean) - area(a) * (0.5 + a.mean));
  for (let i = rtmPeople.length - 1; i > 0; i--) { // 같이 찍힌 사람은 보통 크기가 비슷해요
    const q = rtmPeople[i]; if (q.mean < 0.4 || area(q) < 0.12 * area(rtmPeople[0])) rtmPeople.splice(i, 1);
  }
  const tRtm = performance.now() - tR0;
  if (!rtmPeople.length) return done(mpOnly(lm, img, mpAll, maxPeople, ar, () => passes++), { mode: 'mp' });

  // 2) 사람마다 MediaPipe(3D 깊이용)를 크게 잘라 여러 방식으로 → 2D가 가장 잘 맞는 결과
  const people = [];
  for (const R of rtmPeople.slice(0, maxPeople)) {
    const to18n = (kp) => CO18.map(i => i >= 0 ? [kp[i][0]/W, kp[i][1]/H, kp[i][2]] : [(kp[5][0]+kp[6][0])/2/W, (kp[5][1]+kp[6][1])/2/H, Math.min(kp[5][2], kp[6][2])]);
    const kA = to18n(R.kp), kB = to18n(R.kpF);
    const S = Math.max((R.kb.x1-R.kb.x0)/W*ar, (R.kb.y1-R.kb.y0)/H, 1e-3);
    const k18 = kA.map((a, j) => { const b = kB[j]; return Math.hypot((a[0]-b[0])*ar, a[1]-b[1]) < 0.08*S
      ? [(a[0]*a[2]+b[0]*b[2])/(a[2]+b[2]+1e-6), (a[1]*a[2]+b[1]*b[2])/(a[2]+b[2]+1e-6), (a[2]+b[2])/2] : (a[2] >= b[2] ? a : b).slice(); });
    const side = S * 1.6, cx = (R.kb.x0+R.kb.x1)/2/W, cy = (R.kb.y0+R.kb.y1)/2/H;
    const rect = [(cx - side/2/ar) * W, (cy - side/2) * H, side/ar * W, side * H];
    const up = Math.round(angle17(R.kp) / 90) * 90, rotUp = ((-up % 360) + 360) % 360;
    const opts = [{ rect, size: 640 }, { rect, size: 640, flip: true }];
    if (rotUp) opts.push({ rect, size: 640, rot: rotUp }, { rect, size: 640, rot: rotUp, flip: true });
    let best = null, bd = 1e9;
    const pickFrom = (list) => { for (const c of list) { const m = mp18(c); const d = dist2d(m.pts, k18, ar, S); if (d < bd) { bd = d; best = m; } } };
    pickFrom(mpAll);
    // 처음 결과가 이미 잘 맞으면 그대로, 아니면 크게 잘라 여러 방식으로 다시
    for (const o of opts) { if (bd < 0.05) break; pickFrom(run(lm, makeView(img, o))); passes++; }
    if (bd > 0.12) best = null; // 다른 사람이거나 엉뚱함 → 깊이 없이
    else best.fit = bd;
    // 원본·뒤집기 결과가 어긋나는 관절: MediaPipe와 가까운 쪽으로, 아무것도 안 맞으면 '확실하지 않음'
    const split = new Array(18).fill(false);
    for (let j = 0; j < 18; j++) {
      const a = kA[j], b = kB[j], d = (p, q) => Math.hypot((p[0]-q[0])*ar, p[1]-q[1]);
      if (d(a, b) < 0.08*S) continue;
      if (best) {
        const m = best.pts[j], da = d(a, m), db = d(b, m);
        if (Math.min(da, db) < 0.1*S) { const w = da <= db ? a : b; k18[j] = [w[0], w[1], Math.max(w[2], 0.5)]; continue; }
      }
      split[j] = true; k18[j][2] = Math.min(k18[j][2], 0.5);
    }
    const P = fuse(k18, best, ar, S); split.forEach((v, j) => { if (v) P.unsure[j] = true; });
    people.push(P);
  }
  return done(people, { mode: 'rtm', rtmMs: Math.round(tRtm) });
}

function angle17(kp) { // COCO: 골반→어깨 (도, 0 = 위)
  const sx = (kp[5][0]+kp[6][0])/2, sy = (kp[5][1]+kp[6][1])/2, hx = (kp[11][0]+kp[12][0])/2, hy = (kp[11][1]+kp[12][1])/2;
  return Math.atan2(sx - hx, -(sy - hy)) * 180 / Math.PI;
}
function kpBox(kp) { let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; for (const [x,y,s] of kp) { if (s < 0.3) continue; x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y); }
  if (x0 > x1) for (const [x,y] of kp) { x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y); }
  return { x0, y0, x1, y1 }; }
function dist2d(pts, k18, ar, S) { // 점수 높은 관절 기준 평균 거리 (상자 크기 대비)
  let s = 0, n = 0;
  for (let j = 0; j < 18; j++) { if (j === 1 || k18[j][2] < 0.4) continue; const w = k18[j][2];
    s += w * Math.min(0.3, Math.hypot((pts[j][0]-k18[j][0])*ar, pts[j][1]-k18[j][1]) / S); n += w; }
  return n ? s / n : 1;
}

// 2D(RTMPose)와 MediaPipe 깊이를 합쳐서 3D 만들기: 화면 위치는 2D를 따르고, 앞뒤 깊이는 뼈 길이로 맞춰요
function fuse(k18, mp, ar, S) {
  const img2d = [], conf = [], unsure = new Array(18).fill(false);
  for (let j = 0; j < 18; j++) {
    let [x, y, c] = k18[j];
    const farMp = mp ? Math.hypot((mp.pts[j][0]-x)*ar, mp.pts[j][1]-y) / S : 0;
    if (mp && c >= 0.35 && c < 0.6 && mp.vis[j] > 0.9 && farMp > 0.15 && mp.fit < 0.08) { // 2D가 애매하고 MediaPipe가 확실하면 MediaPipe
      x = mp.pts[j][0]; y = mp.pts[j][1]; c = 0.5; unsure[j] = true;
    } else if (mp && c < 0.35) { // 2D가 자신 없으면 MediaPipe 쪽 위치
      const far = Math.hypot((mp.pts[j][0]-x)*ar, mp.pts[j][1]-y) / S;
      if (mp.vis[j] > c || far > 0.15) { x = mp.pts[j][0]; y = mp.pts[j][1]; }
      c = Math.max(c, Math.min(0.45, mp.vis[j]));
    }
    if (c < 0.35) unsure[j] = true;
    else if (unsure[j]) {}
    else if (mp && c < 0.6 && Math.hypot((mp.pts[j][0]-x)*ar, mp.pts[j][1]-y) / S > 0.15) unsure[j] = true;
    img2d.push([x, y, c]); conf.push(Math.max(0.05, c));
  }
  img2d[1] = [(img2d[2][0]+img2d[5][0])/2, (img2d[2][1]+img2d[5][1])/2, Math.min(img2d[2][2], img2d[5][2])];
  conf[1] = img2d[1][2]; unsure[1] = unsure[2] || unsure[5];

  // 크기: 사진 좌표(가로는 ar배) → m
  const P = img2d.map(([x, y]) => [x * ar, y]);
  const len2 = (a, b) => Math.hypot(P[a][0]-P[b][0], P[a][1]-P[b][1]);
  let scale;
  if (mp) { // MediaPipe 3D 뼈 길이 / 사진 속 길이 (투영) 중앙값
    const r = [];
    for (const [a, b] of [[2,5],[8,11],[2,8],[5,11],...LIMB_CHAIN]) {
      const wa = mp.world[a], wb = mp.world[b], l2 = len2(a, b);
      if (l2 > 0.01 && conf[a] > 0.4 && conf[b] > 0.4) r.push(Math.hypot(wa[0]-wb[0], wa[1]-wb[1]) / l2);
    }
    r.sort((a, b) => a - b); scale = r.length ? r[Math.floor(r.length / 2)] : null;
  }
  if (!scale) { // 몸통 0.5m 또는 어깨 0.36m 중 큰 쪽 기준
    const mid = (a, b) => [(P[a][0]+P[b][0])/2, (P[a][1]+P[b][1])/2];
    const n = mid(2,5), h = mid(8,11), torso = Math.hypot(n[0]-h[0], n[1]-h[1]);
    scale = Math.min(0.5 / Math.max(torso, 1e-3), 0.36 / Math.max(len2(2,5), 1e-3), 0.42 / Math.max(len2(8,9), len2(11,12), 1e-3));
  }
  const hipC = [(P[8][0]+P[11][0])/2, (P[8][1]+P[11][1])/2];
  const wz = (j) => mp ? mp.world[j][2] - (mp.world[8][2] + mp.world[11][2]) / 2 : 0;
  const out = P.map(([x, y], j) => [(x - hipC[0]) * scale, (y - hipC[1]) * scale, wz(j)]);
  if (!mp) for (const j of [0,14,15]) out[j][2] = -0.08; // 얼굴은 조금 앞으로
  // 팔다리: 뼈 길이(좌우 평균)를 지키도록 깊이 맞추기
  const bone = (a, b) => {
    if (!mp) return DEF_LEN[a+'-'+b];
    const L = (x, y) => Math.hypot(...[0,1,2].map(i => mp.world[x][i] - mp.world[y][i]));
    const l1 = L(a, b), l2 = L(MIRROR[a], MIRROR[b]);
    return (l1 + l2) / 2;
  };
  for (const [a, b] of LIMB_CHAIN) {
    const L = bone(a, b), dx = out[b][0] - out[a][0], dy = out[b][1] - out[a][1], d2 = Math.hypot(dx, dy);
    const dzMag = Math.sqrt(Math.max(0, L*L - d2*d2));
    let sign = -1; // 모르면 카메라 쪽으로
    if (mp) { const mz = mp.world[b][2] - mp.world[a][2]; if (Math.abs(mz) > 0.02) sign = Math.sign(mz); }
    out[b][2] = out[a][2] + sign * dzMag;
  }
  return { img2d, world: out, conf, unsure };
}

function fromMp(c, cands, ar) { // MediaPipe 결과만 (예전 방식)
  const m = mp18(c), f = finish(c, cands, ar);
  const conf = to18(f.conf, v => v), uns = to18(f.unsure, v => v);
  conf[1] = Math.min(conf[2], conf[5]); uns[1] = uns[2] || uns[5];
  return { img2d: m.pts.map((p, j) => [p[0], p[1], m.vis[j]]), world: m.world.map(w => [w[0], w[1], w[2]]), conf, unsure: uns };
}

// RTMPose를 못 쓸 때: MediaPipe만 여러 번 돌려서 서로 가장 잘 맞는 결과
function mpOnly(lm, img, found, maxPeople, ar, count) {
  found = found.slice();
  const st = lumaStats(img), dark = st.mean < 0.3 || st.std < 0.12;
  const add = (list) => { for (const c of list) { const b = bbox(c, ar); if (!found.some(f => iou(bbox(f, ar), b) > 0.5)) found.push(c); } };
  if (!found.length || dark) {
    const tries = [{ enhance: enhanceFilter(st) }];
    if (!found.length) {
      tries.push({ rot: 90 }, { rot: 270 }, { rot: 180 });
      const W = img.width, H = img.height, a = 0.62;
      for (const [fx, fy] of [[0,0],[1-a,0],[0,1-a],[1-a,1-a],[(1-a)/2,(1-a)/2]]) tries.push({ rect: [fx*W, fy*H, a*W, a*H], size: 960 });
    }
    for (const t of tries) { if (found.length && !dark) break; add(run(lm, makeView(img, t))); count(); }
  }
  if (!found.length) return [];
  found.sort((a, b) => bbox(b, ar).s - bbox(a, ar).s);
  const people = [];
  for (const seed of found.slice(0, maxPeople + 1)) {
    const b = bbox(seed, ar), pad = 0.3 * b.s + 0.02, side = b.s + 2 * pad;
    const rect = [(b.cx - side/2) / ar * img.width, (b.cy - side/2) * img.height, side / ar * img.width, side * img.height];
    const up = Math.round(torsoAngle(seed, ar) / 90) * 90, rotUp = ((-up % 360) + 360) % 360;
    const opts = [{ rect, size: 640 }, { rect, size: 640, flip: true }];
    if (rotUp) opts.push({ rect, size: 640, rot: rotUp }, { rect, size: 640, rot: rotUp, flip: true });
    if (dark) opts.push({ rect, size: 640, enhance: enhanceFilter(st) });
    const cands = [seed];
    for (const o of opts) {
      const list = run(lm, makeView(img, o)); count();
      let best = null, bi = 0.25;
      for (const c of list) { const v = iou(bbox(c, ar), b); if (v > bi) { bi = v; best = c; } }
      if (best) cands.push(best);
    }
    let pick = null, ps = -1;
    for (const c of cands) {
      let agree = 0; for (const d of cands) if (d !== c) agree += sameJoints(c, d, ar, b.s) / CORE.length;
      agree /= Math.max(1, cands.length - 1);
      const sc = (cands.length > 1 ? agree : 0.5) + 0.35 * meanVis(c) + 0.35 * plausible(c);
      if (sc > ps) { ps = sc; pick = c; }
    }
    const r = fromMp(pick, cands, ar); r.score = ps; r._c = pick; people.push(r);
  }
  const out = [];
  for (const p of people.sort((a, b) => b.score - a.score)) {
    const bp = bbox(p._c, ar);
    if (out.some(q => iou(bbox(q._c, ar), bp) > 0.45 || sameJoints(q._c, p._c, ar, Math.max(bp.s, bbox(q._c, ar).s)) >= 10)) continue;
    out.push(p);
  }
  out.sort((a, b) => bbox(b._c, ar).s - bbox(a._c, ar).s);
  return out.slice(0, maxPeople);
}

function finish(c, cands, ar) {
  const b = bbox(c, ar), conf = new Array(33), unsure = new Array(33).fill(false);
  for (let j = 0; j < 33; j++) {
    let agree = 1;
    if (cands.length > 2) {
      let n = 0; for (const d of cands) if (d !== c && Math.hypot((c.pts[j].x-d.pts[j].x)*ar, c.pts[j].y-d.pts[j].y) < 0.1*b.s) n++;
      agree = n / (cands.length - 1);
    }
    conf[j] = Math.min(c.pts[j].visibility ?? 1, 0.25 + 0.75 * agree);
    if (cands.length > 2 && agree < 0.5) unsure[j] = true;
  }
  return { conf, unsure };
}
