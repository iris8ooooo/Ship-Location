/**
 * 세이프티원 3중점검 리스트를 파이어스토어에 반영한다 — 자동화의 심장부.
 *
 *   node scripts/sync-safetyone.mjs --input list.txt --dry    계획만 출력
 *   node scripts/sync-safetyone.mjs --input list.json         실제 반영
 *
 * 입력은 둘 다 받는다:
 *   - .json : [{ "hull": "8300", "loc": "2도크 > TANK > 1TANK2" }, ...]
 *             (docs/safetyone-capture.js 가 만들어 주는 파일)
 *   - 그 외 : 리스트 화면을 복사해 붙인 텍스트 파일 (관대하게 파싱)
 *
 * 반영 규칙은 src/lib/safetyone-match.mjs 에 있다. 요약:
 *   선석이 바뀐 배만 옮기고, 같은 선석이면 손대지 않고, 모르면 추측하지 않는다.
 * 이동한 배는 history 에 남겨 앱의 '최근 업데이트' 에 뜨게 하고,
 * 성공 시각은 meta/safetyone 에 기록한다(룰 배포 전이면 조용히 건너뛴다).
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, getDocs, doc, setDoc, updateDoc, addDoc } from 'firebase/firestore';
import { parseListText, planMoves, BERTH_LABEL, berthLabelAt } from '../src/lib/safetyone-match.mjs';
import { residualMedian, namedRowsFromCoords, MAX_RESIDUAL, tmToYard } from '../src/lib/yard-transform.mjs';
import { bowByHull, unpackMask, diagnose, bowFromHeading } from '../src/lib/bow-detect.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const inputPath = args[args.indexOf('--input') + 1];
if (!inputPath || args.indexOf('--input') === -1) {
  console.error('사용법: node scripts/sync-safetyone.mjs --input <list.json|list.txt> [--dry]');
  process.exit(2);
}

const raw = readFileSync(inputPath, 'utf8');
let rows, unknownLines = [];
let capture = null;
try {
  const j = JSON.parse(raw);
  capture = Array.isArray(j) ? null : j;
  rows = (Array.isArray(j) ? j : j.rows).map(r =>
    r.tmx != null || r.tmy != null
      // ★angle 을 같이 실어야 한다. 여기서 떨어뜨리면 축 판정(axisFromAngle)이
      //  값을 못 받아 **조용히 아무 일도 안 한다** — 실제로 그렇게 한 번 no-op 였다.
      ? { hull: String(r.hull), tmx: Number(r.tmx), tmy: Number(r.tmy), angle: Number(r.angle), length: Number(r.length) }
      : { hull: String(r.hull), loc: String(r.loc ?? r.위치 ?? '') });
} catch {
  ({ rows, unknownLines } = parseListText(raw));
}
if (!rows.length) {
  console.error('리스트에서 호선을 하나도 못 읽었다. 입력 파일을 확인할 것.');
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const db = getFirestore(initializeApp(cfg), cfg.firestoreDatabaseId);
// 웹 SDK 는 FIRESTORE_EMULATOR_HOST 를 무시한다 — 직접 연결해 줘야
// 테스트가 프로덕션을 건드리는 사고가 없다.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  console.log(`(에뮬레이터 ${host}:${port} 에 연결)`);
}
const live = new Map();
(await getDocs(collection(db, 'ships'))).forEach(d => live.set(d.id, d.data()));

// ── 좌표 수집이면 선석 이름으로 바꾼다 ──────────────────────────────────
// 세이프티원 배 레이어는 선석 이름을 주지 않는다. 실좌표(TM)를 우리 야드 좌표로 옮기고,
// 그 자리가 어느 선석인지는 지도에서 배가 실제로 서는 자리(BERTH_SLOTS)로 판정한다.
if (capture?.kind === 'coords') {
  // ★박아 둔 변환식이 아직 맞는지 먼저 잰다. 도면을 다시 그렸거나 세이프티원이 좌표계를
  //  바꿨으면 여기서 걸린다 — 어긋난 변환으로 배를 옮기는 것이 이 프로젝트의 가장 큰 사고였다.
  const q = residualMedian(rows, live);
  console.log(`변환식 검증 — 짝지은 배 ${q.n}척 · 잔차 중앙값 ${q.median.toFixed(1)}px (허용 ${MAX_RESIDUAL}px)`);
  // 짝이 몇 척뿐이면 중앙값에 의미가 없다 — 우연히 맞은 한 척으로 변환식 전체를 승인하게 된다.
  if (q.n < 8 || !(q.median <= MAX_RESIDUAL)) {
    console.error('변환식이 지금 지도와 안 맞는다. 아무것도 쓰지 않는다.');
    console.error('sync-safetyone.yml 을 mode=fit 으로 돌려 계수를 다시 재고 yard-transform.mjs 를 고칠 것.');
    process.exit(1);
  }
  const named = namedRowsFromCoords(rows, live);

  // ★뱃머리는 **그림**에서 읽는다 (2026-08-30). 배 레이어의 angle 은 축밖에 말하지 않지만
  //  지도는 선수를 둥글게 · 선미를 네모나게 그린다. 캔버스를 못 받았거나 못 읽으면
  //  조용히 넘어간다 — 위치 수집이 뱃머리 때문에 멈출 이유는 없다.
  const cands = (capture?.canvasMasks ?? []).filter(m => m.bits);
  if (cands.length) {
    // 길이 검사가 동작하려면 세이프티원 length 를 같이 넘겨야 한다 — 조각을 배로
    // 착각해 반대 방향을 쓰는 것을 막는 유일한 장치다.
    const expected = rows
      .map(r => ({ hull: r.hull, length: r.length, ...(tmToYard(r.tmx, r.tmy) || {}) }))
      .filter(e => Number.isFinite(e.x));

    // ★여러 장을 합친다. 확대해서 구역별로 뜨므로 한 장에는 일부만 보인다.
    //  두 장이 **서로 다른 방향**을 말하면 둘 다 버린다 — 어느 쪽이 맞는지 모르는데
    //  하나를 고르면 그게 곧 조용한 오답이다.
    const seen = new Map();
    for (const m of cands) {
      const got = bowByHull(unpackMask(m.bits, m.w * m.h), m.w, m.h, expected);
      console.log(`뱃머리 [${m.at ?? '?'} z${m.zoom ?? 0}] ${m.w}x${m.h} — 도형 ${got.found}` +
        ` · 붙임 ${got.matched} · 방향 ${got.bows.size} · 축척 ${got.scale ?? '-'}`);
      // ★도형이 적으면 **왜** 적은지가 남아야 한다. run 29 는 "도형 0" 만 찍고 끝나서
      //  너무 확대해 덩어리가 커진 건지, 배가 화면 밖으로 나간 건지 알 수 없었다.
      //  덩어리 크기 분포를 z0 과 나란히 놓으면 한 노치가 몇 배인지까지 드러난다.
      if (got.found < 4) {
        const d = diagnose(unpackMask(m.bits, m.w * m.h), m.w, m.h);
        console.log(`   진단 — 덩어리 ${d.덩어리} · 크기별 ${JSON.stringify(d.크기별)}` +
          ` · 큰것 ${d.큰것10.join(' ')} · 캔버스 ${m.w * m.h}px`);
      }
      for (const r of got.rows ?? [])
        console.log(`   ${r.hull} d=${r.d} len=${r.len} wid=${r.wid} 길이비 ${r.r ?? '-'}` +
          ` tip ${r.lo}/${r.hi} → ${r.bow ?? '판정보류'}`);
      for (const [hull, b] of got.bows) {
        const prev = seen.get(hull);
        if (prev === undefined) { seen.set(hull, b); continue; }
        if (prev === null) continue;                                   // 이미 어긋난 것으로 표시됨
        const diff = Math.abs(((b - prev + 540) % 360) - 180);
        if (diff > 45) { seen.set(hull, null); console.log(`   ⚠ ${hull} 두 장이 다른 방향 — 버린다`); }
      }
    }
    let n = 0;
    for (const r of named.rows) {
      const b = seen.get(r.hull);
      if (b !== undefined && b !== null) { r.bowDeg = b; n++; }
    }
    if (n) {
      // ★사람이 보고 판단하려면 호선별 각도가 있어야 한다. "N척 읽음" 만으로는
      //  맞는지 틀린지 알 수가 없다.
      const read = [...seen].filter(([, b]) => b !== null && b !== undefined)
                            .sort((a, b) => a[0].localeCompare(b[0]));
      console.log(`뱃머리 — ${n}척 읽음, 나머지는 관례로:`);
      for (const [hull, b] of read) {
        const d = ((Math.round(b) % 360) + 360) % 360;
        const w = d < 45 || d >= 315 ? '동' : d < 135 ? '남' : d < 225 ? '서' : '북';
        console.log(`   ${hull} 뱃머리 ${d}° ${w}`);
      }
      const dropped = [...seen].filter(([, b]) => b === null).map(([h]) => h);
      if (dropped.length) console.log(`   (두 장이 어긋나 버린 호선: ${dropped.join(' ')})`);
    } else {
      console.log('뱃머리 — 한 척도 못 읽었다. 전부 관례로 간다(위치는 정상).');
    }
  } else {
    console.log('뱃머리 — 쓸 만한 지도 캔버스가 없다. 선석 관례로 간다.');
  }
  rows = named.rows;
  if (named.off.length) console.log(`⚠ 아는 선석 근처가 아니다(손 안 댐): ${named.off.join(' ')}`);
  if (named.held.length) console.log(`선석 경계라 지금 선석을 유지: ${named.held.join(' ')}`);
}

// ★안전장치: 야드에 배가 여러 척인데 **선석이 한 종류뿐**이면 그건 현실이 아니라 오독이다.
//  2026-08-29 에 실제로 그랬다 — 수집기가 배마다 다른 선석 대신 모든 레코드에 똑같이
//  들어 있는 필드를 집어 14척 전부 "1안벽" 으로 읽었고, 그대로 써서 배 8척을 옮겼다.
//  한 척도 옮기기 전에 여기서 멈춘다.
{
  const berths = new Set(rows.map(r => String(r.loc).split('>')[0].trim()));
  if (rows.length >= 5 && berths.size < 2) {
    console.error(`위치가 한 종류뿐이다 (${rows.length}척 전부 "${[...berths][0]}") — 수집이 잘못됐다. 아무것도 쓰지 않는다.`);
    process.exit(1);
  }
}

const plan = planMoves(rows, live);
const now = Date.now();

// 야드각을 사람이 읽는 방위로. 0=동 90=남 180=서 270=북 (test-bow-detect 기준).
const dir = (deg) => {
  if (!Number.isFinite(deg)) return '?';
  const d = ((Math.round(deg) % 360) + 360) % 360;
  const near = [[0, '동'], [90, '남'], [180, '서'], [270, '북'], [360, '동']]
    .reduce((a, b) => (Math.abs(b[0] - d) < Math.abs(a[0] - d) ? b : a));
  return Math.abs(near[0] - d) <= 20 ? `${d}° ${near[1]}` : `${d}°`;
};
for (const m of plan.moves) {
  const moved = Math.round(m.from.x) !== m.to.x || Math.round(m.from.y) !== m.to.y;
  // ★제자리 회전(뱃머리)이면 좌표가 아니라 **각도**가 요점이다. 그걸 보여 줘야
  //  사람이 "이 배 뱃머리가 저쪽이 맞나" 를 판단할 수 있다.
  // ★`r` 은 마커 회전각이지 뱃머리 각이 아니다(90° 차이). 반드시 변환해서 찍는다 —
  //  그대로 찍으면 위의 "읽은 뱃머리" 와 90° 어긋나 보여 사람이 오판한다.
  const turn = Number.isFinite(m.from.r) && m.from.r !== m.to.r
    ? `  뱃머리 ${dir(bowFromHeading(m.from.r))} → ${dir(bowFromHeading(m.to.r))}` : '';
  console.log(`이동  ${m.hull}  (${Math.round(m.from.x)},${Math.round(m.from.y)})` +
    ` → ${BERTH_LABEL[m.berth]} (${m.to.x},${m.to.y})${moved ? '' : ' [제자리]'}` +
    `${m.reason ? ` <${m.reason}>` : ''}${turn}`);
}
for (const c of plan.creates)
  console.log(`추가  ${c.hull}  → ${BERTH_LABEL[c.berth]} (${c.to.x},${c.to.y})`);
console.log(`그대로 ${plan.skips.length} · 시운전/출항 ${plan.sea.length} · 리스트 밖(손 안 댐) ${plan.untouched.length}`);
for (const u of plan.unknown) console.log(`⚠ 위치 해석 실패: ${u.hull} "${u.loc}"`);
for (const l of unknownLines) console.log(`⚠ 줄 해석 실패: "${l}"`);

if (dry) { console.log('\n[미리보기] 아무것도 쓰지 않았다.'); process.exit(0); }

for (const item of [...plan.moves, ...plan.creates]) {
  const cur = live.get(item.hull);
  const pos = { x: item.to.x, y: item.to.y, r: item.to.r };
  // ★berth 는 세부 선석까지(`1안벽 A선석`). 공정관리비서가 이 문자열을 그대로 찍는다.
  //  loc 은 안벽 단위로 그대로 둔다 — 다른 화면이 쓰고 있을 수 있다(2026-09-04 사용자 지시).
  const extra = { berth: berthLabelAt(item.berth, pos), loc: item.loc, syncedAt: now };
  // berth·loc·syncedAt 는 공정관리비서 연동용. 룰이 추가 필드를 막으면 좌표만 폴백.
  // 기존 배는 부분 갱신 — 통째로 갈아끼우면 좌표 밖 필드까지 건드린다.
  if (cur) {
    try { await updateDoc(doc(db, 'ships', item.hull), { ...pos, ...extra }); }
    catch { await updateDoc(doc(db, 'ships', item.hull), pos); }
  } else {
    try { await setDoc(doc(db, 'ships', item.hull), { ...pos, color: 'yellow', memo: '', ...extra }); }
    catch { await setDoc(doc(db, 'ships', item.hull), { ...pos, color: 'yellow', memo: '' }); }
  }
  await addDoc(collection(db, 'history'), {
    // 뷰어도 보는 글귀다 — 사내 화면 이름(`3중점검`) 대신 하는 일로 적는다(칩의 「위치 확인」과 같은 말).
    action: cur ? `${BERTH_LABEL[item.berth]}(으)로 이동 — 위치 확인` : `추가 — 위치 확인 ${BERTH_LABEL[item.berth]}`,
    shipId: item.hull, author: '자동수집', timestamp: now,
  }).catch(() => {});   // 기록은 최선노력 — 위치 반영이 먼저다
}

// ── 제자리 배: 확인 시각을 찍고, 선석 이름도 맞춘다 ──────────────────────
// 자리는 안 건드린다. `syncedAt` 과 (달라졌으면) `berth` 만 쓴다.
//
// ★`syncedAt` 은 「위치가 **바뀐** 시각」이 아니라 「마지막으로 **확인한** 시각」이다
//  (2026-09-05 사용자 지시). 칩 글귀를 「위치 갱신」이 아니라 「위치 확인」으로 정한 것과
//  같은 이유다 — 배가 안 움직여도 우리는 매 수집마다 그 자리에 있음을 확인한다.
//  옮기는 배에만 찍던 탓에, 6시간마다 확인하고도 공정관리비서에 「(8/30 기준)」이 붙어
//  **멀쩡히 확인된 위치가 오래된 것처럼** 보였다(실측: 23척 중 대부분이 5~6일째로 표시).
//  「언제 옮겼나」는 이 값이 아니라 `history` 이동 기록에 있다.
//
// ★이게 없으면 한 번도 옮긴 적 없는 배는 `berth` 키가 영영 안 생긴다 — 실제로
//  8292·8300·8209 가 그랬다(x·y·color 만 있어서 공정관리비서에 "위치 미확인" 으로 떴다).
// ★이력(history)에는 안 남긴다 — 배가 움직이지 않았으므로 "이동" 이 아니다.
//  CLAUDE.md 의 "값이 안 바뀌었으면 쓰지 않는다" 는 **이력을 더럽히지 말라**는 뜻이고,
//  그건 여기서 지켜진다. 문서 쓰기 자체는 하루 20척 x 4회 = 80건으로 무료 한도의 0.4% 다.
// ★**리스트에 있는 배만** 확인으로 친다. 리스트 밖(untouched)·시운전(sea)은 손대지 않는다 —
//  안 본 배에 "확인했다" 를 찍으면 그게 바로 조용한 오답이다.
let named = 0, seen = 0;
for (const sk of plan.skips) {
  const cur = live.get(sk.hull);
  if (!cur) continue;
  const want = berthLabelAt(sk.berth, cur);
  const patch = { syncedAt: now };
  const rename = want && cur.berth !== want;
  if (rename) patch.berth = want;
  try {
    await updateDoc(doc(db, 'ships', sk.hull), patch);
    seen++;
    if (rename) { console.log(`이름  ${sk.hull}  ${cur.berth ?? '(없음)'} → ${want}`); named++; }
  } catch (e) {
    console.log(`⚠ 제자리 확인 못 씀 ${sk.hull}: ${e?.code ?? e}`);
  }
}
console.log(`제자리 확인 ${seen}건 (자리는 안 건드림)${named ? ` · 그중 선석 이름 보정 ${named}건` : ''}`);

// 수집 심장박동. 아무것도 안 바뀐 수집도 여기엔 남아야
// "3시간째 그대로" 와 "수집이 죽음" 이 구분된다.
try {
  await setDoc(doc(db, 'meta', 'safetyone'), {
    lastSuccess: now, rows: rows.length,
    moved: plan.moves.length, created: plan.creates.length, unknown: plan.unknown.length,
  });
} catch {
  console.log('(meta/safetyone 기록 실패 — firestore.rules 의 meta 항목이 아직 배포 전이다)');
}

console.log(`\n반영 완료 — 이동 ${plan.moves.length} · 추가 ${plan.creates.length}`);
process.exit(0);
