/**
 * 세이프티원 지도 캔버스에서 **뱃머리 방향**을 읽는다.
 *
 * ★왜 그림에서 읽나 (2026-08-30)
 *  배 레이어 `/gis/ships` 의 `angle` 은 `0` 과 `±90` 두 값뿐이라 **축**밖에 말하지 않는다.
 *  선수·선미를 가진 필드는 22개 중 하나도 없다. 그런데 **그림에는 있다** — 사용자가
 *  알려준 대로 세이프티원은 배를 그릴 때 **선수는 둥글게, 선미는 네모나게** 그린다.
 *  (내가 처음에 "대칭이라 정보가 없다" 고 한 것은 끝에서 8% 지점의 폭을 재서
 *   신호를 뭉갠 탓이었다. 끝단 1~4px 을 재면 아래 표처럼 깨끗하게 갈린다.)
 *
 * ★실측 (docs/reference/safetyone-map.png, 흰 도형 13척)
 *    끝단 폭 합(끝에서 1·2·3·4px, 만폭 대비)
 *      둥근 끝(선수)  1.02 ~ 1.36
 *      뭉툭한 끝(선미) 2.57 ~ 4.00
 *    사이가 1.4↔2.6 으로 비어 있어 임계값을 그 한가운데 두면 된다.
 *
 * ★블록은 양끝이 다 네모다 (사용자 지시)
 *  도크에 블록 단위로 들어온 호선은 선수·선미가 다 각져 있다. 그런 배는 **판정하지
 *  않고** 호출한 쪽이 예전처럼 선석 관례로 놓게 둔다. 실측 8238 이 정확히 그 꼴로
 *  나왔다(양끝 2.79 / 2.72). 억지로 한쪽을 고르면 절반은 반대로 그린다.
 */

/** 끝단 폭 합이 이보다 작으면 둥근 끝(선수). */
export const BOW_TIP_MAX = 1.8;
/** 끝단 폭 합이 이보다 크면 뭉툭한 끝(선미 또는 블록 단면). */
export const BLUNT_TIP_MIN = 2.2;
/**
 * 이보다 작은 흰 덩어리는 배가 아니다(글자·아이콘).
 *
 * ★라이브 캔버스는 도면 PNG 보다 작게 그려진다 — 실측 1385x1322 에서 배 덩어리가
 *  500~1153px 이었다(도면 PNG 는 2000~3200px). 900 으로 잡았더니 **2개만 통과**했다.
 *  축소본으로 다시 재보니 끝단 판정 자체는 멀쩡하다(간격 1.04, 애매 0) — 걸린 건
 *  크기 문턱뿐이었다. 그래서 낮게 잡고, 배가 아닌 것은 길이·홀쭉함과 짝짓기(RANSAC)로
 *  걸러낸다. 크기로 거르는 건 화면 배율이 바뀌면 언제든 다시 깨진다.
 */
export const MIN_BLOB_PX = 250;
/** 배로 보려면 최소한 이만큼 길고 이만큼 홀쭉해야 한다. */
export const MIN_LEN = 35;
export const MIN_ASPECT = 2.2;

const deg = (r) => (r * 180) / Math.PI;
const norm360 = (a) => ((a % 360) + 360) % 360;

/**
 * 흰 픽셀 마스크에서 연결성분을 찾는다.
 * @param mask Uint8Array(W*H) — 1 이면 흰색
 * @returns [Int32Array of pixel indices]
 */
export function findBlobs(mask, W, H) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    const pix = [];
    while (sp > 0) {
      const p = stack[--sp];
      pix.push(p);
      const x = p % W, y = (p - x) / W;
      if (x > 0     && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0     && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W; }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W; }
    }
    if (pix.length >= MIN_BLOB_PX) out.push(pix);
  }
  return out;
}

/**
 * 도형 안의 구멍(호선번호 글자가 검게 찍힌 자리)을 메운다.
 *
 * ★이게 없으면 글자가 폭을 갉아먹어 2~3px 짜리 가짜 신호를 낸다 — 실제로 한 번
 *  그 가짜 신호로 반대 결론을 냈다. 테두리에서 배경을 흘려보내고 안 닿은 배경이 구멍이다.
 */
function fillHoles(pix, W) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pix) {
    const x = p % W, y = (p - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 3, bh = y1 - y0 + 3;
  const m = new Uint8Array(bw * bh);
  for (const p of pix) {
    const x = p % W, y = (p - x) / W;
    m[(y - y0 + 1) * bw + (x - x0 + 1)] = 1;
  }
  const reach = new Uint8Array(bw * bh);
  const st = [];
  for (let i = 0; i < bh; i++) for (const j of [0, bw - 1]) {
    const k = i * bw + j; if (!m[k] && !reach[k]) { reach[k] = 1; st.push(k); }
  }
  for (let j = 0; j < bw; j++) for (const i of [0, bh - 1]) {
    const k = i * bw + j; if (!m[k] && !reach[k]) { reach[k] = 1; st.push(k); }
  }
  while (st.length) {
    const k = st.pop();
    const j = k % bw, i = (k - j) / bw;
    if (j > 0      && !m[k - 1]  && !reach[k - 1])  { reach[k - 1] = 1;  st.push(k - 1); }
    if (j < bw - 1 && !m[k + 1]  && !reach[k + 1])  { reach[k + 1] = 1;  st.push(k + 1); }
    if (i > 0      && !m[k - bw] && !reach[k - bw]) { reach[k - bw] = 1; st.push(k - bw); }
    if (i < bh - 1 && !m[k + bw] && !reach[k + bw]) { reach[k + bw] = 1; st.push(k + bw); }
  }
  const pts = [];
  for (let k = 0; k < bw * bh; k++) {
    if (m[k] || !reach[k]) {
      const j = k % bw, i = (k - j) / bw;
      pts.push([x0 + j - 1, y0 + i - 1]);
    }
  }
  return pts;
}

/**
 * 한 덩어리의 모양을 잰다 — 주축, 길이, 폭, 그리고 **양 끝의 끝맺음**.
 * @returns null 이면 배로 보기엔 너무 짧거나 통통하다
 */
export function blobShape(pix, W) {
  const pts = fillHoles(pix, W);
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  const cx = sx / pts.length, cy = sy / pts.length;
  let vxx = 0, vxy = 0, vyy = 0;
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    vxx += dx * dx; vxy += dx * dy; vyy += dy * dy;
  }
  vxx /= pts.length; vxy /= pts.length; vyy /= pts.length;
  // 2x2 대칭행렬의 큰 고유벡터 = 주축
  const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax, ay;
  if (Math.abs(vxy) > 1e-9) { ax = l1 - vyy; ay = vxy; }
  else if (vxx >= vyy)      { ax = 1; ay = 0; }
  else                      { ax = 0; ay = 1; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;
  const px = -ay, py = ax;                       // 축에 수직

  const ts = [], ns = [];
  for (const [x, y] of pts) {
    const dx = x - cx, dy = y - cy;
    ts.push(dx * ax + dy * ay);
    ns.push(dx * px + dy * py);
  }
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const len = tMax - tMin;
  const spanAt = (pos, tol) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] > pos - tol && ts[i] < pos + tol) {
        if (ns[i] < lo) lo = ns[i];
        if (ns[i] > hi) hi = ns[i];
      }
    }
    return hi >= lo ? hi - lo : 0;
  };
  const wid = Math.max(spanAt(tMin + len * 0.4, 2), spanAt(tMin + len * 0.5, 2), spanAt(tMin + len * 0.6, 2));
  if (len < MIN_LEN || wid <= 0 || len / wid < MIN_ASPECT) return null;

  // ★끝에서 1·2·3·4px 의 폭 비율 합. 끝단 가까이서 재야 신호가 산다.
  const tipSum = (fromLo) => {
    let s = 0;
    for (const d of [1, 2, 3, 4]) s += spanAt(fromLo ? tMin + d : tMax - d, 0.6) / wid;
    return s;
  };
  const tipLo = tipSum(true), tipHi = tipSum(false);
  let bowAt = null;
  if (tipLo <= BOW_TIP_MAX && tipHi >= BLUNT_TIP_MIN) bowAt = 'lo';
  else if (tipHi <= BOW_TIP_MAX && tipLo >= BLUNT_TIP_MIN) bowAt = 'hi';
  // 둘 다 뭉툭하면 블록 — 판정하지 않는다(bowAt = null)

  const axisDeg = norm360(deg(Math.atan2(ay, ax)));
  const bowDeg = bowAt === null ? null : norm360(bowAt === 'hi' ? axisDeg : axisDeg + 180);
  return { cx, cy, axisDeg, len, wid, tipLo, tipHi, bowAt, bowDeg };
}

/** 마스크 → 배로 볼 만한 도형들. */
export function detectShips(mask, W, H) {
  const out = [];
  for (const pix of findBlobs(mask, W, H)) {
    const s = blobShape(pix, W);
    if (s) out.push(s);
  }
  return out;
}

/** 두 쌍으로 결정되는 닮음변환(회전+균등축척+평행이동). */
function similarityFrom2(p1, q1, p2, q2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const ex = q2.x - q1.x, ey = q2.y - q1.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-9) return null;
  const a = (dx * ex + dy * ey) / d2;       // s·cosθ
  const b = (dx * ey - dy * ex) / d2;       // s·sinθ
  return { a, b, tx: q1.x - (a * p1.x - b * p1.y), ty: q1.y - (b * p1.x + a * p1.y) };
}
export const applyT = (T, p) => ({ x: T.a * p.x - T.b * p.y + T.tx, y: T.b * p.x + T.a * p.y + T.ty });

/**
 * 도형 ↔ 호선 짝짓기. 대응을 모르므로 두 쌍을 골라 변환을 세우고 표를 세는 RANSAC 이다.
 *
 * ★기준을 **우리가 저장한 좌표가 아니라 `tmToYard` 로 옮긴 세이프티원 좌표**로 삼아야 한다.
 *  저장 좌표는 사람이 다듬은 자리라 최대 37px 까지 벌어지는데, 이중 계류한 두 척은
 *  23px 밖에 안 떨어져 있어 그 오차로는 **두 배를 뒤바꿔 붙일 수 있다.** 그림과 같은
 *  출처(TM)를 기준으로 삼으면 잔차가 몇 px 로 떨어져 뒤바뀔 여지가 없다.
 *
 * @param shapes detectShips 결과
 * @param expected [{hull, x, y}] — tmToYard 로 옮긴 세이프티원 좌표
 * @param tol 야드 px 허용 오차
 */
export function registerBlobs(shapes, expected, tol = 25) {
  if (shapes.length < 3 || expected.length < 3) return null;
  // 멀리 떨어진 쌍일수록 변환이 안정적이다. 위에서 몇 개만 시도한다.
  const pairs = [];
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++)
      pairs.push([i, j, Math.hypot(shapes[i].cx - shapes[j].cx, shapes[i].cy - shapes[j].cy)]);
  pairs.sort((p, q) => q[2] - p[2]);

  let best = null;
  for (const [i, j] of pairs.slice(0, 12)) {
    const p1 = { x: shapes[i].cx, y: shapes[i].cy }, p2 = { x: shapes[j].cx, y: shapes[j].cy };
    for (let a = 0; a < expected.length; a++) {
      for (let b = 0; b < expected.length; b++) {
        if (a === b) continue;
        const T = similarityFrom2(p1, expected[a], p2, expected[b]);
        if (!T) continue;
        const scale = Math.hypot(T.a, T.b);
        if (scale < 0.2 || scale > 5) continue;          // 말이 안 되는 축척은 버린다
        const used = new Set();
        const got = [];
        for (const s of shapes) {
          const q = applyT(T, { x: s.cx, y: s.cy });
          let bh = null, bd = tol;
          for (const e of expected) {
            if (used.has(e.hull)) continue;
            const d = Math.hypot(q.x - e.x, q.y - e.y);
            if (d < bd) { bd = d; bh = e; }
          }
          if (bh) { used.add(bh.hull); got.push({ hull: bh.hull, shape: s, dist: bd }); }
        }
        if (!best || got.length > best.pairs.length) best = { T, pairs: got };
      }
    }
  }
  return best && best.pairs.length >= 3 ? best : null;
}

/**
 * 캔버스 마스크 → `Map(호선 → 뱃머리 야드각)`.
 * 판정이 안 되는 배(블록·못 찾음)는 **아예 넣지 않는다** — 호출한 쪽이 선석 관례로 놓게.
 *
 * @param expected [{hull, x, y}] — tmToYard 로 옮긴 세이프티원 좌표
 * @returns {bows: Map, matched: number, found: number}
 */
export function bowByHull(mask, W, H, expected) {
  const shapes = detectShips(mask, W, H);
  const reg = registerBlobs(shapes, expected);
  const bows = new Map();
  if (!reg) return { bows, matched: 0, found: shapes.length };
  // 도형각(이미지) → 야드각: 변환의 회전분만큼 돌린다.
  const rot = deg(Math.atan2(reg.T.b, reg.T.a));
  for (const { hull, shape } of reg.pairs) {
    if (shape.bowDeg === null) continue;                 // 블록 — 판정하지 않는다
    bows.set(hull, norm360(shape.bowDeg + rot));
  }
  return { bows, matched: reg.pairs.length, found: shapes.length };
}

/**
 * 스크레이퍼가 넘긴 1비트 마스크(base64)를 Uint8Array 로 푼다.
 * 그림을 파일로 남기지 않으려고 "흰가 아닌가" 만 비트로 실어 보낸다.
 */
export function unpackMask(b64, n) {
  const bin = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

/**
 * 잰 뱃머리 방향(야드각) → 마커 회전 r. **축 위의 두 값 중 가까운 쪽**으로 붙인다.
 * 각도를 그대로 쓰지 않는 이유: 도면은 26.7° 기울어 그려져 있어 그대로 쓰면
 * 배가 비스듬히 눕는다. 축은 angle 이 정확히 알려주므로 거기에 스냅한다.
 */
export function headingFromBow(bowDeg, axisR) {
  const axis = (((axisR ?? 0) % 180) + 180) % 180;
  let best = null, bestD = Infinity;
  for (const r of [axis, axis + 180]) {
    const rad = (r * Math.PI) / 180;
    const dir = norm360(deg(Math.atan2(-Math.cos(rad), Math.sin(rad))));   // r 일 때 뱃머리가 향하는 각
    const d = Math.abs(((dir - bowDeg + 540) % 360) - 180);
    if (d < bestD) { bestD = d; best = r % 360; }
  }
  return best;
}

/**
 * 한 척도 못 읽었을 때 **왜인지 재서** 알려준다. 추측 대신 숫자를 남기려는 것.
 * 공개 로그에 나가는 건 개수와 크기뿐 — 그림 내용은 아니다.
 */
export function diagnose(mask, W, H) {
  const all = [];
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1;
    let n = 0;
    while (sp > 0) {
      const p = stack[--sp]; n++;
      const x = p % W, y = (p - x) / W;
      if (x > 0     && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0     && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W; }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W; }
    }
    if (n >= 50) all.push(n);
  }
  all.sort((a, b) => b - a);
  const bucket = (lo, hi) => all.filter(n => n >= lo && n < hi).length;
  return {
    덩어리: all.length,
    크기별: { '50~199': bucket(50, 200), '200~499': bucket(200, 500),
              '500~899': bucket(500, 900), '900이상': bucket(900, Infinity) },
    큰것10: all.slice(0, 10),
  };
}
