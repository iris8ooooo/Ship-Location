/**
 * 수집 일정·「죽었나」 판정 회귀 테스트 — 브라우저 없이 **실제 코드**를 그대로 돌린다.
 *
 * 지키는 것 넷:
 *  ① **밤에는 빨간불이 안 뜬다** — 17시 값이 밤새 묵는 건 정상이다(다음 예정이 아침 8시)
 *  ② **거를 때는 빨갛다** — 아침 것이 안 들어오면 그날 오전에 빨개진다
 *  ③ 크론이 밀려도 안 빨갛다 — 허용치는 **실제 실행 이력을 재서** 정했다(실측 최대 4시간 41분)
 *  ④ 앱 상수와 워크플로 크론이 **같은 시각**을 가리킨다 (두 군데가 갈라지면 판정이 거짓말이 된다)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sync-'));
const out = join(dir, 'sync.mjs');
execFileSync('npx', ['esbuild', 'src/lib/sync-schedule.ts', '--bundle', '--format=esm',
  '--target=es2022', `--outfile=${out}`], { stdio: 'pipe' });
const S = await import(out);

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`  ✓ ${what}`); } else { fail++; console.log(`  ✗ ${what}`); } };
/** KST 시각을 ms 로. 러너는 UTC 라 문자열에 +09:00 을 반드시 붙인다. */
const kst = (s) => Date.parse(`${s}+09:00`);

console.log('\n[1] ★밤에는 빨간불이 안 뜬다 — 다음 예정이 아침 8시다');
{
  const last = kst('2026-09-14T17:04');           // 그날 마지막 회차가 정상 수집됨
  for (const t of ['2026-09-14T18:00', '2026-09-14T21:30', '2026-09-14T23:59',
                   '2026-09-15T03:00', '2026-09-15T07:50', '2026-09-15T09:20'])
    ok(!S.syncIsStale(last, kst(t)), `${t} 에도 초록 (17:04 확인, ${Math.round((kst(t)-last)/3600000)}시간 묵음)`);
}

console.log('\n[2] ★거를 때는 빨갛다');
{
  const last = kst('2026-09-14T17:04');
  ok(S.syncIsStale(last, kst('2026-09-15T13:05')), '아침 8시 것이 안 왔으면 13시 5분에 빨갛다');
  ok(S.syncIsStale(kst('2026-09-15T08:03'), kst('2026-09-15T16:05')), '11시 것이 안 왔으면 16시 5분에 빨갛다');
  ok(S.syncIsStale(kst('2026-09-13T17:00'), kst('2026-09-15T10:00')), '하루 통째로 죽으면 빨갛다');
}

console.log('\n[3] ★크론이 밀려도 안 빨갛다 — 허용치는 실제 실행 이력을 재서 정했다');
{
  const last = kst('2026-09-15T08:02');                  // 8시 회차는 정상 수집됨
  ok(!S.syncIsStale(last, kst('2026-09-15T11:00')), '11시 정각(아직 안 돌았을 수 있다) → 초록');

  // ★실측 지연 다섯 건(2026-09-13~14, 이 레포의 실제 실행 이력). 90분짜리 옛 허용치는
  //  이 **다섯 건 전부**에서 「수집이 죽었다」로 빨갛게 떴다 — 멀쩡히 돌고 있는데도.
  //  그래서 허용치가 이 표를 덮어야 한다. 재지 않고 찍은 숫자를 다시 쓰지 않으려는 것이다.
  for (const [min, label] of [[100, '1시간 40분'], [281, '4시간 41분'], [269, '4시간 29분'],
                              [164, '2시간 44분'], [101, '1시간 41분']])
    ok(!S.syncIsStale(last, kst('2026-09-15T11:00') + min * 60000),
       `11시 회차가 ${label} 밀려도 초록 (실측 지연)`);

  // 실측 최대(281분)를 넘어 5시간을 넘기면 그때는 「늦음」이 아니라 「죽음」으로 본다.
  ok(!S.syncIsStale(last, kst('2026-09-15T15:55')), '4시간 55분까지는 초록');
  ok(S.syncIsStale(last, kst('2026-09-15T16:05')),  '5시간 5분 넘으면 빨갛다');
  ok(S.SYNC_SLACK_MIN === 300, `여유는 ${S.SYNC_SLACK_MIN}분 (실측 최대 281분을 덮는다)`);
  ok(S.SYNC_SLACK_MIN > 281, '실측 최대 지연보다 크다 — 정상 운영에서 빨간불이 안 뜬다');
}

console.log('\n[4] ★앱 상수와 워크플로 크론이 같은 시각을 가리키는가');
{
  const yml = readFileSync('.github/workflows/sync-safetyone.yml', 'utf8');
  const m = yml.match(/cron:\s*'0\s+([\d,]+)\s+\*\s+\*\s+\*'/);
  ok(!!m, '크론 한 줄을 읽었다');
  if (m) {
    const cronKst = m[1].split(',').map(Number).map(h => (h + 9) % 24).sort((a, b) => a - b);
    const app = [...S.SYNC_HOURS_KST].sort((a, b) => a - b);
    ok(JSON.stringify(cronKst) === JSON.stringify(app),
       `크론 KST ${cronKst.join('/')} = 앱 ${app.join('/')}`);
  }
  ok(S.SYNC_HOURS_KST.every(h => h >= 8 && h < 18),
     '전부 오전 8시~오후 6시 안이다 (사용자 지시)');
  const gaps = [...S.SYNC_HOURS_KST].sort((a, b) => a - b)
    .map((h, i, a) => i ? h - a[i - 1] : null).filter(Boolean);
  ok(gaps.every(g => g === 3), `업무시간 안 간격이 전부 3시간 (${gaps.join('/')})`);
}

console.log('\n[5] 경계 — lastDueAt 이 가리키는 시각');
{
  ok(S.lastDueAt(kst('2026-09-15T03:00')) === kst('2026-09-14T17:00'), '새벽 3시 → 어제 17시');
  // 경계는 「8시 + 여유 300분」 = 13시다. 여유를 바꾸면 이 줄도 같이 바뀐다 —
  // 숫자를 박지 않고 상수에서 끌어와 계산하면 다음에 여유를 또 바꿔도 이 검사가 따라온다.
  const edge = kst('2026-09-15T08:00') + S.SYNC_SLACK_MIN * 60000;
  ok(S.lastDueAt(edge + 60000) === kst('2026-09-15T08:00'),
     `8시 + 여유(${S.SYNC_SLACK_MIN}분) 직후 → 오늘 8시`);
  ok(S.lastDueAt(edge - 60000) === kst('2026-09-14T17:00'),
     `그 직전까지는 → 아직 어제 17시`);
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
