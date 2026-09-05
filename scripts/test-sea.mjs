/**
 * 조석·바람 계산 회귀 테스트 — 브라우저도 파이어스토어도 없이 **실제 코드**를 돌린다.
 *
 * 지키는 것 셋:
 *  ① 화살표가 **정반대**를 가리키지 않는다 (풍향은 「불어오는 쪽」이다)
 *  ② 지도를 돌리면 나침반도 같이 돈다
 *  ③ 자정을 넘길 때 「남은 시간」이 음수가 되지 않는다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sea-'));
const out = join(dir, 'sea.mjs');
execFileSync('npx', ['esbuild', 'src/lib/sea.ts', '--bundle', '--format=esm', '--target=es2022', `--outfile=${out}`],
  { stdio: 'pipe' });
const S = await import(out);

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${what}`); }
  else { fail++; console.log(`  ✗ ${what}\n      기대 ${JSON.stringify(want)}\n      실제 ${JSON.stringify(got)}`); }
};
const near = (got, want, tol, what) => {
  const ok = Math.abs(got - want) <= tol;
  if (ok) { pass++; console.log(`  ✓ ${what} (${got.toFixed(1)})`); }
  else { fail++; console.log(`  ✗ ${what}\n      기대 ${want}±${tol}\n      실제 ${got}`); }
};

console.log('\n① 지도의 북쪽 — 계수에서 뽑는다 (박은 숫자가 아니다)');
near(S.NORTH_ON_MAP_DEG, 336.4, 0.2, '북쪽은 화면 위에서 시계 336.4도 = 반시계 23.6도');
near(S.northScreenDeg(0), 336.4, 0.2, '회전 0');
near(S.northScreenDeg(90), 66.4, 0.2, '90도 세우면 북쪽도 90도 따라 돈다');
near(S.northScreenDeg(270), 246.4, 0.2, '270도');

console.log('\n② 화살표는 바람이 **가는** 쪽 ★반대로 그리면 배가 밀리는 방향이 뒤집힌다');
{
  // 북풍(0°) = 북에서 불어온다 → 남쪽으로 간다. 지도에서 남쪽 = 336.4+180 = 156.4
  near(S.windTravelScreenDeg(0, 0), 156.4, 0.2, '북풍이면 화살표는 지도의 남쪽을 가리킨다');
  near(S.windTravelScreenDeg(180, 0), 336.4, 0.2, '남풍이면 북쪽을 가리킨다');
  const d = Math.abs(S.windTravelScreenDeg(0, 0) - S.northScreenDeg(0));
  near(Math.min(d, 360 - d), 180, 0.2, '북풍 화살표와 N 표시는 정확히 180도 벌어진다');
  near(S.windTravelScreenDeg(0, 90), 246.4, 0.2, '지도를 90도 돌리면 화살표도 90도 돈다');
}

console.log('\n③ 다음 조석 — 자정을 넘겨도 음수가 안 나온다');
const T = [
  { type: 'High', time: '02:00', height: 400 },
  { type: 'Low',  time: '08:12', height: 120 },
  { type: 'High', time: '14:24', height: 410 },
  { type: 'Low',  time: '20:36', height: 110 },
];
{
  const r = S.nextTide(T, 11 * 60 + 43);          // 11:43 → 다음 14:24
  eq(r.next.time, '14:24', '한낮: 다음은 14:24');
  eq(r.minsLeft, 161, '남은 161분');
  eq(r.rising, true, '만조를 기다리니 밀물');
  eq(r.prev.time, '08:12', '직전은 08:12');
  near(r.progress, (11 * 60 + 43 - 492) / (864 - 492), 0.001, '진행도');
}
{
  const r = S.nextTide(T, 23 * 60);               // 23:00 → 오늘 것은 다 지났다
  eq(r.next.time, '02:00', '★밤: 다음은 내일 첫 조석');
  eq(r.minsLeft, 180, '★남은 180분 (음수가 아니다)');
  eq(r.prev.time, '20:36', '직전은 오늘 마지막');
}
{
  const r = S.nextTide(T, 30);                    // 00:30 → 첫 조석 전
  eq(r.next.time, '02:00', '새벽: 다음은 02:00');
  eq(r.minsLeft, 90, '남은 90분');
  eq(r.prev.time, '20:36', '★직전은 **어제** 마지막');
  const ok = r.progress > 0 && r.progress < 1;
  eq(ok, true, '진행도가 0~1 안에 있다');
}
{
  eq(S.nextTide([], 600), null, '조석이 없으면 null (화면이 안 깨진다)');
}

console.log('\n④ 남은 시간 글귀');
eq(S.untilText(161), '2시간 41분', '2시간 41분');
eq(S.untilText(41), '41분', '한 시간 미만');
eq(S.untilText(0), '지금', '0이면 「지금」');
eq(S.untilText(-5), '지금', '음수여도 이상한 글자가 안 나온다');

console.log('\n⑤ 풍향 이름');
eq(S.dirName(0), '북', '0도 = 북');
eq(S.dirName(315), '북서', '315도 = 북서');
eq(S.dirName(350), '북', '350도는 북으로 반올림');

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
