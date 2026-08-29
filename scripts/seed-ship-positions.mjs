/**
 * 세이프티원 3중점검 도면에서 읽은 호선 위치를 파이어스토어에 써넣는다.
 *
 * 지도가 1380x840 좌표계로 바뀌면서 저장돼 있던 좌표가 전부 무효가 됐다.
 * docs/reference/ship-placement.json 은 그 도면에서 배 도형을 검출하고
 * 호선번호를 읽어 새 좌표계로 옮긴 결과다(2026-08-28 화면 기준).
 *
 *   node scripts/seed-ship-positions.mjs --dry     무엇이 바뀌는지만 출력
 *   node scripts/seed-ship-positions.mjs           실제로 쓴다
 *
 * 기존 문서의 color·memo 는 건드리지 않고 x·y·r 만 갱신한다.
 * 목록에 없는 호선은 손대지 않는다 — 지우지도 옮기지도 않는다.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const placement = JSON.parse(readFileSync(new URL('../docs/reference/ship-placement.json', import.meta.url)));
const dry = process.argv.includes('--dry');

const db = getFirestore(initializeApp(cfg), cfg.firestoreDatabaseId);
const live = new Map();
(await getDocs(collection(db, 'ships'))).forEach(d => live.set(d.id, d.data()));

let moved = 0, added = 0;
for (const s of placement) {
  const cur = live.get(s.hull);
  const next = { ...(cur ?? { color: 'yellow', memo: '' }), x: s.x, y: s.y, r: s.r };
  const how = cur
    ? `이동  ${s.hull}  (${Math.round(cur.x)},${Math.round(cur.y)},${cur.r}) → (${s.x},${s.y},${s.r})`
    : `추가  ${s.hull}  (${s.x},${s.y},${s.r})`;
  console.log(`  ${how.padEnd(46)} ${s.berth}`);
  if (!dry) await setDoc(doc(db, 'ships', s.hull), next);
  cur ? moved++ : added++;
}

const untouched = [...live.keys()].filter(id => !placement.some(s => s.hull === id));
console.log(`\n${dry ? '[미리보기] ' : ''}이동 ${moved} · 추가 ${added}`);
if (untouched.length) {
  console.log(`손대지 않음 ${untouched.length}: ${untouched.join(', ')}`);
  console.log('  → 이번 도면 판독에 없던 호선이다. 옛 좌표 그대로라 엉뚱한 자리에 뜬다.');
}
process.exit(0);
