/**
 * `public/icon.svg` 한 장에서 홈화면·바탕화면용 아이콘을 전부 만든다.
 *
 *   node scripts/make-icons.mjs
 *
 * ★아이콘을 바꾸려면 `public/icon.svg` 만 갈아 끼우고 이걸 한 번 돌리면 된다.
 *  나머지 파일은 전부 여기서 나오므로 손으로 만들 것이 없다.
 *
 * ★왜 PNG 를 따로 만드나
 *  iOS 는 `apple-touch-icon` 에 **SVG 를 쓰지 못한다.** 지금 프로덕션이 SVG 를
 *  가리키고 있어서(실측 2026-08-30) 아이폰 홈화면에 추가하면 우리 아이콘 대신
 *  **페이지 스크린샷**이 박힌다. 안드로이드 manifest 도 PNG 가 가장 안전하다.
 *
 * ★왜 Playwright 인가
 *  이 레포에 이미 devDependency 로 들어 있다(수집 스크레이퍼가 쓴다). sharp 나
 *  ImageMagick 을 새로 들이지 않으려는 것 — 아이콘 몇 장 만들자고 의존성을
 *  늘릴 이유가 없다. Chromium 이 SVG 를 정확히 그려 주므로 결과도 낫다.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public', 'icon.svg');

/**
 * 투명한 자리를 채울 바탕색.
 *
 * ★iOS 는 아이콘의 투명 픽셀을 **검게** 칠한다. 우리 SVG 는 모서리가 둥근
 *  사각형이라 네 귀퉁이가 투명한데, 그대로 두면 아이폰에서 검은 귀퉁이가 생기고
 *  그 위에 iOS 가 자기 둥근 마스크를 또 씌워 지저분해진다. 꽉 채워서 넘긴다.
 *  아이콘을 바꾸면 이 색도 새 그림의 바탕색으로 같이 바꾼다.
 */
const BG = '#0284c7';

/**
 * maskable 아이콘의 안전 영역.
 *
 * ★안드로이드는 아이콘을 원·둥근사각 등 기기 모양으로 **잘라낸다.** 규격상
 *  가운데 지름 80% 안에 든 것만 확실히 살아남는다. 그래서 그림을 80% 로 줄여
 *  가운데 놓고 나머지는 바탕색으로 채운다. 이걸 안 하면 배 그림 가장자리가 잘린다.
 *  같은 파일을 `any` 와 `maskable` 로 겸용하면 둘 중 하나는 반드시 어색해진다.
 */
const SAFE = 0.8;

/** 만들 것들. iOS 180 · manifest 192/512 · maskable 512 · 파비콘 폴백 32. */
const JOBS = [
  { out: 'icon-180.png', size: 180, safe: 1,    why: 'iOS apple-touch-icon' },
  { out: 'icon-192.png', size: 192, safe: 1,    why: 'manifest any' },
  { out: 'icon-512.png', size: 512, safe: 1,    why: 'manifest any (큰 것)' },
  { out: 'icon-maskable-512.png', size: 512, safe: SAFE, why: 'manifest maskable' },
  { out: 'icon-32.png',  size: 32,  safe: 1,    why: '파비콘 PNG 폴백' },
];

const svg = readFileSync(SRC, 'utf8');
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

// 이 레포의 playwright 버전이 이 기계에 깔린 크로미움 리비전과 다를 수 있다.
// 그럴 때 `npx playwright install` 을 시키는 대신 이미 있는 실행파일을 가리킨다.
// CHROMIUM_PATH 가 있으면 그걸 쓰고, 없으면 평소대로 받아 쓴다.
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
try {
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
    writeFileSync(join(ROOT, 'public', j.out), buf);
    console.log(`${j.out.padEnd(24)} ${String(j.size).padStart(3)}px  ${String(buf.length).padStart(6)}B  ${j.why}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('\n끝. public/ 에 넣었다. index.html·manifest.json 은 이 이름들을 가리키고 있다.');
