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
 *  iOS 는 `apple-touch-icon` 에 **벡터(SVG)를 못 읽는다.** 래스터여야 하고 PNG 가
 *  유일하게 안전하다(jpg 는 나중에 아이콘이 검게 변한 사례가 있다).
 *  2026-08-30 프로덕션이 SVG 를 가리키고 PNG 는 한 장도 없었다 — 여기까지가 잰 것이다.
 *  그 상태에서 iOS 가 페이지 스크린샷을 박는다는 건 널리 보고되지만 Apple 미문서화이고
 *  실제 아이폰에서 확인하지는 않았다(추론). 안드로이드 manifest 도 PNG 가 안전하다.
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
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const SRC = join(PUB, 'icon.svg');
/**
 * maskable 전용 원본. 있으면 maskable PNG 는 이걸로 굽는다.
 *
 * ★기계적으로 `icon.svg` 를 80% 로 줄이는 것보다 낫다. 이 파일은 배경이 **풀블리드**
 *  (둥근 모서리 없음)이고 콘텐츠만 80% 안에 들어가 있어서, 안드로이드가 어떤 모양으로
 *  잘라도 배경이 끝까지 이어진다. 축소 방식은 배경까지 같이 줄어 테두리에 단차가 남는다.
 *  없으면 예전처럼 `icon.svg` 를 SAFE 비율로 줄여서 만든다.
 */
const SRC_MASK = join(PUB, 'icon-maskable.svg');

/**
 * 투명한 자리를 채울 바탕색.
 *
 * ★iOS 는 아이콘의 투명 픽셀을 **검게** 칠한다(알파 채널을 무시한다). 우리 SVG 는
 *  모서리가 둥근 사각형이라 네 귀퉁이가 투명한데, 그대로 두면 아이폰에서 검은
 *  귀퉁이가 생기고 그 위에 iOS 가 자기 둥근 마스크를 또 씌워 지저분해진다.
 *  꽉 채워서 넘긴다.
 *  아이콘을 바꾸면 이 값도 새 그림의 바탕에 맞춘다 — 안 바꾸면 귀퉁이에 색 단차가
 *  남는다. 잊지 않도록 **아래에서 배경과 그림의 같은 자리 픽셀을 직접 재서 비교**하고
 *  다르면 크게 찍는다. 급하면 `ICON_BG=...` 로 덮어쓸 수 있다.
 *
 * ★단색이 아니라 **CSS background 값 무엇이든** 된다. 지금 그림은 바탕이 위아래
 *  그라디언트(#e6f0f8→#bed6e9, 양 끝이 40 차이)라 단색으로는 위아래 중 한쪽이 반드시
 *  어긋난다. 그래서 같은 그라디언트를 깐다.
 *  (2026-08-30 실측: 옛 단색 #0284c7 을 그대로 뒀더니 검사가 188 차이로 잡아냈다.)
 */
const BG = process.env.ICON_BG || 'linear-gradient(#e6f0f8, #bed6e9)';

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
const maskBuf = existsSync(SRC_MASK) ? readFileSync(SRC_MASK) : null;
// ★두 원본을 **둘 다** 해시에 넣는다. maskable 만 고쳤는데 이름이 그대로면 안드로이드가
//  바뀐 걸 못 알아채고 옛 아이콘을 계속 쓴다.
const STAMP = createHash('sha256')
  .update(svgBuf).update(maskBuf ?? Buffer.alloc(0))
  .digest('hex').slice(0, 8);

/**
 * 만들 것들. iOS 180 · manifest 192/512 · maskable 512 · 파비콘 폴백 32.
 *
 * ★`manifest.json` 의 icons 에 **SVG 를 넣지 말 것.** manifest 는 JSON 이라 주석을
 *  못 달아서 여기에 적는다. 크롬은 manifest 아이콘으로 SVG 를 정식 지원하는데,
 *  `sizes:"any"` 인 SVG 는 아이콘 고르기에서 192/512 PNG 를 **밀어내고 주 아이콘이
 *  된다.** 그러면 안드로이드 홈화면 아이콘이 통째로 SVG 경로를 타고, maskable 분리도
 *  무의미해진다. 탭 아이콘용 `rel="icon" type="image/svg+xml"` 은 index.html 에만 둔다.
 * ★한 항목에 `purpose: "any maskable"` 을 같이 쓰지 말 것 — DevTools 가 경고하고,
 *  하나의 그림이 "안 잘리는 아이콘" 과 "잘리는 아이콘" 을 동시에 잘 해낼 수 없다.
 *  ★단 이유는 **Chrome/안드로이드의 크롭**이지 Safari 가 아니다. WebKit 은 purpose 를
 *  공백으로 쪼개 합집합으로 담아서 `"any maskable"` 도 any 를 포함한다 — Safari 기준
 *  실격이 아니었다. 옛 아이콘이 안 나온 원인은 apple-touch-icon 이 SVG 였던 것뿐이다.
 */
const JOBS = [
  { base: 'icon-180', size: 180, safe: 1,    why: 'iOS apple-touch-icon' },
  { base: 'icon-192', size: 192, safe: 1,    why: 'manifest any' },
  { base: 'icon-512', size: 512, safe: 1,    why: 'manifest any (큰 것)' },
  { base: 'icon-maskable-512', size: 512, safe: maskBuf ? 1 : SAFE, mask: true,
    why: maskBuf ? 'manifest maskable (전용 원본)' : 'manifest maskable (icon.svg 축소)' },
  { base: 'icon-32',  size: 32,  safe: 1,    why: '파비콘 PNG 폴백' },
];
for (const j of JOBS) j.out = `${j.base}.${STAMP}.png`;

/** 경로를 박아 둔 곳. 여기 없는 곳에서 아이콘을 참조하면 이름이 바뀔 때 깨진다. */
const REFS = [
  { file: join(ROOT, 'index.html'),   bases: ['icon-32', 'icon-180', 'icon-192'] },
  { file: join(PUB, 'manifest.json'), bases: ['icon-192', 'icon-512', 'icon-maskable-512'] },
];

const dataUri = `data:image/svg+xml;base64,${svgBuf.toString('base64')}`;
const maskUri = maskBuf ? `data:image/svg+xml;base64,${maskBuf.toString('base64')}` : dataUri;

// 이 레포의 playwright 버전이 이 기계에 깔린 크로미움 리비전과 다를 수 있다.
// 그럴 때 `npx playwright install` 을 시키는 대신 이미 있는 실행파일을 가리킨다.
// CHROMIUM_PATH 가 있으면 그걸 쓰고, 없으면 평소대로 받아 쓴다.
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
try {
  // ── 바탕이 그림과 맞는지 먼저 잰다 ────────────────────────────────
  // ★단색이든 그라디언트든 통하게, **같은 자리의 배경 픽셀과 그림 픽셀을 직접 비교**한다.
  //  hex 를 파싱해 비교하면 그라디언트에서는 아예 못 잰다.
  //  재는 자리는 둥근 모서리 **안쪽**으로 조금 들어온 네 점 — 모서리 자체는 투명해서
  //  아무것도 알려주지 않는다. 여기가 곧 PNG 귀퉁이와 맞닿는 색이다.
  //  (rx=114/512 = 22% → 64px 기준 14px. 그보다 안쪽인 20px 지점을 읽는다.)
  const PROBE_PTS = [[20, 1], [43, 1], [20, 62], [43, 62]];
  const sample = async (uri) => {
    const pg = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await pg.setContent('<body style="margin:0">');
    const out = await pg.evaluate(async ({ uri, pts }) => {
      const im = new Image();
      im.src = uri;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      return pts.map(([x, y]) => { const i = (y * 64 + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; });
    }, { uri, pts: PROBE_PTS });
    await pg.close();
    return out;
  };

  // 그림 — 투명 배경 위에 그대로 그린다.
  const art = await sample(dataUri);
  // 배경 — 실제로 칠해진 픽셀을 읽어야 그라디언트도 잡힌다. 배경만 찍어서 다시 읽는다.
  const bgPage = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await bgPage.setContent(`<html><body style="margin:0;width:64px;height:64px;background:${BG}"></body></html>`);
  const bgShot = await bgPage.screenshot({ type: 'png' });
  await bgPage.close();
  const bg = await sample(`data:image/png;base64,${bgShot.toString('base64')}`);

  const hex = (e) => '#' + e.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  // 그 자리가 투명하면 비교할 것이 없다 — 불투명한 점만 본다.
  const diffs = art
    .map((a, i) => (a[3] > 250 ? Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - bg[i][k]))) : null))
    .filter((v) => v !== null);
  console.log(`바탕 BG=${BG}`);
  console.log(`  그림 가장자리  ${art.map(hex).join(' ')}`);
  console.log(`  배경 같은 자리 ${bg.map(hex).join(' ')}`);
  console.log(`  차이 ${diffs.join(' ')} (허용 ${BG_TOL})`);
  if (diffs.length && Math.max(...diffs) > BG_TOL)
    console.log(`★BG 가 그림과 다르다(최대 ${Math.max(...diffs)} 차이). 귀퉁이에 색 단차가 남는다 — ` +
                `BG 를 그림 바탕과 같게 맞춰라.`);

  // ── PNG 굽기 ─────────────────────────────────────────────────────
  for (const j of JOBS) {
    const page = await browser.newPage({
      viewport: { width: j.size, height: j.size },
      deviceScaleFactor: 1,
    });
    const pad = ((1 - j.safe) / 2) * 100;
    await page.setContent(
      `<html><body style="margin:0;width:${j.size}px;height:${j.size}px;background:${BG}">
         <img src="${j.mask ? maskUri : dataUri}"
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
