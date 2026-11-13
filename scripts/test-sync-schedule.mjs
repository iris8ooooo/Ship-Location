/**
 * 수집 일정·「죽었나」 판정 회귀 테스트 — 브라우저 없이 **실제 코드**를 그대로 돌린다.
 *
 * 지키는 것 넷:
 *  ① **밤에는 빨간불이 안 뜬다** — 17시 값이 밤새 묵는 건 정상이다(다음 예정이 아침 8시)
 *  ② **거를 때는 빨갛다** — 아침 것이 안 들어오면 그날 오전에 빨개진다
 *  ③ 크론이 밀려도 안 빨갛다 — 허용치는 **실제 실행 이력을 재서** 정했다(실측 최대 4시간 41분)
 *  ④ 워크플로 크론이 앱 상수의 **모든 회차를 깨운다** (일정의 정본은 앱 상수 하나다)
 *  ⑨ 깨어났을 때 **돌릴지 말지**(`collectDue`) — 회차마다 한 번, 밤에는 안 돈다
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

console.log('\n[4] ★크론이 모든 회차를 깨우는가 — 일정의 정본은 앱 상수 하나다');
{
  // 2026-11-13: 크론을 회차 시각(정각)에 맞춰 네 줄 걸어 뒀더니 하루 두 번만 돌았다.
  // 이제 크론은 **매시간 깨우기만** 하고 돌릴지는 collectDue 가 정한다([9]).
  // 여기서는 그 깨우기가 회차를 하나도 빠뜨리지 않는지, 그리고 게이트를 거치는지를 본다.
  const yml = readFileSync('.github/workflows/sync-safetyone.yml', 'utf8');
  const m = yml.match(/cron:\s*'(\d+)\s+([\d,\-]+)\s+\*\s+\*\s+\*'/);
  ok(!!m, '크론 한 줄을 읽었다');
  if (m) {
    const minute = Number(m[1]);
    const wakeKst = m[2].split(',').flatMap(part => {
      const [a, b] = part.split('-').map(Number);
      return b == null ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
    }).map(h => (h + 9) % 24).sort((a, b) => a - b);
    ok(minute !== 0, `정각을 피한다 (:${String(minute).padStart(2, '0')}) — 깃허브 스케줄은 매시 정각이 가장 붐빈다`);
    for (const h of S.SYNC_HOURS_KST)
      ok(wakeKst.includes(h), `${h}시 회차를 그 시(時) 안에 깨운다 (${h}:${String(minute).padStart(2, '0')})`);
    // 밀린 회차를 받을 깨우기가 여유 안에 더 있어야 한다 — 딱 한 번만 깨우면 그게 밀리는 순간 끝이다.
    for (const h of S.SYNC_HOURS_KST) {
      const n = wakeKst.filter(w => w >= h && (w - h) * 60 + minute < S.SYNC_SLACK_MIN).length;
      ok(n >= 3, `${h}시 회차를 메울 깨우기가 여유 안에 ${n}번`);
    }
  }
  // ★긁는 단계가 게이트의 답을 봐야 한다. 이게 빠지면 **깨울 때마다 긁어** 하루 16번이 된다.
  ok(yml.includes('node scripts/sync-gate.mjs'), '깨어나면 게이트에 묻는다 (sync-gate.mjs)');
  const scrape = yml.slice(yml.indexOf('- name: Scrape SafetyOne list'));
  ok(/^\s*if:\s*steps\.gate\.outputs\.due == 'true'\s*$/m.test(scrape.slice(0, 160)),
     '긁는 단계는 게이트가 「돌려라」 할 때만 돈다');
  const gate = readFileSync('scripts/sync-gate.mjs', 'utf8');
  ok(/collectDue\(/.test(gate) && /sync-schedule\.ts/.test(gate),
     '게이트는 일정을 따로 갖지 않는다 — 앱과 같은 파일(sync-schedule.ts)에 묻는다');
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

console.log('\n[6] ★수집이 죽으면 앱이 **왜 죽었는지** 말한다 (2026-09-20 사고)');
{
  // 실제로 일어난 일: 9/16 10:12 성공을 마지막으로 비번이 바뀌어 15회 연속 실패.
  const ok916 = kst('2026-09-16T10:12');
  const fail920 = kst('2026-09-20T07:50');   // 사장님이 버튼을 눌렀다가 실패한 그 시각

  ok(S.syncIsBroken(ok916, fail920), '실패가 성공보다 새로우면 → 깨진 것');
  ok(!S.syncIsBroken(fail920, ok916), '성공이 더 새로우면 → 되살아난 것 (빨갛게 두지 않는다)');
  ok(S.syncIsBroken(null, fail920), '성공 기록이 아예 없고 실패만 있어도 → 깨진 것');
  ok(!S.syncIsBroken(ok916, null), '실패 기록이 없으면 → 안 깨진 것');
  ok(!S.syncIsBroken(null, null), '아무 기록도 없으면 → 안 깨진 것 (칩을 숨긴다)');

  ok(S.syncFailLabel('login') === '로그인 안 됨', `login → ${S.syncFailLabel('login')}`);
  ok(S.syncFailLabel('connect') === '접속 안 됨', `connect → ${S.syncFailLabel('connect')}`);
  ok(S.syncFailLabel('parse') === '화면이 바뀜', `parse → ${S.syncFailLabel('parse')}`);
  ok(S.syncFailLabel('처음보는코드') === '원인 미상', '모르는 코드가 와도 화면이 비지 않는다');
  ok(S.syncFailLabel(undefined) === '원인 미상', '코드가 없어도 화면이 비지 않는다');

  // ★옛 동작과의 차이 — 이게 나흘 반을 날린 그 구분이다.
  //  옛 신호(syncIsStale)는 「오래됐다」까지만 말할 수 있고 **왜인지는 모른다.**
  const now = kst('2026-09-20T12:00');
  ok(S.syncIsStale(ok916, now), '옛 신호: 「오래됐다」는 말할 수 있다');
  ok(S.syncIsBroken(ok916, fail920), '새 신호: 「죽었다」까지 말한다 — 둘은 다른 질문이다');
}

console.log('\n[7] ★실패 기록에 **사유 문자열을 싣지 않는다** — meta/safetyone 은 공개 읽기다');
{
  const src = readFileSync('scripts/scrape-safetyone.mjs', 'utf8');
  // 앱으로 나가는 파일에는 코드만 담는다. reason 은 `접속 불가: ${e.message}` 처럼
  // **사내 주소를 품는다** — 그게 공개 문서로 나가면 그 순간 유출이다.
  const m = src.match(/fail\.json[^\n]*JSON\.stringify\(([^)]*)\)/);
  ok(!!m, 'fail.json 을 쓰는 줄을 찾았다');
  if (m) {
    ok(/\{\s*code\s*\}/.test(m[1]), `담는 것은 code 뿐 (${m[1].trim()})`);
    ok(!/reason|message|url|URL/.test(m[1]), '사유·주소를 같이 싣지 않는다');
  }
  // 워크플로도 같은 약속을 지켜야 한다 — 거기서 reason 을 읽어 쓰면 소용없다.
  const yml = readFileSync('.github/workflows/sync-safetyone.yml', 'utf8');
  const block = yml.slice(yml.indexOf('Tell the app the sync failed'));
  ok(block.includes('failCode') && !/reason/.test(block.slice(0, 1600)),
     '워크플로도 코드만 쓴다 (failCode · reason 안 씀)');
  ok(/merge:\s*true/.test(block.slice(0, 1600)),
     'merge 로 쓴다 — lastSuccess 를 지우지 않는다');
}

console.log('\n[8] ★기다림을 끝내는 숫자 == 실패를 판정하는 숫자 (2026-09-21 run 126)');
{
  // run 126 은 `/gis/ships` 가 오기 전에 포기했다. 화면에 호선+선석을 가진 요소가 **딱 하나**
  // 있었는데, 기다림을 끝내는 조건이 「행이 하나라도」였기 때문이다. 실패 판정은 「5척 이상」.
  // 두 숫자가 어긋나면 기다림이 **반드시 실패할 상태에서 끝난다** — 그게 이 검사가 막는 것이다.
  const src = readFileSync('scripts/scrape-safetyone.mjs', 'utf8');

  const decl = src.match(/^const MIN_ROWS = (\d+);/m);
  ok(!!decl, `문턱이 상수 한 곳에 있다 (MIN_ROWS = ${decl?.[1]})`);

  // ① 기다림을 끝내는 조건이 그 상수를 쓴다. 「하나라도 있으면 참」이면 안 된다.
  const wait = src.match(/async function enoughRows\(\)[\s\S]*?\n}/);
  ok(!!wait, '기다림 판정 함수(enoughRows)가 있다');
  if (wait) {
    ok(/>=\s*MIN_ROWS/.test(wait[0]), '기다림을 MIN_ROWS 로 끝낸다');
    ok(!/\)\.length\)\s*return true/.test(wait[0]),
       '「행이 하나라도 있으면 참」으로 끝내지 않는다');
  }

  // ② 야드 행 수로 갈리는 자리가 **전부** 그 상수를 쓴다. 하나라도 숫자를 박으면 다시 갈라진다.
  //    ★상수 선언 뒤쪽만 본다 — 그 앞의 `rows.length < 3` 은 응답이 **API 후보인가**를
  //     보는 다른 숫자라 같이 묶으면 안 된다(다른 질문에 같은 문턱을 강요하게 된다).
  const tail = src.slice(src.indexOf('const MIN_ROWS'));
  const bare = [...tail.matchAll(/rows\.length\s*<\s*(\w+)/g)].map(m => m[1]);
  ok(bare.length >= 2, `야드 행 수로 갈리는 자리 ${bare.length}곳을 찾았다`);
  // ★비어 있으면 every() 가 **공짜로 통과**한다. 못 찾은 것을 「전부 맞다」로 읽지 않는다.
  ok(bare.length >= 2 && bare.every(v => v === 'MIN_ROWS'), `전부 MIN_ROWS 다 (${bare.join(', ')})`);

  // ③ 못 읽었다는 기록에 **얼마나 기다렸는지**가 같이 있어야 한다. run 126 의 로그에는
  //    「1개밖에 못 읽었다」만 있어서, 25초 중 5초만 쓰고 포기한 사실이 어디에도 없었다.
  const bailCall = src.match(/await bail\(`행을[\s\S]{0,300}?'parse'\)/);
  ok(!!bailCall && /waited/.test(bailCall[0]), '실패 사유에 기다린 시간이 들어간다');
  // ★단 그 사유는 **로그·아티팩트까지만** 간다. 앱으로 나가는 건 여전히 code 뿐이다([7]).
  ok(/'parse'\)/.test(bailCall?.[0] ?? ''), '앱에는 여전히 코드만 넘긴다 (parse)');
}

console.log('\n[9] ★깨어났을 때 돌릴지 말지 — 회차마다 한 번, 밤에는 안 돈다 (2026-11-13)');
{
  /** 깨어난 시각들을 차례로 먹여, 실제로 수집한 시각을 돌려준다(수집은 1분 걸린다고 친다). */
  const run = (last, wakes) => {
    const ran = [];
    for (const w of wakes) if (S.collectDue(last, kst(w))) { ran.push(w.slice(11)); last = kst(w) + 60000; }
    return { ran, last };
  };
  const hourly = (day) => Array.from({ length: 16 }, (_, i) => `${day}T${String(6 + i).padStart(2, '0')}:13`);
  const yesterday = kst('2026-11-12T17:14');

  // ① 깃허브가 제때 깨워 주면: 사용자가 정한 그대로 하루 네 번.
  const onTime = run(yesterday, hourly('2026-11-13'));
  ok(JSON.stringify(onTime.ran) === JSON.stringify(['08:13', '11:13', '14:13', '17:13']),
     `제때 깨우면 하루 네 번 — ${onTime.ran.join(' ')}`);

  // ② ★실제로 일어난 일. 11/13 에 깃허브가 깨운 것은 12:19 와 21:56 두 번뿐이었다(크론 넷 중 둘은 버려짐).
  //    깨우기를 매시간으로 늘리면 그중 몇 개가 밀리고 버려져도 회차가 채워진다.
  const delayed = run(yesterday, ['2026-11-13T10:55', '2026-11-13T12:19', '2026-11-13T15:30', '2026-11-13T21:56']);
  ok(delayed.ran.length === 4, `들쭉날쭉 깨워도 회차 넷이 다 채워진다 — ${delayed.ran.join(' ')}`);

  // ③ 채워진 회차는 다시 안 부른다 — 자주 깨우는 것이지 자주 긁는 것이 아니다.
  ok(!S.collectDue(kst('2026-11-13T08:14'), kst('2026-11-13T09:13')), '8시 회차를 채웠으면 9시 13분에는 건너뛴다');
  ok(!S.collectDue(kst('2026-11-13T08:14'), kst('2026-11-13T10:59')), '10시 59분에도 건너뛴다');
  ok(S.collectDue(kst('2026-11-13T08:14'), kst('2026-11-13T11:00')),  '11시 정각부터는 다음 회차다');
  const burst = run(yesterday, ['08:01', '08:02', '08:20', '08:59'].map(t => `2026-11-13T${t}`));
  ok(burst.ran.length === 1, `한 회차 안에 몇 번을 깨워도 수집은 한 번 (${burst.ran.join(' ')})`);

  // ④ 밤에는 안 돈다. 17시 회차는 여유(앱이 빨갛게 띄우는 그 시각) 전까지만 메운다.
  const missed17 = kst('2026-11-13T14:14');
  ok(S.collectDue(missed17, kst('2026-11-13T21:13')), '17시 회차가 밀리면 21시 13분에도 메운다');
  ok(!S.collectDue(missed17, kst('2026-11-13T22:00')), '22시(17시 + 여유)가 되면 그 회차는 버린다');
  for (const t of ['2026-11-13T23:13', '2026-11-14T03:00', '2026-11-14T06:13', '2026-11-14T07:59'])
    ok(!S.collectDue(missed17, kst(t)), `${t.slice(5)} 에 깨어나도 안 돈다 (다음 회차는 아침 8시)`);
  ok(S.collectDue(missed17, kst('2026-11-14T08:00')), '아침 8시부터 다시 돈다');

  // ⑤ 심장박동이 아예 없어도 업무시간에 깨어나면 돈다(첫 실행).
  ok(S.collectDue(null, kst('2026-11-13T08:13')), '기록이 없으면 돈다');
  ok(!S.collectDue(null, kst('2026-11-13T03:00')), '그래도 밤에는 안 돈다');

  // ⑥ ★게이트와 앱 칩이 **같은 판단**을 한다. 깨우기가 매번 실측 최악(4시간 41분)보다 나쁘게
  //    4시간 55분씩 밀려도, 게이트를 따랐으면 앱은 빨갛게 뜨지 않아야 한다.
  //    두 판단이 서로 다른 숫자를 쓰기 시작하면 여기서 갈라진다.
  {
    const DELAY = 295 * 60000, events = [];
    for (let d = 13; d <= 19; d++) {
      for (const w of hourly(`2026-11-${d}`)) events.push({ t: kst(w) + DELAY, wake: true });
      for (let m = 0; m < 24 * 60; m += 10) events.push({ t: kst(`2026-11-${d}T00:00`) + m * 60000, wake: false });
    }
    events.sort((a, b) => a.t - b.t);
    let last = yesterday, red = 0, runs = 0;
    for (const e of events) {
      if (e.wake) { if (S.collectDue(last, e.t)) { last = e.t + 60000; runs++; } }
      else if (S.syncIsStale(last, e.t)) red++;
    }
    ok(red === 0, `깨우기가 전부 4시간 55분씩 밀려도 일주일 동안 앱에 빨간불 ${red}번`);
    ok(runs <= 7 * S.SYNC_HOURS_KST.length, `그 일주일 수집 ${runs}번 — 하루 ${S.SYNC_HOURS_KST.length}번을 넘지 않는다`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
