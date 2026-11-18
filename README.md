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

## 파일 구성
```
index.html  style.css  app.js        웹페이지
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

## 라이선스
three.js (MIT), MediaPipe Tasks Vision 및 모델 (Apache-2.0).
