/**
 * 세이프티원에 로그인해 3중점검 리스트를 긁어 JSON 으로 저장한다.
 * 깃허브 액션(sync-safetyone.yml)이 시간마다 돌린다.
 *
 *   SAFETYONE_URL=... SAFETYONE_ID=... SAFETYONE_PW=... \
 *     node scripts/scrape-safetyone.mjs --out out/safetyone-list.json
 *
 * 사이트 구조를 모른 채 짠 방어적 스크레이퍼다:
 *  - 로그인: 비밀번호 입력칸을 찾고, 그 앞의 텍스트 입력칸을 아이디로 본다.
 *  - 3중점검: 그 글자가 보이면 눌러 본다(이미 그 화면이면 그냥 진행).
 *  - 리스트: "리스트" 글자가 보이면 눌러 펼친다.
 *  - 추출: 행 단위로 8xxx 호선번호 + 선석 이름이 같이 있는 줄을 잡는다
 *    (docs/safetyone-capture.js, src/lib/safetyone-match.mjs 와 같은 기준).
 *
 * ★실패하면 out/ 에 page.html 과 shot.png 을 남기고 1 로 죽는다.
 *   액션이 그걸 아티팩트로 올리므로, 다음 세션이 사용자 없이
 *   실제 화면을 보고 셀렉터를 고칠 수 있다 — 사이트 개편은 예정된 일이다.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const outPath = process.argv[process.argv.indexOf('--out') + 1] || 'out/safetyone-list.json';
const { SAFETYONE_URL, SAFETYONE_ID, SAFETYONE_PW } = process.env;
if (!SAFETYONE_URL || !SAFETYONE_ID || !SAFETYONE_PW) {
  console.error('SAFETYONE_URL / SAFETYONE_ID / SAFETYONE_PW 환경변수가 필요하다.');
  process.exit(2);
}
mkdirSync(dirname(outPath), { recursive: true });

// PW_EXECUTABLE_PATH: 로컬 테스트에서 미리 설치된 크롬을 쓸 때만. 액션에선 비워 둔다.
const browser = await chromium.launch(
  process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

/** 죽기 전에 현장 보존 — 다음 세션이 이걸 보고 고친다. */
async function bail(reason) {
  console.error(`실패: ${reason}`);
  try {
    writeFileSync(`${dirname(outPath)}/page.html`, await page.content());
    await page.screenshot({ path: `${dirname(outPath)}/shot.png`, fullPage: true });
    console.error(`현장 보존: ${dirname(outPath)}/page.html, shot.png`);
  } catch { /* 보존도 실패 — 어쩔 수 없다 */ }
  await browser.close();
  process.exit(1);
}

try {
  await page.goto(SAFETYONE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
} catch (e) { await bail(`접속 불가: ${e.message}`); }
await page.waitForTimeout(2500);

// ── 로그인 ────────────────────────────────────────────────────────────────
const pw = page.locator('input[type="password"]').first();
if (await pw.count()) {
  // 비밀번호 칸 앞의 보이는 텍스트/아이디 칸이 아이디다.
  const id = page.locator(
    'input[type="text"]:visible, input[type="email"]:visible, input:not([type]):visible'
  ).first();
  if (!(await id.count())) await bail('로그인: 아이디 입력칸을 못 찾았다');
  await id.fill(SAFETYONE_ID);
  await pw.fill(SAFETYONE_PW);
  // 로그인 버튼 후보 → 없으면 엔터.
  const btn = page.locator(
    'button:has-text("로그인"), input[type="submit"], button[type="submit"]'
  ).first();
  if (await btn.count()) await btn.click(); else await pw.press('Enter');
  await page.waitForTimeout(4000);
  if (await page.locator('input[type="password"]').count()) {
    await bail('로그인이 안 됐다 — 비밀번호 칸이 그대로 있다 (비번 오류거나 추가 인증)');
  }
  console.log('로그인 성공');
} else {
  console.log('로그인 화면이 아니다 — 세션이 살아 있거나 바로 본화면');
}

// ── 3중점검 화면으로 ──────────────────────────────────────────────────────
for (const label of ['3중점검', '리스트']) {
  const el = page.locator(`text=${label}`).first();
  if (await el.count()) {
    await el.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
}

// ── 리스트 추출 (관대한 기준 — capture.js 와 동일) ─────────────────────────
const rows = await page.evaluate(() => {
  const BERTH = /(1도크|2도크|1안벽|2안벽|1돌핀|2돌핀|플로팅|1BERTH|시운전|출항|해상)/;
  const out = [];
  const seen = new Set();
  for (const tr of document.querySelectorAll('tr, [role="row"], li')) {
    const t = (tr.innerText || '').replace(/\n/g, ' ').trim();
    const hull = t.match(/\b(8\d{3})\b/);
    const berth = t.match(BERTH);
    if (hull && berth && !seen.has(hull[1])) {
      seen.add(hull[1]);
      // 행을 통째로 담으면 상태·날짜 칸까지 붙는다. 선석 이름이 든 칸만 위치로.
      const raw = (tr.innerText || '');
      const cell = raw.split(/[\t\n]/).map(c => c.trim()).find(c => BERTH.test(c) && !/^8\d{3}$/.test(c));
      out.push({ hull: hull[1], loc: (cell ?? t.slice(hull.index + 4)).trim().slice(0, 120) });
    }
  }
  return out;
});

// 야드엔 보통 20척 이상 있다. 몇 척 안 잡혔으면 리스트가 안 펼쳐진 것이다.
if (rows.length < 5) await bail(`행을 ${rows.length}개밖에 못 읽었다 — 리스트가 안 펼쳐졌거나 화면 구조가 바뀌었다`);

writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), rows }, null, 1));
console.log(`호선 ${rows.length}척 수집 → ${outPath}`);
await browser.close();
process.exit(0);
