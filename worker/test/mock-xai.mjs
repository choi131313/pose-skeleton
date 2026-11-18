// 가짜 xAI 서버 (테스트용). 요청 기록은 GET /last 로 확인.
import http from 'http';
import fs from 'fs';
const N = ['nose','neck','r_shoulder','r_elbow','r_wrist','l_shoulder','l_elbow','l_wrist','r_hip','r_knee','r_ankle','l_hip','l_knee','l_ankle','r_eye','l_eye','r_ear','l_ear'];
const ex = JSON.parse(fs.readFileSync(new URL('../../examples/right_arm_up_twist_left.json', import.meta.url)));
const a = ex.people[0].pose_keypoints_3d;
const pose = { description_ko: '오른손을 들고 상체를 왼쪽으로 튼 자세예요.', people: [{ keypoints: Object.fromEntries(N.map((n, i) => [n, { x: a[i*4], y: a[i*4+1], z: a[i*4+2] }])) }] };
let last = null, count = 0;
http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    if (req.method === 'GET' && req.url === '/last') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ last, count })); }
    count++; const body = JSON.parse(b || '{}'); last = { auth: req.headers.authorization, body };
    const text = (body.messages || []).map(m => m.content).join(' ');
    const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (text.includes('CREDITS')) return send(403, { code: 'permission-denied', error: 'Your team has either used all available credits or reached its monthly spending limit.' });
    if (text.includes('SCHEMAFAIL') && body.response_format?.type === 'json_schema') return send(400, { code: 'invalid-argument', error: 'response_format json_schema not supported' });
    send(200, { id: 'x', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(pose), refusal: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 2000, completion_tokens: 800 } });
  });
}).listen(9999, () => console.log('mock xai on 9999'));
