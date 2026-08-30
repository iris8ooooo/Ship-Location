/**
 * ★안전 검사 — 글자가 선체를 자르면 **아무 답도 내지 않아야** 한다.
 *
 *  라이브 지도는 호선번호 글자를 지도 배율과 무관하게 고정 크기로 그린다. 축소된
 *  화면에서는 그 글자가 선체를 가로질러 흰 도형을 두 동강 냈다(실측 run 27:
 *  길이 49~94, 폭은 정상). 조각의 **잘린 단면은 "뭉툭한 끝"으로 읽히므로**
 *  그대로 두면 반대 방향을 써 버린다 — 이 프로젝트가 반복해서 당한 "조용한 오답"이다.
 *
 *  못 읽는 것은 선석 관례로 가면 그만이다. 반대로 그리는 것이 사고다.
 *  그래서 세이프티원이 준 length 와 잰 길이가 안 맞으면 버린다.
 *
 *   node scripts/test-bow-safety.mjs
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { detectShips, bowByHull } from '../src/lib/bow-detect.mjs';

const srcTxt = readFileSync(new URL('./test-bow-detect.mjs', import.meta.url), 'utf8');
const fnSrc = srcTxt.slice(srcTxt.indexOf('function decodePng'), srcTxt.indexOf('let bad = 0;'));
const decodePng = new Function('inflateSync', 'Buffer', fnSrc + '; return decodePng;')(inflateSync, Buffer);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) bad++; };

const { W, H, ch, px } = decodePng(readFileSync(new URL('../docs/reference/safetyone-map.png', import.meta.url)));
const base = new Uint8Array(W * H);
for (let i = 0, k = 0; i < W * H; i++, k += ch)
  base[i] = (px[k] > 246 && px[k + 1] > 246 && px[k + 2] > 246) ? 1 : 0;

// 야드 좌표 + 세이프티원 length(데시미터). 길이 검사가 동작하려면 length 가 있어야 한다.
const SHIPS = [
  ['8209',966,368,1570],['8248',360,316,2300],['8323',468,474,2700],['8238',966,484,2900],
  ['8300',390,468,3650],['8282',174,704,3290],['8203',207,704,2900],['8247',360,470,2300],
  ['8322',438,476,2700],['8263',777,574,2900],['8313',1002,658,2750],['8262',775,604,2900],
  ['8206',75,560,2990],['8208',246,593,2900],['8246',552,599,2300],['8315',634,707,2750],
  ['8314',611,707,2750],['8222',138,704,3660],['8292',462,337,2020],['8207',245,563,2990],
  ['8254',549,569,2990],['8283',389,313,1850],
].map(([hull, x, y, length]) => ({ hull, x, y, length }));

const TRUE_BOW = { '8206':180,'8207':180,'8208':180,'8246':180,'8254':180,'8262':180,'8263':180,
                   '8203':90,'8282':90,'8222':270,'8313':270,'8314':270,'8315':270 };
const wrongCount = (bows) => [...bows].filter(([h, v]) =>
  TRUE_BOW[h] !== undefined && Math.abs(((v - TRUE_BOW[h] + 540) % 360) - 180) > 45).length;

// ── 1. 멀쩡한 도면에서는 그대로 읽는다 ───────────────────────────
console.log('\n[1] 멀쩡한 도면 — 길이 검사가 정상 배를 막지 않는가');
{
  const r = bowByHull(base, W, H, SHIPS);
  console.log(`   도형 ${r.found} · 붙임 ${r.matched} · 방향 ${r.bows.size} · 축척 ${r.scale}`);
  ok(r.bows.size >= 12, `길이 검사를 넣어도 ${r.bows.size}척 읽는다 (12척 이상)`);
  ok(wrongCount(r.bows) === 0, '반대로 읽은 배 없음');
}

// ── 2. ★글자가 선체를 자른 상황 ─────────────────────────────────
console.log('\n[2] 글자가 선체를 자른 상황 — 라이브에서 실제로 일어난 것');
function cutHulls(mask, w, h, bandPx) {
  const out = Uint8Array.from(mask);
  for (const s of detectShips(mask, w, h)) {
    const rad = (s.axisDeg * Math.PI) / 180;
    const ux = Math.cos(rad), uy = Math.sin(rad);
    for (let t = -bandPx / 2; t <= bandPx / 2; t += 0.5)
      for (let n = -s.wid; n <= s.wid; n += 0.5) {
        const x = Math.round(s.cx + ux * t - uy * n), y = Math.round(s.cy + uy * t + ux * n);
        if (x >= 0 && y >= 0 && x < w && y < h) out[y * w + x] = 0;
      }
  }
  return out;
}
for (const band of [10, 18]) {
  const cut = cutHulls(base, W, H, band);
  const frags = detectShips(cut, W, H).length;
  const r = bowByHull(cut, W, H, SHIPS);
  const wrong = wrongCount(r.bows);
  console.log(`   띠 ${band}px — 조각 ${frags} · 붙임 ${r.matched} · 방향 ${r.bows.size} · 반대 ${wrong}`);
  // 핵심은 "많이 읽는 것" 이 아니라 **반대로 안 쓰는 것** 이다.
  ok(wrong === 0, `띠 ${band}px — 잘린 조각으로 반대 방향을 쓰지 않는다 (반대 ${wrong}건)`);
  ok(frags > 20, `띠 ${band}px — 실제로 조각났다 (조각 ${frags}개, 원래 16개)`);
}

// ── 3. 길이가 안 맞으면 이유를 남긴다 ────────────────────────────
console.log('\n[3] 버린 이유가 로그에 남는가');
{
  const r = bowByHull(cutHulls(base, W, H, 18), W, H, SHIPS);
  const dropped = (r.rows ?? []).filter(x => x.bow === '길이불일치');
  ok(dropped.length > 0, `길이 불일치로 버린 것이 ${dropped.length}건 — 로그에 이유가 남는다`);
}

// ── 4. 큰 흰 덩어리가 수집을 죽이지 않는가 ──────────────────────
// ★run 28 에서 확대 캡처 중 큰 덩어리가 잡히자 blobShape 의 `Math.min(...ts)` 가
//  RangeError: Maximum call stack size exceeded 로 터져 **수집이 통째로 죽었다.**
//  스프레드는 배열 길이만큼 인자를 밀어 넣는다 — 수만 개면 넘친다.
console.log('\n[4] 큰 흰 덩어리 — 터지지 않고 넘어가는가');
{
  const big = Uint8Array.from(base);
  // 캔버스의 한 귀퉁이를 통째로 희게 칠한다(배 한 척은 실측 0.14% 뿐이다).
  for (let y = 0; y < Math.floor(H * 0.35); y++)
    for (let x = 0; x < Math.floor(W * 0.35); x++) big[y * W + x] = 1;
  let threw = null, r = null;
  try { r = bowByHull(big, W, H, SHIPS); } catch (e) { threw = e; }
  ok(!threw, `터지지 않는다 (${threw ? threw.message : '정상'})`);
  ok(r && wrongCount(r.bows) === 0, '그 상황에서도 반대 방향은 안 쓴다');
}

console.log(bad ? `\n❌ ${bad}건 실패` : '\n✅ 전부 통과');
process.exit(bad ? 1 : 0);
