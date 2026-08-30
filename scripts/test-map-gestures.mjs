#!/usr/bin/env node
/**
 * 지도 제스처 회귀 검사 — 2026-08-30 에 잡은 두 버그가 다시 들어오지 못하게 한다.
 *
 *  ① 핀치가 한 프레임만 움직이고 죽는 것
 *     원인은 배율이 바뀔 때마다 지도 SVG 가 통째로 다시 그려져(React 19 는
 *     `dangerouslySetInnerHTML` 을 **객체 동일성**으로 비교한다) 손가락 아래 노드가
 *     문서에서 뜯겨 나가는 것이었다. 타깃이 사라진 터치는 브라우저가 touchmove 를
 *     더 이상 배달하지 않는다. → **배달 수**와 **배율이 손가락 비율을 따라가는가**를 잰다.
 *  ② 이동 애니메이션(620ms) 중에 누른 지역 버튼이 통째로 버려지는 것
 *     → 이동 도중에 「전체」를 눌러 실제로 전체보기로 가는지 잰다.
 *
 * 돌리는 법:  node scripts/test-map-gestures.mjs
 *   (직접 빌드하고 vite preview 를 띄운다. 크로미움 리비전이 다르면 CHROMIUM_PATH 로 준다.)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179, URL = `http://127.0.0.1:${PORT}/`;

/** 이 기계의 크로미움. playwright 기본 경로가 어긋나면 /opt 에서 찾는다. */
function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
  const p = dir && `${root}/${dir}/chrome-linux/chrome`;
  return p && existsSync(p) ? p : undefined;
}

const STATE = `(()=>{const vp=document.querySelector('div.flex-1.overflow-auto');
  const inn=vp.firstElementChild.firstElementChild;
  const m=inn.style.transform.match(/scale\\(([-0-9.]+)\\)/);
  return { z: m?+m[1]:null };})()`;

let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✅' : '❌'} ${msg}`); if (!cond) fail++; };

console.log('빌드…');
if (spawnSync('npx', ['vite', 'build'], { stdio: 'ignore' }).status !== 0) {
  console.error('빌드 실패'); process.exit(1);
}
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* 이미 죽었다 */ } };
process.on('exit', stop);

const browser = await chromium.launch({ executablePath: chromePath() });
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  for (let i = 0; ; i++) {                       // preview 가 뜰 때까지
    try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 3000 }); break; }
    catch (e) { if (i > 20) throw e; await page.waitForTimeout(500); }
  }
  await page.waitForSelector('div.flex-1.overflow-auto', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i, radiusX: 12, radiusY: 12, force: 1 })) });
  const z = async () => (await page.evaluate(STATE)).z;
  const btn = l => page.locator('button', { hasText: l }).first();
  const home = await z();

  // ── ① 핀치 ────────────────────────────────────────────────
  console.log('\n[1] 핀치 줌아웃 — 손가락 300→60px 을 6단계로');
  await page.evaluate(() => {
    window.__n = 0;
    document.addEventListener('touchmove', () => window.__n++, { capture: true, passive: true });
  });
  await btn('1안벽').click(); await page.waitForTimeout(1000);
  const z0 = await z();
  await page.evaluate(() => { window.__n = 0; });
  const pt = d => [{ x: 160, y: 380 - d / 2 }, { x: 160, y: 380 + d / 2 }];
  await touch('touchStart', pt(300)); await page.waitForTimeout(40);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', pt(300 - 40 * i)); await page.waitForTimeout(45); }
  await touch('touchEnd', []); await page.waitForTimeout(150);
  const z1 = await z(), moves = await page.evaluate(() => window.__n), want = z0 * 60 / 300;
  ok(moves >= 6, `touchmove 배달 ${moves}/6 — 적으면 손가락 밑 노드가 갈린 것이다`);
  ok(Math.abs(z1 - want) / want < 0.05, `배율 ${z0.toFixed(3)} → ${z1.toFixed(3)} (기대 ${want.toFixed(3)})`);

  // ── ② 이동 중 지역 버튼 ───────────────────────────────────
  console.log('\n[2] 이동(620ms) 도중에 「전체」 — 눌림이 버려지지 않는가');
  for (const gap of [150, 400, 600]) {
    await btn('2도크').click(); await page.waitForTimeout(1000);
    await btn('1안벽').click(); await page.waitForTimeout(gap);
    await btn('전체').click(); await page.waitForTimeout(1300);
    ok(Math.abs(await z() - home) < 0.01, `1안벽 누르고 ${String(gap).padStart(3)}ms 뒤 전체`);
  }
} finally {
  await browser.close();
  stop();
}
console.log(fail ? `\n실패 ${fail}건` : '\n전부 통과');
process.exit(fail ? 1 : 0);
