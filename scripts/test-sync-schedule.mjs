/**
 * 수집 일정·「죽었나」 판정 회귀 테스트 — 브라우저 없이 **실제 코드**를 그대로 돌린다.
 *
 * 지키는 것 넷:
 *  ① **밤에는 빨간불이 안 뜬다** — 17시 값이 밤새 묵는 건 정상이다(다음 예정이 아침 8시)
 *  ② **거를 때는 빨갛다** — 아침 것이 안 들어오면 그날 오전에 빨개진다
 *  ③ 크론이 조금 밀려도 안 빨갛다 (깃허브 스케줄은 부하 때 지연된다)
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
  ok(S.syncIsStale(last, kst('2026-09-15T09:35')), '아침 8시 것이 안 왔으면 9시 35분에 빨갛다');
  ok(S.syncIsStale(kst('2026-09-15T08:03'), kst('2026-09-15T12:40')), '11시 것이 안 왔으면 12시 40분에 빨갛다');
  ok(S.syncIsStale(kst('2026-09-13T17:00'), kst('2026-09-15T10:00')), '하루 통째로 죽으면 빨갛다');
}

console.log('\n[3] 크론이 밀려도 안 빨갛다 — 깃허브 스케줄은 부하 때 지연된다');
{
  const last = kst('2026-09-15T08:02');
  ok(!S.syncIsStale(last, kst('2026-09-15T11:00')), '11시 정각(아직 안 돌았을 수 있다) → 초록');
  ok(!S.syncIsStale(last, kst('2026-09-15T12:25')), '11시 것이 85분 밀려도 초록');
  ok(S.syncIsStale(last, kst('2026-09-15T12:35')),  '95분 밀리면 그때는 빨갛다');
  ok(S.SYNC_SLACK_MIN === 90, `여유는 ${S.SYNC_SLACK_MIN}분`);
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
  ok(S.lastDueAt(kst('2026-09-15T09:31')) === kst('2026-09-15T08:00'), '9시 31분 → 오늘 8시');
  ok(S.lastDueAt(kst('2026-09-15T09:29')) === kst('2026-09-14T17:00'), '9시 29분 → 아직 어제 17시');
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
