#!/usr/bin/env python3
"""포즈 JSON(pose-skeleton/v1) → OpenPose(ControlNet) 스타일 PNG 렌더러 (헤드리스).

웹페이지의 '여러 각도 한 번에 저장'과 같은 계산(원근 투영, FOV 35°, 모든 각도 같은 크기로 자동 맞춤)을 써요.

예)
  python3 render_pose.py pose.json -o out/pose.png                      # 정면 512x768
  python3 render_pose.py pose.json -o out/pose.png --yaw 45 --pitch 10 --size 768x1024
  python3 render_pose.py pose.json -o out/ --angles "0,0 45,0 90,0 180,0 0,30 0,-20" --sheet
  python3 render_pose.py pose.json -o out/ --angles all --sheet
yaw: 0=정면(사진 방향), 90=화면 오른쪽(+x)에서 봄, 180=뒤, -90=왼쪽.  pitch: +면 위에서 내려다봄.
"""
import argparse, json, math, os, sys
from PIL import Image, ImageDraw, ImageFont

NAMES = ['nose','neck','r_shoulder','r_elbow','r_wrist','l_shoulder','l_elbow','l_wrist',
         'r_hip','r_knee','r_ankle','l_hip','l_knee','l_ankle','r_eye','l_eye','r_ear','l_ear']
LIMBS = [(1,2),(1,5),(2,3),(3,4),(5,6),(6,7),(1,8),(8,9),(9,10),(1,11),(11,12),(12,13),(1,0),(0,14),(14,16),(0,15),(15,17)]
COLORS = [(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),(85,255,0),(0,255,0),(0,255,85),(0,255,170),
          (0,255,255),(0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),(255,0,255),(255,0,170),(255,0,85)]
FACE = {14,15,16,17}
FOV = 35.0
PRESETS = {'front':(0,0),'r45':(45,0),'right':(90,0),'back':(180,0),'l45':(-45,0),'left':(-90,0),
           'high':(0,30),'low':(0,-20),'high45':(45,25),'top':(0,89)}
DEFAULT_SET = ['front','r45','right','back','high','low']


def load_people(path):
    data = json.load(sys.stdin if path == '-' else open(path, encoding='utf-8'))
    people = data if isinstance(data, list) else data.get('people') or ([data] if 'pose_keypoints_3d' in data or 'keypoints' in data else None)
    if not people:
        sys.exit('people 배열이 없어요')
    out = []
    for p in people:
        pts, vis = [], []
        if isinstance(p.get('keypoints'), dict):
            for n in NAMES:
                k = p['keypoints'].get(n)
                pts.append(tuple(k[:3]) if k else (0,0,0)); vis.append((k[3] if len(k) > 3 else 1) if k else 0)
        else:
            a = p.get('pose_keypoints_3d')
            if not a or len(a) < 54:
                sys.exit('pose_keypoints_3d(18점 × x,y,z[,c])가 필요해요')
            st = 4 if len(a) >= 72 else 3
            for j in range(18):
                pts.append(tuple(a[j*st:j*st+3])); vis.append(a[j*st+3] if st == 4 else 1)
        out.append((pts, vis))
    return data, out


def project(people, yaw, pitch):
    allp = [v for pts in people for v in pts if v is not None]
    if not allp:
        allp = [(0,0,0)]
    mn = [min(v[i] for v in allp) for i in range(3)]; mx = [max(v[i] for v in allp) for i in range(3)]
    c = [(a+b)/2 for a, b in zip(mn, mx)]
    r = max(math.dist(mn, mx)/2, 0.3)
    dist = r / math.sin(math.radians(FOV/2)) * 1.05
    y, p = math.radians(yaw), math.radians(max(-89.9, min(89.9, pitch)))
    pos = (c[0]+dist*math.sin(y)*math.cos(p), c[1]+dist*math.sin(p), c[2]+dist*math.cos(y)*math.cos(p))
    f = norm(sub(c, pos)); rt = norm(cross(f, (0,1,0))); up = cross(rt, f)
    res = []
    for pts in people:
        row = []
        for v in pts:
            if v is None: row.append(None); continue
            d = sub(v, pos); z = dot(d, f)
            row.append(None if z <= 1e-3 else (dot(d, rt)/z, -dot(d, up)/z))
        res.append(row)
    return res

sub = lambda a, b: (a[0]-b[0], a[1]-b[1], a[2]-b[2])
dot = lambda a, b: a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
cross = lambda a, b: (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0]/l, a[1]/l, a[2]/l)


def fit(proj, W, H, margin):
    q = [x for row in proj for x in row if x]
    if not q: return 1, 0, 0
    xs, ys = [a for a, _ in q], [b for _, b in q]
    s = min(W*(1-2*margin)/max(max(xs)-min(xs), 1e-6), H*(1-2*margin)/max(max(ys)-min(ys), 1e-6))
    return s, (min(xs)+max(xs))/2, (min(ys)+max(ys))/2


def ellipse_poly(cx, cy, a, b, ang, n=36):
    ca, sa = math.cos(ang), math.sin(ang)
    return [(cx + a*math.cos(t)*ca - b*math.sin(t)*sa, cy + a*math.cos(t)*sa + b*math.sin(t)*ca)
            for t in (2*math.pi*i/n for i in range(n))]


def draw_openpose(people2d, W, H, thickness=1.0, ss=4):
    """ControlNet draw_bodypose와 같은 방식: 팔다리 = 색×0.6 타원, 관절 = 원색 원. ss배 슈퍼샘플링."""
    img = Image.new('RGB', (W*ss, H*ss), (0,0,0)); d = ImageDraw.Draw(img)
    k = max(W, H)/512*thickness*ss; stick = rad = 4*k
    for pts in people2d:
        for i, (a, b) in enumerate(LIMBS):
            A, B = pts[a], pts[b]
            if not A or not B: continue
            A = (A[0]*ss, A[1]*ss); B = (B[0]*ss, B[1]*ss)
            L = math.hypot(B[0]-A[0], B[1]-A[1])
            col = tuple(int(c*0.6) for c in COLORS[i])
            d.polygon(ellipse_poly((A[0]+B[0])/2, (A[1]+B[1])/2, max(L/2, 0.5), stick, math.atan2(B[1]-A[1], B[0]-A[0])), fill=col)
        for j, P in enumerate(pts):
            if P: d.ellipse([P[0]*ss-rad, P[1]*ss-rad, P[0]*ss+rad, P[1]*ss+rad], fill=COLORS[j])
    return img.resize((W, H), Image.LANCZOS) if ss > 1 else img


def parse_angles(args):
    if args.angles:
        if args.angles.strip() in ('all', 'default'):
            keys = list(PRESETS) if args.angles.strip() == 'all' else DEFAULT_SET
            return [(k, *PRESETS[k]) for k in keys]
        out = []
        for tok in args.angles.replace(';', ' ').split():
            if tok in PRESETS: out.append((tok, *PRESETS[tok])); continue
            yw, _, pt = tok.partition(',')
            out.append((None, float(yw), float(pt or 0)))
        return out
    return [(None, args.yaw, args.pitch)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('json', help="포즈 JSON 파일 ('-'면 stdin)")
    ap.add_argument('-o', '--out', default='pose.png', help='PNG 파일 경로(각도 1개) 또는 폴더/접두어(여러 각도)')
    ap.add_argument('--yaw', type=float, default=0); ap.add_argument('--pitch', type=float, default=0)
    ap.add_argument('--angles', help="'yaw,pitch yaw,pitch ...' 또는 프리셋 이름(front r45 right back l45 left high low high45 top) 또는 all/default")
    ap.add_argument('--size', default='512x768', help='WxH (기본 512x768)')
    ap.add_argument('--thickness', type=float, default=1.0)
    ap.add_argument('--margin', type=float, default=0.08)
    ap.add_argument('--no-face', action='store_true', help='눈·귀 점 빼기')
    ap.add_argument('--min-conf', type=float, default=0.0, help='이 값보다 c가 낮은 관절은 빼기')
    ap.add_argument('--sheet', action='store_true', help='모든 각도를 한 장에 모은 PNG도 저장')
    ap.add_argument('--json-out', action='store_true', help='각 PNG 옆에 OpenPose 2D JSON도 저장')
    a = ap.parse_args()
    W, H = (int(x) for x in a.size.lower().split('x'))
    _, people = load_people(a.json)
    def keep(j, c):
        if c <= 0 or (a.no_face and j in FACE): return False
        return c >= a.min_conf
    pts3 = [[v if keep(j, c) else None for j, (v, c) in enumerate(zip(pts, vis))] for pts, vis in people]
    angles = parse_angles(a)
    projs = [project(pts3, yw, pt) for _, yw, pt in angles]
    fits = [fit(p, W, H, a.margin) for p in projs]
    s = min(f[0] for f in fits)
    multi = len(angles) > 1 or a.out.endswith('/') or os.path.isdir(a.out)
    if multi:
        base_dir = a.out if (a.out.endswith('/') or os.path.isdir(a.out)) else os.path.dirname(a.out) or '.'
        prefix = 'pose' if (a.out.endswith('/') or os.path.isdir(a.out)) else os.path.splitext(os.path.basename(a.out))[0]
        os.makedirs(base_dir, exist_ok=True)
    else:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    tiles, written = [], []
    for i, ((key, yw, pt), pr, f) in enumerate(zip(angles, projs, fits)):
        p2 = [[(W/2+(q[0]-f[1])*s, H/2+(q[1]-f[2])*s) if q else None for q in row] for row in pr]
        img = draw_openpose(p2, W, H, a.thickness)
        if multi:
            tag = key or 'view'
            path = os.path.join(base_dir, f'{prefix}_{i+1:02d}_{tag}_yaw{yw:g}_pitch{pt:g}.png')
        else:
            path = a.out
        img.save(path); written.append(path); tiles.append((f'yaw {yw:g}°, pitch {pt:g}°' + (f' ({key})' if key else ''), img))
        if a.json_out:
            with open(os.path.splitext(path)[0] + '.json', 'w') as fh:
                json.dump({'canvas_width': W, 'canvas_height': H, 'view': {'yaw_deg': yw, 'pitch_deg': pt},
                           'people': [{'pose_keypoints_2d': [v for q in row for v in ((round(q[0],2), round(q[1],2), 1) if q else (0,0,0))]} for row in p2]}, fh)
    if a.sheet:
        n = len(tiles); cols = n if n <= 4 else math.ceil(math.sqrt(n*1.5)); rows = math.ceil(n/cols)
        sc = min(1, 360/max(W, H)); tw, th, gap, lab = round(W*sc), round(H*sc), 6, 22
        sheet = Image.new('RGB', (cols*tw+(cols+1)*gap, rows*(th+lab)+(rows+1)*gap), (34,34,34)); d = ImageDraw.Draw(sheet)
        try: font = ImageFont.truetype('DejaVuSans.ttf', 14)
        except OSError: font = ImageFont.load_default()
        for i, (label, img) in enumerate(tiles):
            x = gap + (i % cols)*(tw+gap); y = gap + (i//cols)*(th+lab+gap)
            d.text((x+2, y+3), label, fill=(220,220,220), font=font); sheet.paste(img.resize((tw, th), Image.LANCZOS), (x, y+lab))
        sp = os.path.join(base_dir, f'{prefix}_sheet.png') if multi else os.path.splitext(a.out)[0] + '_sheet.png'
        sheet.save(sp); written.append(sp)
    print('\n'.join(written))


if __name__ == '__main__':
    main()
