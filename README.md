# 포즈 뼈대 만들기 (pose-skeleton)

사진을 넣으면 **기기 안(브라우저)에서** 사람 자세를 읽어 3D 뼈대로 보여 주고, 원하는 각도에서
**OpenPose / ControlNet 스타일 PNG**(검은 배경 + 18점 COCO 색깔 뼈대)로 저장하는 웹페이지예요.
[posex](https://hnmr293.github.io/posex/)에서 영감을 받았어요. 그림 자세 참고·AI 이미지 생성(ControlNet openpose)용.

- 공개 주소: https://choi131313.github.io/pose-skeleton/
- 사진은 서버로 올라가지 않아요. 분석(MediaPipe Pose Landmarker)은 전부 브라우저 안에서 돌아가요.

## 기능
- 사진 고르기 / 끌어다 놓기 / 붙여넣기 (휴대폰 브라우저도 가능), 최대 5명
- 정밀도: 보통(full 모델, 9MB) / 정밀(heavy 모델, 30MB)
- 3D 보기(three.js): 회전·확대·이동(마우스·터치), 정면/오른쪽에서/뒤에서/왼쪽에서/위에서 버튼, 시점 초기화
- 관절(점)을 끌어서 자세 고치기, 포즈 되돌리기
- 사진 위에 2D 뼈대 겹쳐 보기
- PNG 저장: 512², 768², 1024², 512×768, 768×1024, 832×1216, 가로형, 사진 비율, 직접 입력
- 여러 각도 한 번에 저장: 정면·45°·옆·뒤·위·아래 등 체크 → 각도별 PNG(zip) + 한 장에 모은 PNG
- JSON 저장 / **포즈 파일 불러오기** (아래 형식)
- **말로 포즈 만들기**: “오른손 들고 몸 왼쪽으로 튼 자세”처럼 적으면 본인 AI API 키(기본 xAI Grok, 선택으로 OpenAI·Google Gemini)로 포즈를 만들어
  3D 화면에 불러와요. ‘지금 포즈 고치기’를 켜고 “왼팔도 들어줘”처럼 이어서 고칠 수 있어요.
- **모양: 뼈대 / 마네킹 / 둘 다** (3D 보기 위 ‘모양’). 마네킹은 같은 18점으로 만든 회색 인형(원기둥 팔다리·몸통·머리, 간단한 명암)이고
  관절을 끌거나 AI 포즈를 불러오면 같이 움직여요. PNG·여러 각도 저장도 고른 모양대로 저장돼요(마네킹은 밝은 단색 배경, 관절·바닥 없이).
  기본값은 뼈대이고 OpenPose PNG는 그대로예요.
- **토큰 사용량**: 말로 포즈를 만들 때마다 이번 요청 토큰·요금(어림, 원화 1달러≈1,340원)과 오늘 합계를 보여 줘요.
  ‘내 서버’는 서버(KV)에 오늘 합계를 저장해서 모든 기기 합계 + 오늘 횟수(…/200)를, 이 기기 합계는 브라우저에 따로 저장해요.
- **📋 대기열**: 프롬프트 여러 개(한 줄에 하나, 붙여넣기 가능)를 넣고 시작하면 지금 고른 AI로 **하나씩 차례로**(동시에 안 함) 새 포즈를 만들어
  보관함에 항상 저장해요. 상태(대기/만드는 중/완료/실패), 순서 바꾸기·빼기·다시, 시작/일시정지(지금 것 끝나면)/멈추기, 예상 요금(1개 약 ₩40~70),
  대기열 합계 토큰·요금. 실패하면 한 번 더 해 보고 실패로 표시한 뒤 다음으로, 비밀번호·한도 같은 오류나 서버 하루 한도에 닿으면 멈춰요.
  브라우저(localStorage)에 남아서 새로고침해도 이어서 할 수 있어요(만들던 항목은 대기로).
- **📚 보관함**: 말로 만든 포즈를 프롬프트·날짜·썸네일·좌표와 함께 브라우저(IndexedDB)에 자동 저장(끌 수 있음),
  ‘지금 포즈 담기’, 불러오기, 이름 바꾸기, 삭제, 검색, 내보내기/가져오기(JSON, `pose-skeleton-library/v1`).

## 파일 구성
```
index.html  style.css  app.js        웹페이지
config.js   WORKER_URL (포즈 서버 주소, 비어 있으면 서버 방식 숨김)
pose-prompt.js  AI 프롬프트·JSON 스키마 (페이지와 서버가 같이 씀)
worker/     Cloudflare Worker ‘포즈 서버’ (비밀번호로 보호되는 xAI 프록시)
ai.js       말로 포즈 만들기 (xAI / OpenAI / Gemini 직접 호출, 응답 검증·보정, 토큰 사용량)
library.js  보관함 (IndexedDB)
queue.js    대기열 (차례로 만들기)
vendor/      three.js r170, OrbitControls, @mediapipe/tasks-vision 0.10.21 (wasm 포함)
models/      pose_landmarker_full.task, pose_landmarker_heavy.task
render_pose.py  포즈 JSON → OpenPose PNG 명령줄 렌더러 (Python3 + Pillow)
examples/    standing.json, right_arm_up_twist_left.json
```
로컬 실행: `python3 -m http.server 8000` 후 http://localhost:8000 (file://로 바로 열면 wasm 로딩이 막혀요).

## 포즈 JSON 형식 (`pose-skeleton/v1`)

```jsonc
{
  "format": "pose-skeleton/v1",
  "keypoint_names": ["nose","neck", ...],         // 참고용(읽을 때 무시)
  "view": { "yaw_deg": 0, "pitch_deg": 0 },        // 선택: 불러올 때 이 각도로 봄
  "canvas_width": 512, "canvas_height": 768,      // 내보낼 때만 씀(2D용)
  "people": [
    {
      "pose_keypoints_3d": [x,y,z,c,  x,y,z,c, ...],  // 18점 × 4 = 72개 (필수)
      "pose_keypoints_2d": [x,y,c, ...]               // 내보낼 때만 씀: 현재 화면 기준 픽셀 좌표
    }
  ]
}
```

**좌표계 (3D)**
- 단위: 미터(대략 키 1.6~1.8m 기준). 절대 크기는 중요하지 않고 비율만 맞으면 돼요.
- `y` = 위(+), `x` = 정면에서 봤을 때 화면 오른쪽(+), `z` = 정면 카메라 쪽(+, 앞으로 나옴).
- 사람은 기본적으로 **+z(카메라)를 바라봐요** → 사람의 **오른쪽 = -x**, 왼쪽 = +x.
- 원점은 아무 데나 괜찮아요(보통 골반 가운데). 렌더링 시 자동으로 가운데 맞춤.
- `c` = 신뢰도 0~1. **0이면 그 관절은 없는 것**(그리지 않음). 손으로 쓸 땐 1.
- `pose_keypoints_3d`에 `c`를 빼고 18×3=54개만 넣어도 돼요.
- 대체 형식: `"keypoints": {"nose":[x,y,z], "neck":[x,y,z], ...}` (이름 → 좌표) 도 읽어요.
- 2D만 있는 일반 OpenPose JSON(`pose_keypoints_2d`)도 불러지지만 z=0 평면이 돼요.

**관절 순서 (OpenPose COCO 18점)**

| # | 이름 | | # | 이름 |
|---|---|---|---|---|
| 0 | nose 코 | | 9 | r_knee 오른무릎 |
| 1 | neck 목(두 어깨 가운데) | | 10 | r_ankle 오른발목 |
| 2 | r_shoulder 오른어깨 | | 11 | l_hip 왼골반 |
| 3 | r_elbow 오른팔꿈치 | | 12 | l_knee 왼무릎 |
| 4 | r_wrist 오른손목 | | 13 | l_ankle 왼발목 |
| 5 | l_shoulder 왼어깨 | | 14 | r_eye 오른눈 |
| 6 | l_elbow 왼팔꿈치 | | 15 | l_eye 왼눈 |
| 7 | l_wrist 왼손목 | | 16 | r_ear 오른귀 |
| 8 | r_hip 오른골반 | | 17 | l_ear 왼귀 |

**예시: 차렷 자세** (`examples/standing.json`과 같음)
```json
{"format":"pose-skeleton/v1","people":[{"keypoints":{
 "nose":[0,0.62,0.09],"neck":[0,0.5,0],
 "r_shoulder":[-0.18,0.48,0],"r_elbow":[-0.24,0.22,0],"r_wrist":[-0.26,-0.03,0.03],
 "l_shoulder":[0.18,0.48,0],"l_elbow":[0.24,0.22,0],"l_wrist":[0.26,-0.03,0.03],
 "r_hip":[-0.1,0,0],"r_knee":[-0.11,-0.42,0.01],"r_ankle":[-0.12,-0.82,-0.03],
 "l_hip":[0.1,0,0],"l_knee":[0.11,-0.42,0.01],"l_ankle":[0.12,-0.82,-0.03],
 "r_eye":[-0.035,0.665,0.07],"l_eye":[0.035,0.665,0.07],"r_ear":[-0.075,0.64,0],"l_ear":[0.075,0.64,0]}}]}
```
대략적인 길이: 위팔 0.27, 아래팔 0.25, 허벅지 0.42, 정강이 0.40, 어깨 너비 0.36, 골반 너비 0.2, 목→골반 0.5 (m).
상체를 비틀 땐 어깨·팔·머리 점들을 y축 기준으로 회전시키면 돼요(`examples/right_arm_up_twist_left.json` 참고: 오른팔 들기 + 상체 왼쪽으로 30°).

**각도 (yaw / pitch)** — 웹페이지와 CLI 공통
- yaw 0 = 정면(사진 방향), 90 = 화면 오른쪽(+x)에서 봄(사람의 왼쪽 옆모습), 180 = 뒤, -90 = 화면 왼쪽에서.
- pitch + = 위에서 내려다봄, − = 아래에서 올려다봄. 원근 투영, 세로 화각 35°.

## 말로 포즈 만들기 (AI)
- 설정(‘AI 설정’)에서 AI 회사와 모델을 고르고 **본인 API 키**를 넣어요.
  - **xAI Grok (기본)** 키: https://console.x.ai (기본 모델 `grok-4.7`, `POST https://api.x.ai/v1/chat/completions`,
    `response_format: json_schema` strict — 거부되면 자동으로 `json_object`로 다시 요청). api.x.ai는 브라우저 CORS를 허용해요(`access-control-allow-origin: *`).
  - OpenAI 키: https://platform.openai.com/api-keys (주의: OpenAI는 키 오류 응답에 CORS 헤더가 없어 브라우저에선 ‘연결 실패’로 보여요) (기본 모델 `gpt-6.1-terra`, Responses API + `json_schema` strict)
  - Google Gemini 키: https://aistudio.google.com/apikey (기본 모델 `gemini-flash-latest`, `responseMimeType: application/json` + `responseSchema`)
- 키는 브라우저 `localStorage`(`poseSkel.ai.key.xai` / `.openai` / `.gemini`)에만 저장되고 고른 회사 API로만 직접 보내져요.
  이 사이트에는 서버가 없어요. ‘키 지우기’로 저장된 키를 모두 지워요. 저장소에는 키가 들어 있지 않아요.
- AI에게는 위 좌표계·관절 이름·기준 길이·차렷 자세를 설명하고, 18개 관절을 `{x,y,z}` 객체로 받는 JSON 스키마를 강제해요.
  ‘지금 포즈 고치기’가 켜져 있으면 현재 포즈(18점 3D 좌표)를 함께 보내요.
- 받은 응답은 검증·보정해요: 코드펜스/앞뒤 글 제거 → JSON 파싱 → 어깨·골반 4점 필수(없으면 오류) → 빠진 팔다리·목·코·눈·귀 채우기
  → 몸통(목→골반 가운데)을 0.5m로 크기 맞춤(cm로 와도 됨) → 기준의 0.6~1.5배를 벗어난 뼈는 기준 길이로 고치고 아래쪽 관절을 함께 옮김.
  JSON이 깨졌거나 이상한 뼈가 4개 이상이면 이유를 알려 주며 **딱 한 번** 다시 요청해요.
- 오류 안내: 키 오류(401, xAI ‘Incorrect API key’, API_KEY_INVALID), 크레딧 소진(xAI 403 credits/spending limit), 결제·한도 부족(insufficient_quota), 요청 과다·무료 한도(429), 모델 이름 오류(404),
  서버 오류(5xx), 인터넷 끊김, 거절/안전 차단, 2분 시간 초과.
- 요금·속도 (2026-11-18 실제 측정, grok-4.7, `reasoning_effort: low`): 요청 1번에 약 **1.3~3.6센트(약 20~50원)**, **20초~75초**.
  기본값(high)으로 두면 약 7센트·160초가 걸려서 페이지와 서버 모두 grok-4.5~4.7에는 `low`를 붙여요.
  `grok-4.20-0309-non-reasoning`은 약 0.3센트·3~4초로 빠르고 싸지만 앉은 자세 등에서 결과가 눈에 띄게 엉성했어요.

## 키 없이 쓰기: ‘내 서버 (비밀번호)’ — Cloudflare Worker

Grok 키를 작은 Cloudflare Worker(`worker/`) 안에 숨겨 두고, 페이지에서는 **비밀번호만** 넣어 쓰는 방식이에요.
`config.js`의 `WORKER_URL`이 비어 있으면 이 방식은 안 보이고, 주소를 넣으면 기본 방식이 돼요.

**서버가 막아 주는 것**
- `https://choi131313.github.io`에서 온 요청만 받아요(CORS + Origin 확인). 진짜 보호는 비밀번호예요(Origin은 브라우저 밖에선 흉내 낼 수 있어서).
- 비밀번호(`PAGE_PASSWORD`)는 상수 시간 비교, 틀리면 약 1초 지연, 같은 IP에서 5번 틀리면 15분 잠금.
- 시스템 프롬프트와 포즈 JSON 스키마를 **서버가 고정**해서 붙여요 → 일반 Grok 채팅으로는 못 써요.
  클라이언트가 보낸 system 메시지·tools·max_tokens 등은 거절하거나 무시해요.
- 모델 허용 목록(`ALLOWED_MODELS`), 출력 상한 `MAX_TOKENS`(6000), 입력 상한 `MAX_INPUT_CHARS`(12000자), 메시지 4개 이하, 본문 64KB 이하.
- 하루 요청 상한 `DAILY_LIMIT`(기본 200번, 한국 시간 자정에 초기화, 0이면 무제한). 실측 기준(요청당 약 2~4센트) 하루 최대 대략 4~8달러 이내로 묶여요.
- 키·비밀번호·요청 내용은 로그에 남기지 않아요.
- 잠금·하루 상한은 KV에 저장해요(KV를 안 붙이면 서버 인스턴스별 메모리라 느슨해요). KV는 몇 초 늦게 반영될 수 있어서 상한을 몇 번 넘길 수는 있어요.

**배포 순서** (한 번만 하면 돼요. 비밀값은 본인이 직접 입력하고 채팅에 붙여넣지 마세요)
1. Cloudflare 무료 가입: https://dash.cloudflare.com/sign-up
2. xAI 콘솔(https://console.x.ai)에서 크레딧을 충전하고 API 키를 만들어요.
3. Node.js가 있는 컴퓨터에서:
   ```bash
   git clone https://github.com/choi131313/pose-skeleton.git
   cd pose-skeleton/worker
   npm install
   npx wrangler login            # 브라우저가 열리면 Cloudflare 로그인 → 허용
   ```
4. 잠금·하루 상한용 KV 만들기:
   ```bash
   npx wrangler kv namespace create POSE_KV
   ```
   나온 `id`를 `wrangler.toml`의 `[[kv_namespaces]]` 부분에 넣고 그 세 줄 앞의 `#`을 지워요.
5. 비밀값 넣기 (명령을 치면 입력창이 나와요. 화면에 안 보여도 붙여넣고 Enter):
   ```bash
   npx wrangler secret put XAI_API_KEY     # xAI 키 (xai-...)
   npx wrangler secret put PAGE_PASSWORD   # 페이지에서 쓸 비밀번호 (길게, 다른 데서 안 쓰는 것)
   ```
6. (선택) `wrangler.toml`에서 `DAILY_LIMIT` 같은 값을 바꿔요.
7. 배포:
   ```bash
   npx wrangler deploy
   ```
   처음이면 workers.dev 하위 주소 이름을 정하라고 나와요. 끝나면 `https://pose-proxy.<이름>.workers.dev` 주소가 나와요.
8. 확인: `curl -H "Origin: https://choi131313.github.io" https://pose-proxy.<이름>.workers.dev/health` → `{"ok":true,"configured":true}`
9. 저장소의 `config.js`에 `export const WORKER_URL = 'https://pose-proxy.<이름>.workers.dev';` 를 넣고 커밋·푸시해요.
10. 페이지 → AI 설정 → ‘내 서버 (비밀번호)’에 비밀번호를 한 번 넣으면 끝이에요.

비밀번호 바꾸기: `npx wrangler secret put PAGE_PASSWORD` 다시 실행. 잠시 끄기: `DAILY_LIMIT`을 아주 작게 하고 `npx wrangler deploy`, 완전히 지우기: `npx wrangler delete`.

**로컬 테스트** (실제 xAI 대신 가짜 서버):
```bash
cd worker && npm install
node test/mock-xai.mjs &                       # 가짜 xAI (9999)
printf 'XAI_API_KEY=test\nPAGE_PASSWORD=correct-horse-battery\nXAI_URL=http://127.0.0.1:9999/v1/chat/completions\nDAILY_LIMIT=6\nMAX_FAILS=3\n' > .dev.vars
npx wrangler dev -c wrangler.test.toml --port 8787 &   # KV 포함 (기본 wrangler.toml로 하면 메모리 모드)
node test/worker.test.mjs                      # 29개 항목 (다시 돌릴 땐 먼저 rm -rf .wrangler/state)
```

**서버 API** — `POST /v1/pose` `{"password": "...", "messages": [{"role":"user","content":"..."}], "model"?: "grok-4.7"}`
→ `200 {"content": "<포즈 JSON 문자열>", "usage": {xAI usage}, "day": {오늘 합계}, "used_today": n, "daily_limit": n}` / 오류 `{"error": "bad_password|locked|daily_limit|no_credits|upstream_auth|upstream_rate|upstream_down|upstream_error|too_large|bad_request|model_not_allowed|bad_origin|not_configured"}`.
`GET /health` → `{"ok":true,"configured":true}`.
`POST /v1/usage` `{"password": "..."}` → 오늘(서울 날짜) 합계 `{"day": {"requests","input","cached","output","reasoning","total","usd_ticks"}, "used_today", "daily_limit"}` (Grok 호출 없음, KV `usage:YYYY-MM-DD`, 40일 보관).

## 명령줄 렌더러 `render_pose.py`
```bash
python3 render_pose.py pose.json -o out.png                                  # 정면, 512x768
python3 render_pose.py pose.json -o out.png --yaw 45 --pitch 10 --size 768x1024
python3 render_pose.py pose.json -o outdir/ --angles default --sheet          # 정면·r45·옆·뒤·위·아래 + 모음
python3 render_pose.py pose.json -o outdir/name.png --angles "0,0 30,10 r45 150,-10"
python3 render_pose.py pose.json -o outdir/ --angles all --sheet --json-out
```
옵션: `--size WxH`, `--thickness`(선 두께 배수), `--margin`(여백 비율, 기본 0.08), `--no-face`(눈·귀 빼기),
`--min-conf`, `--sheet`(한 장 모음), `--json-out`(각 PNG의 OpenPose 2D JSON).
프리셋 이름: front r45 right back l45 left high low high45 top. 여러 각도일 때는 모든 각도가 **같은 크기**로 맞춰져요.
그리기 방식은 ControlNet `draw_bodypose`와 같아요: 팔다리 = 색×0.6 타원(두께 4px@512), 관절 = 원색 원(반지름 4px@512).

## 한계
- 사진 한 장에서 깊이(앞뒤)를 추정하는 거라 옆·뒤 각도는 실제와 다를 수 있어요.
- 가려진 팔다리, 잘린 부분, 몸 뒤로 간 손은 틀릴 수 있어요 → 관절을 끌어서 고치기.
- 손가락·얼굴 표정 키포인트는 없어요(몸 18점만).
- 작게 나온 사람이 많은 단체 사진은 잘 못 찾아요(정밀 모드가 조금 나음).
- 여러 명일 때 사람 간 앞뒤 거리는 맞추지 않고 사진 속 가로·세로 위치로만 배치해요.
- 그림·애니 캐릭터는 인식이 안 되거나 부정확할 수 있어요.
- 말로 만든 포즈는 AI가 좌표를 상상해서 만든 거라 좌우·각도가 틀릴 수 있어요. 돌려 보고 관절을 끌어 고치세요.

## 라이선스
three.js (MIT), MediaPipe Tasks Vision 및 모델 (Apache-2.0).
