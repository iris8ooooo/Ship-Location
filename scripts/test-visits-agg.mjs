/**
 * 접속 집계 계산 회귀 테스트 — 파이어스토어 없이 **실제 코드**를 그대로 돌린다.
 *
 * 지켜야 하는 것: **한 사람은 하루에 한 번만 세인다.**
 * 앱은 뜨자마자 한 줄(이름 없음)을 남기고, 이름을 적으면 또 한 줄(이름 있음)을 남긴다.
 * 규칙이 `update` 를 오너에게도 막아 뒀기 때문에 고칠 수가 없어 한 줄 더 쓰는 것이다.
 * 그 둘을 안 묶으면 한 사람이 「홍길동 · 이름 미등록 1명」으로 **두 번** 세인다 —
 * 에러가 아니라 그냥 숫자가 커진다. 그래서 이 파일이 있다.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'va-')), 'visits-agg.mjs');
execFileSync('npx', ['esbuild', 'src/lib/visits-agg.ts', '--format=esm', '--target=es2022', `--outfile=${out}`],
  { stdio: 'pipe' });
const { groupVisits, kstDay } = await import(out);

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${what}`); }
  else { fail++; console.log(`  ✗ ${what}\n      기대 ${w}\n      실제 ${g}`); }
};

const T = '2026-09-05', Y = '2026-09-04';

console.log('\n① 같은 기기가 하루에 두 줄 — 이름 적기 전/후');
{
  const s = groupVisits([
    { device: 'dev-A', name: '',      day: T },   // 앱이 뜨자마자
    { device: 'dev-A', name: '홍길동', day: T },   // 1.5초 뒤 이름을 적었다
  ], T);
  eq(s.today.people, 1, '한 사람은 한 명으로 센다');
  eq(s.today.names, ['홍길동'], '이름이 있는 줄이 이긴다');
  eq(s.today.anon, 0, '「이름 미등록」으로 또 세지 않는다');
  eq(s.totalPeople, 1, '기간 전체도 1대');
}

console.log('\n② 순서가 뒤집혀 와도 같다 (읽기는 at desc 라 이름 있는 줄이 먼저 온다)');
{
  const s = groupVisits([
    { device: 'dev-A', name: '홍길동', day: T },
    { device: 'dev-A', name: '',      day: T },
  ], T);
  eq(s.today.people, 1, '한 명');
  eq(s.today.names, ['홍길동'], '나중에 온 빈 이름이 덮어쓰지 않는다');
  eq(s.today.anon, 0, '익명 0');
}

console.log('\n③ 진짜 익명은 익명으로 남는다');
{
  const s = groupVisits([
    { device: 'dev-A', name: '홍길동', day: T },
    { device: 'dev-B', name: '',      day: T },
    { device: 'dev-C', name: '',      day: T },
  ], T);
  eq(s.today.people, 3, '3명');
  eq(s.today.names, ['홍길동'], '이름은 하나');
  eq(s.today.anon, 2, '이름 미등록 2');
}

console.log('\n④ 날짜가 갈린다 · 최근이 위 · 이름 가나다순');
{
  const s = groupVisits([
    { device: 'dev-A', name: '김은호', day: T },
    { device: 'dev-B', name: '박철수', day: Y },
    { device: 'dev-A', name: '김은호', day: Y },
    { device: 'dev-C', name: '가나다', day: Y },
  ], T);
  eq(s.days.map(d => d.day), [T, Y], '최근이 위');
  eq(s.days[1].people, 3, '어제 3명');
  eq(s.days[1].names, ['가나다', '김은호', '박철수'], '가나다순');
  eq(s.totalPeople, 3, '기간 전체는 기기 수(중복 없음)');
}

console.log('\n⑤ 오늘 아무도 안 왔으면 0 (undefined 가 아니라)');
{
  const s = groupVisits([{ device: 'dev-A', name: '김은호', day: Y }], T);
  eq(s.today, { day: T, people: 0, names: [], anon: 0 }, '빈 오늘');
}

console.log('\n⑥ 같은 이름을 여러 기기에서 적어도 이름은 한 번만 (사람 수는 기기 수)');
{
  const s = groupVisits([
    { device: 'phone', name: '김은호', day: T },
    { device: 'pc',    name: '김은호', day: T },
  ], T);
  eq(s.today.people, 2, '기기 2대 = 2명으로 센다 (한계로 문서에 적혀 있다)');
  eq(s.today.names, ['김은호'], '이름 목록엔 한 번만');
}

console.log('\n⑦ kstDay — UTC 로 세면 아침에 어제가 나온다');
{
  eq(kstDay(new Date('2026-09-05T00:30:00Z')), '2026-09-05', 'UTC 00:30 = KST 09:30 → 9/5');
  eq(kstDay(new Date('2026-09-04T15:00:00Z')), '2026-09-05', 'UTC 15:00 = KST 자정 → 9/5');
  eq(kstDay(new Date('2026-09-04T14:59:00Z')), '2026-09-04', '1분 전은 9/4');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
