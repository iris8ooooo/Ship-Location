/**
 * 크론이 깨울 때마다 「지금 수집을 돌려야 하나」를 정한다 → `$GITHUB_OUTPUT` 에 `due=true|false`.
 *
 *   node scripts/sync-gate.mjs
 *
 * 판단은 `src/lib/sync-schedule.ts` 의 `collectDue` 가 한다 — 앱이 「수집이 죽었나」를 재는
 * 그 파일이다. 일정을 아는 곳이 둘이면 반드시 갈라진다. 여기는 **마지막 수집 시각을 읽어
 * 그 함수에 묻는 것**뿐이다.
 *
 * ★사람이 손으로 돌렸으면 묻지 않고 돈다. 일부러 눌렀는데 「아직 때가 아니다」로 건너뛰고
 *  초록불이 뜨면 그게 이 레포가 적어 둔 거짓말이다.
 * ★마지막 수집 시각을 못 읽으면 **돈다**(fail open). 한 번 더 긁는 것과 수집이 조용히
 *  멈추는 것 중에 나쁜 쪽은 뒤쪽이다.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const say = (due, why) => {
  console.log(`${due ? '수집한다' : '건너뛴다'} — ${why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `due=${due}\n`);
  if (process.env.GITHUB_STEP_SUMMARY && !due)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 이번에는 수집하지 않았다\n\n${why}\n`);
  process.exit(0);
};

if (process.env.GITHUB_EVENT_NAME !== 'schedule') say(true, '사람이 돌렸다');

const out = join(mkdtempSync(join(tmpdir(), 'gate-')), 'sync.mjs');
execFileSync('npx', ['esbuild', 'src/lib/sync-schedule.ts', '--bundle', '--format=esm',
  '--target=es2022', `--outfile=${out}`], { stdio: 'pipe' });
const { collectDue } = await import(out);

const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
let last = null;
try {
  const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
  // 문서 단건 읽기는 공개다(앱이 로그인 없이 읽는 그 문서).
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/` +
    `${cfg.firestoreDatabaseId}/documents/meta/safetyone?key=${cfg.apiKey}`, { signal: AbortSignal.timeout(15000) });
  if (r.status !== 404) {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const f = (await r.json())?.fields?.lastSuccess;
    const n = Number(f?.integerValue ?? f?.doubleValue);
    if (!Number.isFinite(n)) throw new Error('lastSuccess 가 숫자가 아니다');
    last = n;
  }
} catch (e) {
  say(true, `마지막 수집 시각을 못 읽었다(${e?.message ?? e}) — 모르면 돈다`);
}

const now = Date.now();
say(collectDue(last, now),
  `지금 ${kst(now)} · 마지막 수집 ${last == null ? '없음' : kst(last)} (KST)`);
