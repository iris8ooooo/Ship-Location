/**
 * 그림에서 읽은 뱃머리가 **실제 배치 계획까지** 흘러가는지 본다.
 * 앞 단계(bow-detect)는 test-bow-detect.mjs 가 본다. 여기는 그 뒤 — planMoves 다.
 *   node scripts/test-bow-plan.mjs
 */
import { planMoves, shipHeading } from '../src/lib/safetyone-match.mjs';
import { headingFromBow } from '../src/lib/bow-detect.mjs';
import { axisFromAngle } from '../src/lib/yard-transform.mjs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) bad++; };

console.log('\n[1] headingFromBow — 잰 각을 축 위의 두 값 중 하나로');
ok(headingFromBow(180, 90) === 270, '뱃머리 서쪽 + 가로축 → r 270');
ok(headingFromBow(0,   90) === 90,  '뱃머리 동쪽 + 가로축 → r 90');
ok(headingFromBow(270, 0)  === 0,   '뱃머리 북쪽 + 세로축 → r 0');
ok(headingFromBow(90,  0)  === 180, '뱃머리 남쪽 + 세로축 → r 180');
// 도면은 26.7° 기울어 그려진다. 그래도 축에 정확히 붙어야 한다.
ok(headingFromBow(182, 90) === 270, '182° 처럼 비스듬해도 축에 정확히 스냅 (270)');
ok(headingFromBow(272, 0)  === 0,   '272° → r 0');

console.log('\n[2] shipHeading — 잰 값이 사람 손보다 세다');
ok(shipHeading(90, 90, 90, 180) === 270, '관리자가 90 이어도 그림이 서쪽이라 하면 270');
ok(shipHeading(270, 90, 90, 0)  === 90,  '반대도 마찬가지 — 그림이 이긴다');
ok(shipHeading(270, 90, 90, undefined) === 270, '블록이라 못 읽으면 사람이 정한 270 이 산다');
ok(shipHeading(270, 90, 90, null) === 270, 'null 도 같다');

console.log('\n[3] 실야드 — 도면에서 읽은 12척 방향을 계획에 태운다');
// test-bow-detect 가 실제 PNG 에서 뽑은 값 그대로.
const BOW = { '8206':182,'8207':182,'8208':182,'8254':182,'8262':182,'8263':182,
              '8203':92,'8282':92,'8222':272,'8313':272,'8314':272,'8315':272 };
// 지금 지도(=수집 전). 안벽은 전부 r 90, 돌핀·플로팅은 전부 r 0 으로 박혀 있었다.
const LIVE = { '8206':[85,554,90],'8207':[250,560,90],'8208':[251,583,90],'8254':[545,570,90],
               '8262':[765,601,90],'8263':[766,578,90],'8203':[216,713,0],'8282':[184,715,0],
               '8222':[146,705,0],'8313':[1002,670,0],'8314':[604,703,0],'8315':[626,703,0] };
const ANG = { '8206':0,'8207':0,'8208':0,'8254':0,'8262':0,'8263':0,
              '8203':-90,'8282':-90,'8222':-90,'8313':-90,'8314':-90,'8315':-90 };
const BERTH = { '8206':'2안벽','8207':'2안벽','8208':'2안벽','8254':'1안벽','8262':'1안벽','8263':'1안벽',
                '8203':'2돌핀','8282':'2돌핀','8222':'2돌핀','8313':'플로팅','8314':'1돌핀','8315':'1돌핀' };

const live = new Map(Object.entries(LIVE).map(([h, [x, y, r]]) => [h, { x, y, r }]));
const rows = Object.keys(BOW).map(h => ({
  hull: h, loc: BERTH[h], at: { x: LIVE[h][0], y: LIVE[h][1] },
  axisR: axisFromAngle(ANG[h]), bowDeg: BOW[h],
}));
const plan = planMoves(rows, live);
const turns = plan.moves.filter(m => m.reason === '뱃머리');
console.log(`   이동 ${plan.moves.length} (뱃머리 ${turns.length}) · 그대로 ${plan.skips.length}`);
for (const m of turns) console.log(`     ${m.hull}  r ${live.get(m.hull).r} → ${m.to.r}`);

ok(plan.moves.every(m => m.reason === '뱃머리'), '전부 제자리 회전 — 좌표는 안 건드린다');
ok(turns.length === 8, `뒤집힌 배 8척 — 12척 중 4척(8222·8313·8314·8315)은 이미 맞다 (실제 ${turns.length})`);
// 안벽 6척은 서쪽(272 아님) → r 270. 8203·8282 는 남쪽 → r 180.
for (const h of ['8206','8207','8208','8254','8262','8263'])
  ok(plan.moves.find(m => m.hull === h)?.to.r === 270, `${h} r 90 → 270 (뱃머리 서쪽)`);
for (const h of ['8203','8282'])
  ok(plan.moves.find(m => m.hull === h)?.to.r === 180, `${h} r 0 → 180 (뱃머리 남쪽)`);
for (const h of ['8222','8313','8314','8315'])
  ok(plan.skips.some(s => s.hull === h), `${h} 는 이미 r 0 = 북쪽이라 그대로`);

console.log('\n[4] 멱등 — 반영한 뒤 다시 돌리면 이동 0');
const live2 = new Map(live);
for (const m of plan.moves) live2.set(m.hull, { x: m.to.x, y: m.to.y, r: m.to.r });
const plan2 = planMoves(rows, live2);
ok(plan2.moves.length === 0, `두 번째 이동 0 (실제 ${plan2.moves.length})`);

console.log('\n[5] 블록은 손대지 않는다');
const live3 = new Map([['8238', { x: 966, y: 484, r: 180 }]]);   // 관리자가 180 으로 돌려둠
const plan3 = planMoves([{ hull: '8238', loc: '1BERTH', at: { x: 981, y: 480 },
                           axisR: axisFromAngle(270) }], live3);   // bowDeg 없음
ok(plan3.moves.length === 0, '방향을 못 읽은 배는 사람이 정한 180 을 그대로 둔다');

console.log(bad ? `\n❌ ${bad}건 실패` : '\n✅ 전부 통과');
process.exit(bad ? 1 : 0);
