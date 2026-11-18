// 공유 모듈: 웹페이지(ai.js)와 Cloudflare Worker(worker/)가 같이 쓰는 포즈 프롬프트·스키마
export const NAMES = ['nose','neck','r_shoulder','r_elbow','r_wrist','l_shoulder','l_elbow','l_wrist',
  'r_hip','r_knee','r_ankle','l_hip','l_knee','l_ankle','r_eye','l_eye','r_ear','l_ear'];
export const REF = { nose:[0,0.62,0.09], neck:[0,0.5,0], r_shoulder:[-0.18,0.48,0], r_elbow:[-0.24,0.22,0], r_wrist:[-0.26,-0.03,0.03],
  l_shoulder:[0.18,0.48,0], l_elbow:[0.24,0.22,0], l_wrist:[0.26,-0.03,0.03], r_hip:[-0.1,0,0], r_knee:[-0.11,-0.42,0.01], r_ankle:[-0.12,-0.82,-0.03],
  l_hip:[0.1,0,0], l_knee:[0.11,-0.42,0.01], l_ankle:[0.12,-0.82,-0.03], r_eye:[-0.035,0.665,0.07], l_eye:[0.035,0.665,0.07], r_ear:[-0.075,0.64,0], l_ear:[0.075,0.64,0] };
export const JOINT_SCHEMA = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x','y','z'], additionalProperties: false };
export const SCHEMA = { type: 'object', additionalProperties: false, required: ['description_ko', 'people'], properties: {
  description_ko: { type: 'string' },
  people: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keypoints'], properties: {
    keypoints: { type: 'object', additionalProperties: false, required: NAMES, properties: Object.fromEntries(NAMES.map(n => [n, JOINT_SCHEMA])) } } } } } };

export const SYSTEM = `You convert a natural-language description (usually Korean) of a human body pose into 3D joint coordinates for a pose-reference tool (OpenPose COCO-18 skeleton).
Coordinate system: meters, right-handed. +y is UP, +x is the viewer's right in the front view, +z points toward the front camera (out of the screen).
In the neutral orientation the person FACES +z (toward the camera), so the person's RIGHT side is at -x and LEFT side is at +x.
"오른손/오른팔/오른쪽" always means the PERSON's right (r_*), not the viewer's. "몸을 왼쪽으로 튼다" = rotate the upper body about the vertical axis toward the person's left (the chest turns toward +x).
Origin: mid-point of the hips at (0,0,0). Feet are on the ground (ankles near y=-0.82 when standing straight; lower when crouching the hips drop instead — keep ankles at the lowest point).
Typical adult proportions (keep these lengths!): neck→mid-hip 0.50, neck→each shoulder 0.18, upper arm 0.27, forearm 0.25, mid-hip→each hip 0.10, thigh 0.42, shin 0.40, neck→nose 0.15, eyes 0.035 beside the nose midline and 0.045 above it, ears 0.075 to each side of the head center.
Reference standing pose (arms down): ${JSON.stringify(REF)}
Rules: output ONLY the JSON object matching the schema. Every person must have all 18 keypoints as {x,y,z}. Keep the body anatomically plausible (elbows/knees bend the natural way, no limb stretching). Eyes/ears/nose follow the head direction.
If several people are requested, place them side by side about 0.8 m apart in x, each with its own hips (do not overlap them).
"description_ko": one short polite Korean sentence (존댓말) describing what you made.`;
