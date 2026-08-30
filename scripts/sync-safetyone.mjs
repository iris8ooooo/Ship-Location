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
import { parseListText, planMoves, BERTH_LABEL } from '../src/lib/safetyone-match.mjs';
import { residualMedian, namedRowsFromCoords, MAX_RESIDUAL, tmToYard } from '../src/lib/yard-transform.mjs';
import { bowByHull, unpackMask } from '../src/lib/bow-detect.mjs';

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
      ? { hull: String(r.hull), tmx: Number(r.tmx), tmy: Number(r.tmy), angle: Number(r.angle) }
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
    const expected = rows
      .map(r => ({ hull: r.hull, ...(tmToYard(r.tmx, r.tmy) || {}) }))
      .filter(e => Number.isFinite(e.x));
    // ★어느 겹이 배 레이어인지 세어 보고 고른다. 화면 구조를 추측하지 않는다.
    let best = null;
    for (const m of cands) {
      const got = bowByHull(unpackMask(m.bits, m.w * m.h), m.w, m.h, expected);
      console.log(`뱃머리 후보 ${m.w}x${m.h} — 도형 ${got.found} · 붙임 ${got.matched} · 방향 ${got.bows.size}`);
      if (!best || got.bows.size > best.bows.size) best = got;
    }
    for (const r of named.rows) {
      const b = best.bows.get(r.hull);
      if (b !== undefined) r.bowDeg = b;
    }
    console.log(best.bows.size
      ? `뱃머리 — ${best.bows.size}척 읽음, 나머지는 관례로`
      : '뱃머리 — 한 척도 못 읽었다. 전부 관례로 간다(위치는 정상).');
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

for (const m of plan.moves)
  console.log(`이동  ${m.hull}  (${Math.round(m.from.x)},${Math.round(m.from.y)}) → ${BERTH_LABEL[m.berth]} (${m.to.x},${m.to.y})`);
for (const c of plan.creates)
  console.log(`추가  ${c.hull}  → ${BERTH_LABEL[c.berth]} (${c.to.x},${c.to.y})`);
console.log(`그대로 ${plan.skips.length} · 시운전/출항 ${plan.sea.length} · 리스트 밖(손 안 댐) ${plan.untouched.length}`);
for (const u of plan.unknown) console.log(`⚠ 위치 해석 실패: ${u.hull} "${u.loc}"`);
for (const l of unknownLines) console.log(`⚠ 줄 해석 실패: "${l}"`);

if (dry) { console.log('\n[미리보기] 아무것도 쓰지 않았다.'); process.exit(0); }

for (const item of [...plan.moves, ...plan.creates]) {
  const cur = live.get(item.hull);
  const pos = { x: item.to.x, y: item.to.y, r: item.to.r };
  const extra = { berth: BERTH_LABEL[item.berth], loc: item.loc, syncedAt: now };
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
    action: cur ? `${BERTH_LABEL[item.berth]}(으)로 이동 — 3중점검` : `추가 — 3중점검 ${BERTH_LABEL[item.berth]}`,
    shipId: item.hull, author: '자동수집', timestamp: now,
  }).catch(() => {});   // 기록은 최선노력 — 위치 반영이 먼저다
}

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
