/**
 * 세이프티원 지도 좌표 → 십로케이션 야드 좌표(1380x840) 변환식을 **맞춰 보고 검증한다.**
 *
 *   node scripts/fit-yard-transform.mjs --input out/safetyone-list.json
 *   node scripts/fit-yard-transform.mjs --input ... --live ships.json   (검증용)
 *
 * 아무것도 쓰지 않는다. 계수와 잔차만 찍는다.
 *
 * 왜 이게 필요한가 (2026-08-29):
 *   세이프티원 배 레이어(/gis/ships)에는 선석 이름이 없다. 있는 건 x·y·angle 뿐이다.
 *   그러니 "2안벽" 같은 이름을 얻으려면 먼저 두 좌표계를 잇는 식이 있어야 한다.
 *
 * 왜 지금 맞출 수 있는가:
 *   사용자가 야드를 보고 확인해 줬다 — 지금 지도의 배는 전부 제자리다(2026-08-29).
 *   그러니 파이어스토어의 현재 좌표가 곧 정답 기준점이고, 같은 호선끼리 짝지으면
 *   기준점이 20쌍 넘게 생긴다. CLAUDE.md 의 좌표계 확정 절차가 요구한 "기준점 2~3개"
 *   보다 훨씬 많다.
 *
 * 왜 아핀인가:
 *   야드 도면을 돌리고(약 23도) 키우고 옮긴 것뿐이라 회전·축척·평행이동이면 충분하다.
 *   아핀이면 그게 다 들어간다. 안 맞으면 잔차가 크게 나오고, 그때는 가설이 틀린 것이다.
 *
 * ★계수를 눈으로 확인하기 전에는 반영하지 않는다. 세 번 연달아 "그럴듯하게 틀린"
 *  필드를 읽고 프로덕션의 배를 옮긴 뒤에 얻은 규칙이다.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, getDocs } from 'firebase/firestore';

const args = process.argv.slice(2);
const i = args.indexOf('--input');
const inputPath = i === -1 ? 'out/safetyone-list.json' : args[i + 1];

const cap = JSON.parse(readFileSync(inputPath, 'utf8'));
if (cap.kind !== 'coords') {
  console.error(`수집이 좌표가 아니라 '${cap.kind}' 다 — 배 레이어를 못 읽은 것이다. 맞출 게 없다.`);
  process.exit(1);
}
const src = new Map(cap.rows.map(r => [r.hull, r]));

// 기준점(=현재 지도의 배 좌표)은 파이어스토어에서 읽는다.
// --live 는 그 자리에 파일을 끼워 넣는다. 에뮬레이터를 못 띄우는 곳에서도
// 맞추기 자체를 검증할 수 있어야 하기 때문이다 — 검증 못 하는 계수는 박지 않는다.
const li = args.indexOf('--live');
const live = new Map();
if (li !== -1) {
  const f = JSON.parse(readFileSync(args[li + 1], 'utf8'));
  for (const [hull, v] of Object.entries(f)) live.set(hull, v);
} else {
  const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
  const db = getFirestore(initializeApp(cfg), cfg.firestoreDatabaseId);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, host, Number(port));
  }
  (await getDocs(collection(db, 'ships'))).forEach(d => live.set(d.id, d.data()));
}

/** 3x3 정규방정식을 가우스 소거로 푼다. 의존성 없이 쓰려고 직접 둔다. */
function solve3(A, b) {
  const m = A.map((row, r) => [...row, b[r]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;        // 기준점이 한 줄에 몰렸다
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** pts: [{sx,sy,ux,uy}] → {a,b,c,d,e,f} 로 ux≈a·sx+b·sy+c, uy≈d·sx+e·sy+f */
function fitAffine(pts) {
  const S = (fn) => pts.reduce((t, p) => t + fn(p), 0);
  const A = [
    [S(p => p.sx * p.sx), S(p => p.sx * p.sy), S(p => p.sx)],
    [S(p => p.sx * p.sy), S(p => p.sy * p.sy), S(p => p.sy)],
    [S(p => p.sx),        S(p => p.sy),        pts.length],
  ];
  const X = solve3(A, [S(p => p.sx * p.ux), S(p => p.sy * p.ux), S(p => p.ux)]);
  const Y = solve3(A, [S(p => p.sx * p.uy), S(p => p.sy * p.uy), S(p => p.uy)]);
  if (!X || !Y) return null;
  return { a: X[0], b: X[1], c: X[2], d: Y[0], e: Y[1], f: Y[2] };
}
const apply = (t, p) => ({ x: t.a * p.sx + t.b * p.sy + t.c, y: t.d * p.sx + t.e * p.sy + t.f });
const resid = (t, p) => Math.hypot(apply(t, p).x - p.ux, apply(t, p).y - p.uy);

// ── 기준점 짝짓기 ────────────────────────────────────────────────────────
const onlyMap = [], onlySafety = [];
for (const hull of src.keys()) if (!live.has(hull)) onlySafety.push(hull);
for (const hull of live.keys()) if (!src.has(hull)) onlyMap.push(hull);

console.log(`세이프티원 ${src.size}척 · 우리 지도 ${live.size}척`);
console.log(`세이프티원에만 있는 호선(${onlySafety.length}): ${onlySafety.sort().join(' ') || '없음'}`);
console.log(`우리 지도에만 있는 호선(${onlyMap.length}): ${onlyMap.sort().join(' ') || '없음'}`);

/**
 * ★후보가 둘이다. 어느 쪽인지 **고르지 않고 둘 다 맞춰 본다** (2026-08-29 run 14).
 *   x·y      : 지도가 배를 그리는 값이지만 **구조물 안의 지역 좌표**로 보인다.
 *              안벽에 붙은 배끼리만 맞추면 오차 1~4px 인데 도크 안 배는 자릿수가 다르고,
 *              23척을 한 식으로 맞추면 RMS 215px 가 나왔다.
 *   centerTm : 23척 전부 값이 다르다. 국가 평면직각좌표(TM)라면 전역 실좌표다.
 *              야드 도면은 실제 야드를 그대로 옮긴 그림이니 TM→지도는 아핀이어야 한다.
 *  잘 되는 쪽과 안 되는 쪽을 나란히 놓고 차이를 보는 게 추측보다 늘 빠르다(CLAUDE.md).
 */
const CANDS = [
  { name: 'x·y (구조물 안 지역 좌표?)', get: r => [r.x, r.y] },
  { name: 'centerTmX·centerTmY (전역 TM?)', get: r => [r.tmx, r.tmy] },
];

const results = [];
for (const cand of CANDS) {
  const pts = [];
  for (const [hull, r] of src) {
    const cur = live.get(hull);
    const [sx, sy] = cand.get(r);
    if (cur && Number.isFinite(cur.x) && Number.isFinite(cur.y) && Number.isFinite(sx) && Number.isFinite(sy))
      pts.push({ hull, sx, sy, ux: cur.x, uy: cur.y });
  }
  if (pts.length < 6) { results.push({ cand, skip: `기준점 ${pts.length}쌍뿐` }); continue; }

  // 손으로 옮겨 둔 배가 섞여 있을 수 있다. 한 번 맞춘 뒤 크게 벗어난 점을 빼고 다시 맞춘다.
  let t = fitAffine(pts);
  if (!t) { results.push({ cand, skip: '기준점이 한 직선에 몰려 있다' }); continue; }
  let used = pts;
  {
    const r0 = pts.map(p => resid(t, p));
    const rms0 = Math.sqrt(r0.reduce((s, v) => s + v * v, 0) / r0.length);
    const keep = pts.filter(p => resid(t, p) <= Math.max(3 * rms0, 20));
    if (keep.length >= 6 && keep.length < pts.length) {
      const t2 = fitAffine(keep);
      if (t2) { t = t2; used = keep; }
    }
  }
  const rs = used.map(p => resid(t, p));
  const rms = Math.sqrt(rs.reduce((s, v) => s + v * v, 0) / rs.length);
  results.push({ cand, t, used, dropped: pts.length - used.length, rms, max: Math.max(...rs) });
}

for (const r of results) {
  console.log(`\n----- ${r.cand.name} -----`);
  if (r.skip) { console.log(`  못 맞춤: ${r.skip}`); continue; }
  const { t } = r;
  // 아핀의 선형부를 회전·축척으로 읽는다 — 도면을 얼마나 돌리고 키운 것인지 눈으로 보려고.
  console.log(`x' = ${t.a.toFixed(6)}·x + ${t.b.toFixed(6)}·y + ${t.c.toFixed(3)}`);
  console.log(`y' = ${t.d.toFixed(6)}·x + ${t.e.toFixed(6)}·y + ${t.f.toFixed(3)}`);
  console.log(`축척 ${Math.hypot(t.a, t.d).toFixed(5)} / ${Math.hypot(t.b, t.e).toFixed(5)} · 회전 ${(Math.atan2(t.d, t.a) * 180 / Math.PI).toFixed(2)}°`);
  console.log(`기준점 ${r.used.length}쌍 (버린 것 ${r.dropped}) · RMS 잔차 ${r.rms.toFixed(1)}px · 최대 ${r.max.toFixed(1)}px`);
}

// 성공 기준: 배 한 척 폭(26px)보다 작으면 "같은 자리" 로 볼 수 있다.
const OK = 26;
const best = results.filter(r => !r.skip).sort((a, b) => a.rms - b.rms)[0];
if (!best) { console.error('\n어느 후보도 못 맞췄다.'); process.exit(1); }

console.log(`\n----- 이긴 후보: ${best.cand.name} -----`);
console.log(`호선별 잔차 (큰 것부터)`);
for (const p of [...best.used].sort((x, y) => resid(best.t, y) - resid(best.t, x))) {
  const q = apply(best.t, p);
  console.log(`  ${p.hull}  잔차 ${resid(best.t, p).toFixed(1).padStart(6)}px   변환 (${q.x.toFixed(0)},${q.y.toFixed(0)}) vs 지도 (${Math.round(p.ux)},${Math.round(p.uy)})`);
}
console.log(`\n${best.rms <= OK
  ? `✅ RMS ${best.rms.toFixed(1)}px ≤ 배 폭 ${OK}px — ${best.cand.name} 가 우리 지도와 아핀으로 이어진다. 이 계수를 박아도 된다.`
  : `❌ 두 후보 다 안 맞는다 (제일 나은 것도 RMS ${best.rms.toFixed(1)}px > ${OK}px). 계수를 박지 말 것.`}`);
process.exit(0);
