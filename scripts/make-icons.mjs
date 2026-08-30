/**
 * `public/icon.svg` 한 장에서 홈화면·바탕화면용 아이콘을 전부 만든다.
 *
 *   node scripts/make-icons.mjs
 *
 * ★아이콘을 바꾸려면 `public/icon.svg` 만 갈아 끼우고 이걸 한 번 돌리면 된다.
 *  PNG 다섯 장을 새로 굽고, `index.html` 과 `public/manifest.json` 의 경로까지
 *  이 스크립트가 직접 고쳐 쓰고, 예전 PNG 는 지운다. 손으로 만질 파일이 없다.
 *
 * ★왜 PNG 를 따로 만드나
 *  iOS 는 `apple-touch-icon` 에 **SVG 를 쓰지 못한다.** 프로덕션이 SVG 를
 *  가리키고 있었고(실측 2026-08-30) 그 상태로 아이폰 홈화면에 추가하면 우리
 *  아이콘 대신 **페이지 스크린샷**이 박힌다. 안드로이드 manifest 도 PNG 가 안전하다.
 *
 * ★왜 파일 이름에 해시를 박나  ⭐⭐⭐
 *  iOS 웹클립 아이콘 캐시는 깊다. 같은 이름으로 그림만 갈아 끼우면 지우고 다시
 *  추가해도 옛 아이콘이 되살아난다(Apple 개발자포럼 23984 · discussions 8186768).
 *  `?v=2` 같은 쿼리스트링은 잘 안 통하고 **파일명 자체를 바꾸는 것**이 확실하다.
 *  그래서 SVG 내용의 sha256 앞 8자리를 이름에 넣는다 — 그림이 바뀌면 이름이 저절로
 *  바뀌고, 안 바뀌면 그대로다. 사람이 버전을 기억해서 올릴 필요가 없다.
 *  (nginx 는 `.png` 를 `try_files $uri =404` 로 받으므로 이름이 틀리면 404 로 드러난다.
 *   예전엔 없는 파일도 200+text/html 이라 조용히 깨졌다.)
 *
 * ★왜 Playwright 인가
 *  이 레포에 이미 devDependency 로 들어 있다(수집 스크레이퍼가 쓴다). sharp 나
 *  ImageMagick 을 새로 들이지 않으려는 것 — 아이콘 몇 장 만들자고 의존성을
 *  늘릴 이유가 없다. Chromium 이 SVG 를 정확히 그려 주므로 결과도 낫다.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const SRC = join(PUB, 'icon.svg');

/**
 * 투명한 자리를 채울 바탕색.
 *
 * ★iOS 는 아이콘의 투명 픽셀을 **검게** 칠한다(알파 채널을 무시한다). 우리 SVG 는
 *  모서리가 둥근 사각형이라 네 귀퉁이가 투명한데, 그대로 두면 아이폰에서 검은
 *  귀퉁이가 생기고 그 위에 iOS 가 자기 둥근 마스크를 또 씌워 지저분해진다.
 *  꽉 채워서 넘긴다.
 *  아이콘을 바꾸면 이 색도 새 그림의 바탕색으로 같이 바꾼다 — 안 바꾸면 귀퉁이에
 *  색 단차가 남는다. 잊지 않도록 **아래에서 실제 그림 가장자리 색을 재서 비교**하고
 *  다르면 크게 찍는다. 급하면 `ICON_BG=#rrggbb` 로 덮어쓸 수 있다.
 */
const BG = process.env.ICON_BG || '#0284c7';

/** 이 이상 벌어지면 귀퉁이 단차가 눈에 보인다(채널당 0~255). */
const BG_TOL = 16;

/**
 * maskable 아이콘의 안전 영역.
 *
 * ★안드로이드는 아이콘을 원·둥근사각 등 기기 모양으로 **잘라낸다.** 그래서 그림을
 *  80% 로 줄여 가운데 놓고 나머지는 바탕색으로 채운다. 이걸 안 하면 배 그림
 *  가장자리가 잘린다. 같은 파일을 `any` 와 `maskable` 로 겸용하면 둘 중 하나는
 *  반드시 어색해진다.
 * ★규격상 안전 영역은 사각형이 아니라 **지름 80% 짜리 원**이다(web.dev
 *  maskable-icon). 사각 그림을 0.8 로 줄이면 네 모서리는 반지름 56.6% 지점에
 *  놓여 원형 마스크에 여전히 잘릴 수 있다. 지금 아이콘은 모서리 쪽이 바탕색·파도
 *  뿐이라 실피해가 없지만, **모서리까지 그림을 채우는 아이콘으로 바꾸면 0.7 로
 *  내리거나 그림을 원 안에 넣어야 한다.**
 */
const SAFE = 0.8;

/** 그림이 바뀌면 이름이 바뀐다. 위 "왜 해시를 박나" 참고. */
const svgBuf = readFileSync(SRC);
const STAMP = createHash('sha256').update(svgBuf).digest('hex').slice(0, 8);

/** 만들 것들. iOS 180 · manifest 192/512 · maskable 512 · 파비콘 폴백 32. */
const JOBS = [
  { base: 'icon-180', size: 180, safe: 1,    why: 'iOS apple-touch-icon' },
  { base: 'icon-192', size: 192, safe: 1,    why: 'manifest any' },
  { base: 'icon-512', size: 512, safe: 1,    why: 'manifest any (큰 것)' },
  { base: 'icon-maskable-512', size: 512, safe: SAFE, why: 'manifest maskable' },
  { base: 'icon-32',  size: 32,  safe: 1,    why: '파비콘 PNG 폴백' },
];
for (const j of JOBS) j.out = `${j.base}.${STAMP}.png`;

/** 경로를 박아 둔 곳. 여기 없는 곳에서 아이콘을 참조하면 이름이 바뀔 때 깨진다. */
const REFS = [
  { file: join(ROOT, 'index.html'),   bases: ['icon-32', 'icon-180'] },
  { file: join(PUB, 'manifest.json'), bases: ['icon-192', 'icon-512', 'icon-maskable-512'] },
];

const dataUri = `data:image/svg+xml;base64,${svgBuf.toString('base64')}`;

// 이 레포의 playwright 버전이 이 기계에 깔린 크로미움 리비전과 다를 수 있다.
// 그럴 때 `npx playwright install` 을 시키는 대신 이미 있는 실행파일을 가리킨다.
// CHROMIUM_PATH 가 있으면 그걸 쓰고, 없으면 평소대로 받아 쓴다.
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
try {
  // ── 바탕색이 그림과 맞는지 먼저 잰다 ──────────────────────────────
  // 둥근 모서리 **안쪽**으로 조금 들어온 네 점을 읽는다. 모서리 자체는 투명해서
  // 아무것도 알려주지 않는다. 여기가 곧 PNG 귀퉁이와 맞닿는 색이다.
  const probePage = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await probePage.setContent('<body style="margin:0">');
  const edges = await probePage.evaluate(async (uri) => {
    const im = new Image();
    im.src = uri;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    // rx=112/512 = 22% → 64px 기준 14px. 그보다 안쪽인 20px 지점을 읽는다.
    return [[20, 1], [43, 1], [20, 62], [43, 62]].map(([x, y]) => {
      const i = (y * 64 + x) * 4;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    });
  }, dataUri);
  await probePage.close();

  const bg = [1, 3, 5].map((i) => parseInt(BG.slice(i, i + 2), 16));
  const opaque = edges.filter((e) => e[3] > 250);
  const far = opaque.map((e) => Math.max(...bg.map((v, i) => Math.abs(v - e[i]))));
  const hex = (e) => '#' + e.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  console.log(`바탕색 BG=${BG} · 그림 가장자리 ${opaque.map(hex).join(' ')}`);
  if (far.length && Math.min(...far) > BG_TOL) {
    console.log(`★BG 가 그림과 다르다(가장 가까운 모서리도 ${Math.min(...far)} 차이). ` +
                `귀퉁이에 색 단차가 남는다 — BG 를 위 색 중 하나로 바꿔라.`);
  }

  // ── PNG 굽기 ─────────────────────────────────────────────────────
  for (const j of JOBS) {
    const page = await browser.newPage({
      viewport: { width: j.size, height: j.size },
      deviceScaleFactor: 1,
    });
    const pad = ((1 - j.safe) / 2) * 100;
    await page.setContent(
      `<html><body style="margin:0;width:${j.size}px;height:${j.size}px;background:${BG}">
         <img src="${dataUri}"
              style="position:absolute;left:${pad}%;top:${pad}%;
                     width:${j.safe * 100}%;height:${j.safe * 100}%;display:block">
       </body></html>`,
    );
    // 폰트나 외부 자원을 쓰지 않는 SVG 라 로드 대기가 따로 필요 없지만,
    // 그림이 실제로 그려졌는지는 확인하고 찍는다.
    await page.waitForFunction(() => {
      const im = document.querySelector('img');
      return im && im.complete && im.naturalWidth > 0;
    }, null, { timeout: 10000 });
    // omitBackground 를 켜지 않는다 — 투명을 남기면 iOS 가 검게 칠한다.
    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(join(PUB, j.out), buf);
    console.log(`${j.out.padEnd(30)} ${String(j.size).padStart(3)}px  ${String(buf.length).padStart(6)}B  ${j.why}`);
    await page.close();
  }
} finally {
  await browser.close();
}

// ── 참조 고쳐 쓰기 ─────────────────────────────────────────────────
// 해시가 붙기 전(`/icon-180.png`)과 붙은 뒤(`/icon-180.abcd1234.png`) 둘 다 잡는다.
for (const ref of REFS) {
  let text = readFileSync(ref.file, 'utf8');
  for (const base of ref.bases) {
    const job = JOBS.find((j) => j.base === base);
    const re = new RegExp(`/${base}(\\.[0-9a-f]{8})?\\.png`, 'g');
    const hits = text.match(re);
    // 조용히 넘어가면 안 된다 — 못 고친 참조는 배포 뒤 404 로만 드러난다.
    if (!hits || hits.length !== 1)
      throw new Error(`${ref.file} 에서 /${base}.png 참조를 ${hits ? hits.length : 0}개 찾았다 (1개여야 한다)`);
    text = text.replace(re, `/${job.out}`);
  }
  writeFileSync(ref.file, text);
  console.log(`고쳐 씀  ${ref.file.replace(ROOT + '/', '')}  →  ${ref.bases.join(' · ')}`);
}

// ── 예전 것 지우기 ─────────────────────────────────────────────────
// 이 스크립트가 만든 이름꼴만 지운다. 남겨 두면 public/ 에 계속 쌓인다.
const keep = new Set(JOBS.map((j) => j.out));
const mine = new RegExp(`^(${JOBS.map((j) => j.base).join('|')})(\\.[0-9a-f]{8})?\\.png$`);
for (const f of readdirSync(PUB)) {
  if (!mine.test(f) || keep.has(f)) continue;
  unlinkSync(join(PUB, f));
  console.log(`지움     public/${f}`);
}

console.log('\n끝. index.html·manifest.json 이 새 이름을 가리킨다. 그대로 커밋하면 된다.');
