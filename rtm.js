// 사람 찾기(YOLOX-tiny, HumanArt) + 2D 관절(RTMPose body7) — onnxruntime-web(WASM)으로 기기 안에서만 돌아가요.
// 모델: OpenMMLab mmpose (Apache-2.0). 전처리·후처리는 rtmlib와 똑같이 맞췄어요(BGR 순서, simcc 최댓값).
const BASE = new URL('./', import.meta.url).href;
const POSE_URL = { s: 'models/rtmpose_s.onnx', m: 'models/rtmpose_m.onnx' };
let ort = null, det = null; const pose = {};

export async function loadRtm(kind = 's', onStage = () => {}) {
  if (!ort) {
    ort = await import('./vendor/onnxruntime/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = BASE + 'vendor/onnxruntime/';
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  }
  const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  if (!det) { onStage('det'); det = await ort.InferenceSession.create(BASE + 'models/person_yolox_tiny.onnx', opt); }
  if (!pose[kind]) { onStage('pose'); pose[kind] = await ort.InferenceSession.create(BASE + POSE_URL[kind], opt); }
  return { det, pose: pose[kind] };
}
export const rtmReady = (kind) => !!(det && pose[kind]);

function pixels(canvas) { const c = canvas.getContext('2d', { willReadFrequently: true }); return c.getImageData(0, 0, canvas.width, canvas.height).data; }

// 사람 상자 찾기 → [{x0,y0,x1,y1,score}] (원래 사진 픽셀)
export async function detectPeople(img, minScore = 0.3) {
  const S = 416, r = Math.min(S / img.height, S / img.width);
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = 'rgb(114,114,114)'; x.fillRect(0, 0, S, S);
  x.drawImage(img, 0, 0, Math.floor(img.width * r), Math.floor(img.height * r));
  const d = pixels(c), n = S * S, t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { t[i] = d[4*i+2]; t[n+i] = d[4*i+1]; t[2*n+i] = d[4*i]; } // BGR
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, S, S]) });
  const dets = out[det.outputNames[0]], v = dets.data, k = dets.dims[1], res = [];
  for (let i = 0; i < k; i++) {
    const s = v[i*5+4]; if (!(s > minScore)) continue;
    res.push({ x0: v[i*5]/r, y0: v[i*5+1]/r, x1: v[i*5+2]/r, y1: v[i*5+3]/r, score: s });
  }
  return res.sort((a, b) => (b.x1-b.x0)*(b.y1-b.y0) - (a.x1-a.x0)*(a.y1-a.y0));
}

// 상자 하나의 관절 17개(COCO) → { kp: [[x,y,score]×17] (원래 사진 픽셀), mean }
// rot: 0/90/180/270 (시계 방향으로 돌려서 분석; 거꾸로 선 사람용)
const FLIP17 = [0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15];
export async function poseInBox(img, box, rot = 0, flip = false) {
  const IW = 192, IH = 256;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  let w = (box.x1 - box.x0) * 1.25, h = (box.y1 - box.y0) * 1.25;
  if (rot % 180) [w, h] = [h, w]; // 돌린 뒤 기준 가로·세로
  if (w > h * IW / IH) h = w * IH / IW; else w = h * IW / IH;
  const c = document.createElement('canvas'); c.width = IW; c.height = IH;
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#000'; x.fillRect(0, 0, IW, IH);
  x.save(); if (flip) { x.translate(IW, 0); x.scale(-1, 1); }
  x.translate(IW/2, IH/2); x.scale(IW / w, IH / h); x.rotate(rot * Math.PI / 180); x.translate(-cx, -cy);
  x.drawImage(img, 0, 0); x.restore();
  const d = pixels(c), n = IW * IH, t = new Float32Array(3 * n);
  const M = [123.675, 116.28, 103.53], SD = [58.395, 57.12, 57.375];
  for (let i = 0; i < n; i++) { // rtmlib처럼 BGR 순서에 평균·표준편차
    t[i] = (d[4*i+2] - M[0]) / SD[0]; t[n+i] = (d[4*i+1] - M[1]) / SD[1]; t[2*n+i] = (d[4*i] - M[2]) / SD[2];
  }
  const p = pose.cur;
  const out = await p.run({ [p.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, IH, IW]) });
  const sx = out[p.outputNames[0]], sy = out[p.outputNames[1]];
  const K = sx.dims[1], WX = sx.dims[2], WY = sy.dims[2], kp = [];
  const a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  let mean = 0;
  for (let j = 0; j < K; j++) {
    let bx = 0, mx = -1e9, by = 0, my = -1e9;
    for (let i = 0; i < WX; i++) { const q = sx.data[j*WX+i]; if (q > mx) { mx = q; bx = i; } }
    for (let i = 0; i < WY; i++) { const q = sy.data[j*WY+i]; if (q > my) { my = q; by = i; } }
    // 입력 칸 좌표 → (돌린) 상자 좌표 → 원래 사진
    const u = ((flip ? IW - bx / 2 : bx / 2) / IW - 0.5) * w, v = (by / 2 / IH - 0.5) * h; // 돌린 화면에서 중심 기준
    const X = cx + u * ca + v * sa, Y = cy - u * sa + v * ca;    // 되돌리기
    const s = Math.max(0, (mx + my) / 2);
    kp.push([X, Y, s]); mean += s;
  }
  return { kp: flip ? FLIP17.map(i => kp[i]) : kp, mean: mean / K, rot };
}
export function usePose(kind) { pose.cur = pose[kind]; }
