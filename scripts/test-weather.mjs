/**
 * 날씨 판정 회귀 테스트 — 브라우저 없이 **실제 코드**를 그대로 돌린다(`test-sea.mjs` 와 같은 방식).
 *
 * 지키는 것 넷:
 *  ① 맑음·구름·안개에는 **아무것도 안 그린다** — 유리에 맺힐 것이 없다
 *  ② 모르는 코드를 「비」로 넘겨짚지 않는다 (지어낸 날씨 = 지어낸 조석)
 *  ③ 바람이 세도 기울기가 40°를 안 넘는다 — 그 이상은 지도를 못 읽는다
 *  ④ 비가 기우는 쪽이 **칩의 나침반과 같은 쪽**이다 (규약이 갈라지면 둘 다 못 믿는다)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wx-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', '--target=es2022', `--outfile=${out}`], { stdio: 'pipe' });
  return import(out);
};
const W = await bundle('src/lib/weather.ts', 'weather.mjs');
const S = await bundle('src/lib/sea.ts', 'sea.mjs');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}`); } };
const eq = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want),
  `${what}${JSON.stringify(got) === JSON.stringify(want) ? '' : `\n      기대 ${JSON.stringify(want)}\n      실제 ${JSON.stringify(got)}`}`);

console.log('\n[1] 효과가 있는 날씨');
eq(W.wmoToWx(61), { kind: '비', level: 1 }, '61 약한 비');
eq(W.wmoToWx(63), { kind: '비', level: 2 }, '63 보통 비');
eq(W.wmoToWx(65), { kind: '비', level: 3 }, '65 강한 비');
eq(W.wmoToWx(51), { kind: '비', level: 1 }, '51 이슬비는 약함');
eq(W.wmoToWx(82), { kind: '비', level: 3 }, '82 격렬한 소나기');
eq(W.wmoToWx(73), { kind: '눈', level: 2 }, '73 보통 눈');
eq(W.wmoToWx(77), { kind: '눈', level: 1 }, '77 싸락눈은 약함');
eq(W.wmoToWx(86), { kind: '눈', level: 3 }, '86 강한 소낙눈');
eq(W.wmoToWx(95), { kind: '뇌우', level: 2 }, '95 뇌우');
eq(W.wmoToWx(99), { kind: '뇌우', level: 3 }, '99 우박 동반 뇌우');

console.log('\n[2] ★아무것도 안 그리는 날씨 — 유리에 맺힐 것이 없다');
for (const [c, n] of [[0, '맑음'], [1, '대체로 맑음'], [2, '구름 조금'], [3, '흐림'], [45, '안개'], [48, '상고대 안개']])
  eq(W.wmoToWx(c), null, `${c} ${n}`);

console.log('\n[3] ★모르는 값을 넘겨짚지 않는다');
for (const v of [undefined, null, '', 'rain', NaN, -1, 4, 70, 100, 999])
  eq(W.wmoToWx(v), null, `${JSON.stringify(v)} → null`);

console.log('\n[4] 기울기 — 강해도 40°를 안 넘는다');
ok(W.windTiltDeg(0) === 4, '무풍이면 4° (수직에 가깝게)');
ok(W.windTiltDeg(null) === 4, '값이 없으면 4°');
ok(Math.abs(W.windTiltDeg(5) - 11) < 0.01, '5 m/s → 11°');
ok(W.windTiltDeg(100) === 40, '100 m/s 라도 40° 에서 자른다');
ok(W.windTiltDeg(-3) === 4, '음수도 4° (실수한 값에 화면이 뒤집히지 않는다)');

console.log('\n[5] ★비가 기우는 쪽이 칩의 나침반과 같은 쪽인가');
{
  // 화면 90°(=3시 방향)로 부는 바람이면 가로로 **오른쪽**(+)으로 밀어야 한다.
  ok(W.windPushX(10, 90) > 0, '화면 3시로 가는 바람 → 오른쪽(+)으로 민다');
  ok(W.windPushX(10, 270) < 0, '화면 9시로 가는 바람 → 왼쪽(−)으로 민다');
  ok(Math.abs(W.windPushX(10, 0)) < 1e-9, '화면 12시로 가는 바람 → 가로로 안 민다 (세로 성분은 안 쓴다)');
  ok(Math.abs(W.windPushX(10, 180)) < 1e-9, '화면 6시로 가는 바람 → 가로로 안 민다');

  // 실제 규약 연결: 북풍(북에서 불어옴)은 남쪽으로 간다. 지도 회전 0 에서 화면각을 sea.ts 가 낸다.
  const deg0 = S.windTravelScreenDeg(0, 0);
  const push0 = W.windPushX(8, deg0);
  ok(Math.sign(push0) === Math.sign(Math.sin(deg0 * Math.PI / 180)),
     `북풍·회전0 → 화면각 ${deg0.toFixed(1)}° 와 미는 쪽의 부호가 같다`);

  // 지도를 90° 돌리면 미는 쪽도 같이 돈다 — 나침반이 도는 것과 같은 이유다.
  const a = W.windPushX(8, S.windTravelScreenDeg(90, 0));
  const b = W.windPushX(8, S.windTravelScreenDeg(90, 90));
  ok(Math.abs(a - b) > 1e-6, '지도를 돌리면 비가 기우는 쪽도 같이 돈다');

  ok(Math.abs(W.windPushX(60, 90)) <= Math.sin(40 * Math.PI / 180) + 1e-9,
     '아무리 세도 가로 성분이 sin(40°) 를 안 넘는다');
}

console.log('\n[6] 시작 지연 — 앱 로딩을 느리게 하지 않는다');
ok(W.FX_START_DELAY_MS >= 3000, `효과는 ${W.FX_START_DELAY_MS}ms 뒤에 붙는다`);

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
