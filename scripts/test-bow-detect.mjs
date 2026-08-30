/**
 * bow-detect 를 **실제 세이프티원 도면**(docs/reference/safetyone-map.png)으로 검증한다.
 *
 * 픽스처를 따로 만들지 않고 레포에 이미 있는 원본 PNG 를 그대로 읽는다 — 검증은
 * 진짜 그림으로 해야 의미가 있다. 의존성 없이 zlib(내장)으로 직접 디코드한다.
 *
 *   node scripts/test-bow-detect.mjs
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { detectShips, registerBlobs, bowByHull, BOW_TIP_MAX, BLUNT_TIP_MIN } from '../src/lib/bow-detect.mjs';

/** 8비트 RGB/RGBA · 비인터레이스 PNG 만 읽는다(우리 원본이 그렇다). */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 가 아니다');
  let p = 8, W = 0, H = 0, ch = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      const bd = data[8], ct = data[9], il = data[12];
      if (bd !== 8 || il !== 0 || (ct !== 2 && ct !== 6)) throw new Error(`지원 안 하는 PNG (bd=${bd} ct=${ct} il=${il})`);
      ch = ct === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(W * H * ch);
  const stride = W * ch;
  let rp = 0;
  for (let y = 0; y < H; y++) {
    const filt = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (filt === 1) v += a;
      else if (filt === 2) v += b;
      else if (filt === 3) v += (a + b) >> 1;
      else if (filt === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { W, H, ch, px: out };
}

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) bad++; };

const { W, H, ch, px } = decodePng(readFileSync(new URL('../docs/reference/safetyone-map.png', import.meta.url)));
console.log(`도면 ${W}x${H} · 채널 ${ch}`);
const mask = new Uint8Array(W * H);
for (let i = 0, k = 0; i < W * H; i++, k += ch)
  mask[i] = (px[k] > 246 && px[k + 1] > 246 && px[k + 2] > 246) ? 1 : 0;

// ── 1. 도형 검출 ─────────────────────────────────────────────────
console.log('\n[1] 도형 검출');
const shapes = detectShips(mask, W, H).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
ok(shapes.length === 15, `흰 배 도형 15개 (실제 ${shapes.length})`);
// 가장 짧은 도형은 8209 다 — 세이프티원 length 1570 으로 함대 최단이고,
// 8238(2900) 대비 길이비 0.54 가 그림에서도 그대로 나온다(68/125).
const shortest = shapes.reduce((a, b) => (a.len < b.len ? a : b));
ok(shortest.len > 60 && shortest.len < 80, `가장 짧은 도형이 8209 크기 (len ${shortest.len.toFixed(0)})`);

// ── 2. 끝단 측정이 세 갈래로 갈리는가 ────────────────────────────
console.log('\n[2] 끝단 측정 — 선수/선미/블록');
const tips = shapes.flatMap(s => [s.tipLo, s.tipHi]);
const round = tips.filter(t => t <= BOW_TIP_MAX), blunt = tips.filter(t => t >= BLUNT_TIP_MIN);
ok(round.length + blunt.length === tips.length,
   `끝 26개가 전부 임계값 바깥 — 애매한 값 없음 (둥근 ${round.length} · 뭉툭 ${blunt.length})`);
ok(Math.max(...round) < Math.min(...blunt) - 1.0,
   `두 무리 사이가 벌어져 있다 (둥근 최대 ${Math.max(...round).toFixed(2)} < 뭉툭 최소 ${Math.min(...blunt).toFixed(2)})`);

const blocks = shapes.filter(s => s.bowAt === null).sort((a, b) => a.cx - b.cx);
ok(blocks.length === 2, `양끝 뭉툭(블록)으로 판정 보류한 도형 2개 (실제 ${blocks.length})`);
// 둘 다 1BERTH 자리 — 8238(1168,1034) 과 8209(1218,933)
ok(blocks.every(b => b.cx > 1100), '둘 다 1BERTH 쪽 — 실측과 같은 자리');

// ── 3. 짝짓기 ────────────────────────────────────────────────────
console.log('\n[3] 호선 짝짓기 (RANSAC)');
// 이 도면(2026-08-28)에 맞는 야드 좌표. run 20 fit 로그의 "지도 (x,y)".
const EXPECTED = [
  ['8209',966,368],['8248',360,316],['8323',468,474],['8238',966,484],['8300',390,468],
  ['8282',174,704],['8203',207,704],['8247',360,470],['8322',438,476],['8263',777,574],
  ['8313',1002,658],['8262',775,604],['8206',75,560],['8208',246,593],['8246',552,599],
  ['8315',634,707],['8314',611,707],['8222',138,704],['8292',462,337],['8207',245,563],
  ['8254',549,569],['8283',389,313],
].map(([hull, x, y]) => ({ hull, x, y }));

// ★이 목록은 2026-08-29 야드고 도면은 08-28 이다. 그래서 8285(도면에만)와
//  8265(목록에만)가 서로 어긋나 있다 — 함대가 달라도 짝짓기가 버티는지 같이 본다.
const reg = registerBlobs(shapes, EXPECTED, 45);
ok(!!reg, '변환을 찾았다');
ok(reg && reg.pairs.length >= 13, `도형 15개 중 ${reg ? reg.pairs.length : 0}개를 호선에 붙였다`);
ok(reg && !reg.pairs.some(p => p.hull === '8265'),
   '목록에만 있고 도면에 없는 8265 를 억지로 붙이지 않는다');
const scale = reg && Math.hypot(reg.T.a, reg.T.b);
ok(scale && Math.abs(scale - 1) < 0.1, `축척이 1 근처 (${scale ? scale.toFixed(3) : '-'}) — 도면과 야드가 같은 배율`);

// ── 4. 뱃머리 방향 ───────────────────────────────────────────────
console.log('\n[4] 뱃머리 야드각 (0=동 90=남 180=서 270=북)');
const { bows, matched, found } = bowByHull(mask, W, H, EXPECTED.map(e => ({ ...e })));
console.log(`   도형 ${found} · 짝지음 ${matched} · 방향 읽음 ${bows.size}`);
for (const [hull, b] of [...bows].sort((a, b2) => a[0].localeCompare(b2[0])))
  console.log(`     ${hull}  ${b.toFixed(0)}°`);

// 안벽 계류는 전부 서쪽, 돌핀·플로팅의 컨테이너선은 북쪽 — 실측 그대로여야 한다.
const near = (h, want) => {
  const v = bows.get(h);
  if (v === undefined) return false;
  const d = Math.abs(((v - want + 540) % 360) - 180);
  return d < 20;
};
for (const h of ['8206', '8207', '8208', '8254', '8263', '8262']) ok(near(h, 180), `${h} 뱃머리 서쪽`);
for (const h of ['8222', '8314', '8315', '8313']) ok(near(h, 270), `${h} 뱃머리 북쪽`);
ok(!bows.has('8238'), '8238 은 블록꼴이라 방향을 내지 않는다(선석 관례로 넘김)');
ok(!bows.has('8209'), '8209 도 블록꼴이라 방향을 내지 않는다');
ok(bows.size === 12, `방향을 낸 호선은 12척 (실제 ${bows.size}) — 나머지는 관례로`);

console.log(bad ? `\n❌ ${bad}건 실패` : '\n✅ 전부 통과');
process.exit(bad ? 1 : 0);
