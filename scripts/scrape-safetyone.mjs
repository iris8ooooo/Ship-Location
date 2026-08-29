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
 * ★실패하면 out/skeleton.json 을 남기고 1 로 죽는다. 다음 세션이 사용자 없이
 *   셀렉터를 고칠 수 있게 하는 것이 목적이다 — 사이트 개편은 예정된 일이다.
 *
 *   ★단 **글자는 절대 담지 않는다.** 이 레포는 공개고 액션 아티팩트도 공개로
 *   내려받힌다. 사내 시스템의 화면·HTML 을 그대로 올리면 그게 곧 유출이다.
 *   그래서 담는 건 구조뿐이다: 태그·id·class·속성 이름·자식 수·글자 "길이",
 *   그리고 호선번호/선석 정규식이 **몇 개** 맞았는지. 셀렉터를 고치기엔 충분하고
 *   내용은 새어 나가지 않는다.
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

// ── 스스로 진단하기 ───────────────────────────────────────────────────────
// 5번 고쳐도 리스트를 못 읽었다. 추측을 멈추고 **어디서 데이터가 오는지**를 기록한다.
// SPA 가 JSON API 를 부르고 있다면 DOM 을 긁을 게 아니라 그 API 를 부르는 게 맞다.
// 기록하는 건 구조뿐이다: 메서드·경로(쿼리 제외)·상태·바이트수, 그리고 응답 안에
// 호선번호/선석이 **몇 개** 들어 있는지. 내용은 담지 않는다(공개 로그).
const BERTH_G = /(1도크|2도크|1안벽|2안벽|1돌핀|2돌핀|플로팅|1BERTH|시운전|출항|해상)/g;
/**
 * ★선석 값은 **선석 이름으로 시작**해야 한다 (2026-08-29, 두 번째 오독).
 *  "포함" 으로 봤더니 작업내용 필드 `E/ROOM  전장 시운전 - GENERAL WORKS` 가
 *  안에 든 "시운전" 때문에 선석으로 잡혔다. 값이 배마다 달라서 "갈리는 정도" 규칙도 통과했다.
 *  실제 위치 문자열은 `2도크 > TANK > 1TANK2` 처럼 항상 선석으로 시작한다(CLAUDE.md).
 */
const BERTH_RE = /^\s*(1도크|2도크|1안벽|2안벽|1돌핀|2돌핀|플로팅|1BERTH|시운전|출항|해상)(\s|>|$)/;
const HULL_RE = /^8\d{3}$/;

/**
 * JSON 아무 데서나 "호선번호처럼 생긴 값" 과 "선석처럼 생긴 값" 을 함께 가진 객체를 행으로 본다.
 * 필드 이름을 모르고도 읽으려는 것이다 — 사내 API 의 필드명은 알 수 없고 바뀔 수도 있다.
 *
 * ★선석 필드는 "모양이 맞는 첫 필드" 로 고르면 안 된다 (2026-08-29 사고).
 *  그렇게 했더니 레코드마다 똑같이 들어 있는 다른 필드를 집어 **14척 전부 "1안벽"** 이 됐고,
 *  그대로 프로덕션에 써서 배 8척을 엉뚱한 데로 옮겼다.
 *  선석은 배마다 달라야 한다 — 그래서 **레코드 사이에서 값이 가장 많이 갈리는 필드**를 고른다.
 *  모든 레코드에서 같은 값인 필드는 정의상 그 배의 위치가 아니다.
 */
function rowsFromJson(node) {
  // 1. 호선번호를 가진 레코드를 모으고, 선석꼴 값은 **필드 이름별로** 따로 담는다.
  const recs = [];
  (function walk(n) {
    if (Array.isArray(n)) { for (const v of n) walk(v); return; }
    if (!n || typeof n !== 'object') return;
    let hull = null;
    const cand = {};
    for (const [k, v] of Object.entries(n)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const t = String(v).trim();
      if (!hull && HULL_RE.test(t)) hull = t;
      if (BERTH_RE.test(t)) cand[k] = t.slice(0, 120);
    }
    if (hull && Object.keys(cand).length) recs.push({ hull, cand });
    for (const v of Object.values(n)) walk(v);
  })(node);
  if (!recs.length) return [];

  // 2. 필드마다 "값이 몇 가지로 갈리는지" 를 센다. 가장 많이 갈리는 필드가 선석이다.
  const spread = new Map();
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.cand)) {
      if (!spread.has(k)) spread.set(k, new Set());
      spread.get(k).add(v);
    }
  }
  const best = [...spread.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  if (!best) return [];
  const [key, values] = best;
  // 3. 그래도 한 가지 값뿐이면 그건 선석이 아니다. 읽지 못한 것으로 본다.
  if (values.size < 2) return [];

  const out = [];
  const seen = new Set();
  for (const r of recs) {
    const loc = r.cand[key];
    if (!loc || seen.has(r.hull)) continue;
    seen.add(r.hull);
    out.push({ hull: r.hull, loc });
  }
  return out;
}

/**
 * 응답의 **스키마만** 뽑는다 — 필드 이름, 나온 횟수, 값이 몇 가지로 갈리는지,
 * 그리고 선석꼴로 시작하는 값이 몇 개인지. **값 자체는 담지 않는다**(공개 로그).
 * 어느 필드가 선석인지 눈으로 확정하려는 것이다 — 더는 추측하지 않는다.
 */
function fieldShape(node) {
  const stat = new Map();
  (function walk(n) {
    if (Array.isArray(n)) { for (const v of n) walk(v); return; }
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'string' || typeof v === 'number') {
        if (!stat.has(k)) stat.set(k, { n: 0, vals: new Set(), berth: 0, hull: 0 });
        const t = stat.get(k), sv = String(v).trim();
        t.n++; if (t.vals.size < 200) t.vals.add(sv);
        if (BERTH_RE.test(sv)) t.berth++;
        if (HULL_RE.test(sv)) t.hull++;
      } else walk(v);
    }
  })(node);
  return [...stat.entries()]
    .map(([k, t]) => ({ 필드: k, 나온횟수: t.n, 값종류: t.vals.size, 선석꼴: t.berth, 호선번호꼴: t.hull }))
    .filter(f => f.선석꼴 || f.호선번호꼴 || f.값종류 > 1)
    .sort((a, b) => b.선석꼴 - a.선석꼴 || b.호선번호꼴 - a.호선번호꼴)
    .slice(0, 25);
}

const netlog = [];
const trace = [];
/**
 * ★데이터는 DOM 이 아니라 API 에 있다 (2026-08-29 실측).
 *  지도는 <canvas> 라 호선번호가 픽셀로 그려져 DOM 에 없다 — 아무리 긁어도 안 나온다.
 *  대신 화면이 부르는 JSON 에 다 들어 있다. 경로를 코드에 박지 않고,
 *  **앱이 실제로 보낸 응답**에서 행이 읽히면 그걸 쓴다. 경로·파라미터가 바뀌어도 따라간다.
 */
const apiCands = [];
page.on('response', async (res) => {
  const req = res.request();
  if (!['xhr', 'fetch'].includes(req.resourceType())) return;
  let u; try { u = new URL(res.url()); } catch { return; }
  const rec = { method: req.method(), path: u.origin + u.pathname, status: res.status() };
  try {
    const body = await res.text();
    rec.bytes = body.length;
    rec.호선번호수 = (body.match(/(^|[^0-9])8\d{3}([^0-9]|$)/g) || []).length;
    rec.선석수 = (body.match(BERTH_G) || []).length;
    if (rec.호선번호수 >= 3 && rec.선석수 >= 3) {
      let json = null;
      try { json = JSON.parse(body); } catch { /* JSON 이 아니면 후보 아님 */ }
      if (json) {
        const rows = rowsFromJson(json);
        if (rows.length >= 3) {
          // 한 배에 한 줄인 응답을 고른다. 점검 이력처럼 호선당 수십 줄인 응답은
          // 같은 호선이 여러 번 나와 "호선번호수/행수" 가 크다 — 그건 위치 원본이 아니다.
          apiCands.push({ path: rec.path, rows, 반복도: rec.호선번호수 / rows.length, 필드: fieldShape(json) });
          rec.읽힌행 = rows.length;
        }
      }
    }
  } catch { rec.bytes = -1; }
  netlog.push(rec);
});

/**
 * 죽기 전에 화면 "구조" 만 남긴다 — 글자는 담지 않는다(공개 로그·아티팩트라서).
 * 다음 세션이 이 뼈대를 보고 셀렉터를 고친다.
 *
 * iframe 안에 든 경우가 흔해서 **프레임을 전부** 훑는다. 행 후보는 "같은 class 조합이
 * 여러 번 반복되는 요소" 로 찾는다 — 표가 <table> 이 아니라 div 그리드인 경우가 많다.
 * 버튼 이름은 **미리 정한 낱말과 맞는지만** 본다(맞음/아님). 내용을 옮기지 않으려는 것이다.
 */
const NAV_WORDS = ['3중점검', '삼중점검', '리스트', '목록', '조회', '검색', '전체', '더보기', '펼치기'];

async function skeletonOf(frame) {
  return frame.evaluate((navWords) => {
    const HULL = /\b8\d{3}\b/;
    const BERTH = /(1도크|2도크|1안벽|2안벽|1돌핀|2돌핀|플로팅|1BERTH|시운전|출항|해상)/;
    const clsOf = (el) => (typeof el.className === 'string')
      ? el.className.split(/\s+/).filter(Boolean).slice(0, 4).join('.') : '';
    const count = (sel) => document.querySelectorAll(sel).length;

    // 행처럼 생긴 것: 같은 class 조합이 5번 이상 반복되고, 형제끼리 나란한 요소.
    const sig = new Map();
    for (const el of document.querySelectorAll('div, li, tr, [role="row"]')) {
      const key = `${el.tagName}.${clsOf(el)}`;
      if (!sig.has(key)) sig.set(key, { key, n: 0, hull: 0, berth: 0, both: 0, textLen: 0 });
      const v = sig.get(key);
      v.n++;
      const t = el.innerText || '';
      if (HULL.test(t)) v.hull++;
      if (BERTH.test(t)) v.berth++;
      if (HULL.test(t) && BERTH.test(t)) v.both++;
      v.textLen = Math.max(v.textLen, t.trim().length);
    }
    const repeated = [...sig.values()].filter(v => v.n >= 5)
      .sort((a, b) => (b.both - a.both) || (b.hull - a.hull) || (b.n - a.n)).slice(0, 12);

    // 눌러야 열리는 것들: 이름이 미리 정한 낱말과 맞는지만 본다.
    const clickable = [];
    for (const el of document.querySelectorAll('button, a, [role="tab"], [role="button"], input[type="button"], input[type="submit"]')) {
      const t = (el.innerText || el.value || '').trim();
      const hit = navWords.filter(w => t.includes(w));
      if (hit.length) clickable.push({ tag: el.tagName, cls: clsOf(el), role: el.getAttribute('role') || undefined, 낱말: hit });
    }
    return {
      url: location.origin + location.pathname,
      charset: document.characterSet,
      counts: {
        form: count('form'), input: count('input'), button: count('button'),
        table: count('table'), tr: count('tr'), roleRow: count('[role="row"]'),
        li: count('li'), canvas: count('canvas'), iframe: count('iframe'),
        div: count('div'),
      },
      전체매칭: (() => {
        let hull = 0, berth = 0, both = 0;
        for (const el of document.querySelectorAll('tr, [role="row"], li, div')) {
          const t = el.innerText || '';
          const h = HULL.test(t), b = BERTH.test(t);
          if (h) hull++; if (b) berth++; if (h && b) both++;
        }
        return { 호선번호꼴: hull, 선석꼴: berth, 둘다: both };
      })(),
      행후보: repeated,
      눌러볼것: clickable.slice(0, 20),
    };
  }, NAV_WORDS);
}

async function bail(reason) {
  console.error(`실패: ${reason}`);
  try {
    const frames = [];
    for (const f of page.frames()) {
      try { frames.push(await skeletonOf(f)); }
      catch (e) { frames.push({ url: '(접근 불가)', error: String(e).slice(0, 120) }); }
    }
    const dump = {
      reason,
      눌러본것: trace,
      // ★여기가 핵심 단서다. 호선번호수·선석수가 큰 응답이 있으면 그게 데이터 API 다.
      //  그러면 DOM 을 긁을 게 아니라 그 경로를 직접 부르면 된다.
      주고받은JSON: netlog.filter(r => r.bytes !== 0).slice(-25),
      frameCount: page.frames().length,
      frames,
    };
    writeFileSync(`${dirname(outPath)}/skeleton.json`, JSON.stringify(dump, null, 1));
    // ★로그에도 그대로 찍는다. 글자가 없으니 공개돼도 안전하고, 아티팩트를 내려받지
    //  못하는 환경(원격 세션)에서도 다음 세션이 바로 읽고 고칠 수 있다.
    console.error('----- 화면 구조 (글자 없음) -----');
    console.error(JSON.stringify(dump, null, 1));
    console.error('----- 끝 -----');
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

// ── 리스트 추출 ──────────────────────────────────────────────────────────
// 프레임을 전부 훑는다 — 사내 시스템은 본문을 iframe 에 담는 경우가 흔하다.
// 행은 tr/li 만이 아니라 **div 그리드**일 수도 있어 div 까지 후보로 본다.
// 대신 조상까지 잡히면 표 전체가 한 행이 되므로 "가장 안쪽" 만 남긴다.
async function rowsFrom(frame) {
  return frame.evaluate(() => {
    const BERTH = /(1도크|2도크|1안벽|2안벽|1돌핀|2돌핀|플로팅|1BERTH|시운전|출항|해상)/;
    const HULL = /(^|[^0-9])(8\d{3})([^0-9]|$)/;
    // ★innerText 를 쓰면 안 된다. 칸이 <span> 같은 inline 이면 글자를 그대로 붙여
    //  "83002도크" 가 되고, 그러면 호선번호 경계가 깨져 한 척도 못 잡는다(실측).
    //  그래서 글자 노드를 칸으로 모아 탭으로 잇는다 — 표든 div 그리드든 같게 읽힌다.
    const cellsOf = (el) => {
      const parts = [];
      (function walk(n) {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) parts.push(t); }
          else if (c.nodeType === 1) walk(c);
        }
      })(el);
      return parts;
    };
    const textOf = (el) => cellsOf(el).join('\t');
    const hits = (el) => { const t = textOf(el); return HULL.test(t) && BERTH.test(t); };
    const inner = [...document.querySelectorAll('tr, [role="row"], li, div')]
      .filter(hits)
      .filter(el => ![...el.querySelectorAll('*')].some(hits));   // 가장 안쪽만
    const out = [];
    const seen = new Set();
    for (const el of inner) {
      const cells = cellsOf(el);
      const hull = textOf(el).match(HULL);
      if (!hull || seen.has(hull[2])) continue;
      seen.add(hull[2]);
      // 행을 통째로 담으면 상태·날짜 칸까지 붙는다. 선석 이름이 든 칸만 위치로.
      const cell = cells.find(c => BERTH.test(c) && !/^8\d{3}$/.test(c));
      out.push({ hull: hull[2], loc: (cell ?? cells.join(' ')).trim().slice(0, 120) });
    }
    return out;
  });
}

// ── 3중점검 리스트 열기 ───────────────────────────────────────────────────
// ★세이프티원은 Vue(Vuetify) SPA 다 (2026-08-29 실측: v-btn·v-row·v-expansion-panel,
//  table 0개, 처음 화면에 호선번호 0개). 즉 **화면을 열었다고 데이터가 있는 게 아니라
//  "조회" 를 눌러야 뜬다.** 예전엔 "리스트" 를 찾았는데 이 사이트엔 그런 이름이 없다.
//  검색 조건은 접힌 v-expansion-panel 안에 있고, 그 패널 제목에도 "조회" 가 들어 있어
//  제목을 누르면 오히려 패널이 접힌다 — 그래서 제목은 빼고 실제 버튼만 누른다.
const CLICKABLE = 'button, a, [role="tab"], [role="button"], input[type="button"], input[type="submit"]';

/** 어느 프레임에서든 행이 하나라도 읽히면 참. 결과가 떴는지의 유일한 신뢰 신호다. */
async function anyRows() {
  if (apiCands.some(c => c.rows.length >= 5)) return true;   // API 로 이미 들어왔다
  for (const f of page.frames()) {
    try { if ((await rowsFrom(f)).length) return true; } catch { /* 접근 못 하는 프레임 */ }
  }
  return false;
}

/**
 * 이름이 맞는 첫 요소를 누른다.
 * 패널 제목(v-expansion-panel-title)에도 "조회" 가 들어 있어 그걸 누르면 패널이 접힌다.
 * 그래서 제목을 뺀 후보를 먼저 시도하고, 없을 때만 전체를 본다.
 */
const NOT_PANEL = 'button:not(.v-expansion-panel-title), a, [role="tab"], [role="button"], input[type="button"], input[type="submit"]';
async function clickNamed(re, step) {
  let tried = 0, clicked = 0;
  for (const f of page.frames()) {
    const els = f.locator(NOT_PANEL).filter({ hasText: re });
    const n = await els.count().catch(() => 0);
    for (let i = 0; i < n && clicked === 0; i++) {
      const el = els.nth(i);
      if (!await el.isVisible().catch(() => false)) continue;   // 숨은 것 누르면 안 눌린다
      tried++;
      try { await el.click({ timeout: 4000 }); clicked++; } catch { /* 다음 후보 */ }
    }
  }
  trace.push({ step, 후보: tried, 눌림: clicked });
  return clicked > 0;
}

await page.waitForLoadState('networkidle').catch(() => {});

// 이미 3중점검 화면이면(router-link-exact-active) 누를 필요가 없지만, 아니면 눌러 들어간다.
for (const [step, re] of [['3중점검', /3중점검|삼중점검/], ['조회', /조회|검색/], ['리스트', /리스트|목록/]]) {
  if (await anyRows()) { trace.push({ step, 건너뜀: '이미 행이 보임' }); break; }
  await clickNamed(re, step);
  await page.waitForTimeout(1500);
}

// 조회 응답이 늦을 수 있다. 행이 보일 때까지 최대 25초 기다린다.
for (let i = 0; i < 50 && !(await anyRows()); i++) await page.waitForTimeout(500);

// ① API 응답에서 읽혔으면 그걸 쓴다. 반복도가 가장 낮은(= 한 배에 한 줄인) 응답을 고른다.
let rows = [];
let source = 'DOM';
if (apiCands.length) {
  const best = apiCands.sort((a, b) => a.반복도 - b.반복도 || b.rows.length - a.rows.length)[0];
  rows = best.rows;
  source = `API ${best.path}`;
  console.log(`API 에서 읽음: ${best.path} — ${rows.length}척 (반복도 ${best.반복도.toFixed(1)})`);
}

// ② API 로 못 읽었으면 DOM 을 훑는다(예전 경로 — 표 화면을 열어 둔 경우).
if (rows.length < 5) {
  const seenHull = new Set(rows.map(r => r.hull));
  for (const f of page.frames()) {
    let got = [];
    try { got = await rowsFrom(f); } catch { /* 접근 못 하는 프레임은 넘긴다 */ }
    for (const r of got) if (!seenHull.has(r.hull)) { seenHull.add(r.hull); rows.push(r); }
  }
}

// 야드엔 보통 20척 이상 있다. 몇 척 안 잡혔으면 리스트가 안 펼쳐진 것이다.
if (rows.length < 5) await bail(`행을 ${rows.length}개밖에 못 읽었다 — 리스트가 안 펼쳐졌거나 화면 구조가 바뀌었다`);

writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), rows }, null, 1));
console.log(`호선 ${rows.length}척 수집 (${source}) → ${outPath}`);
// ★성공해도 진단을 남긴다. 실패할 때만 보이면 "그럴듯하게 틀린" 수집을 못 잡는다.
//  실제로 그렇게 두 번 놓쳤다(전부 1안벽 / 작업내용 필드).
console.log('----- 어느 응답에 무엇이 있었나 (값 없음, 이름·개수만) -----');
console.log(JSON.stringify({
  주고받은JSON: netlog.filter(r => r.bytes > 0),
  후보: apiCands.map(c => ({ path: c.path, 행: c.rows.length, 반복도: Number(c.반복도.toFixed(1)), 필드: c.필드 })),
  고른것: source,
}, null, 1));
console.log('----- 끝 -----');
await browser.close();
process.exit(0);
