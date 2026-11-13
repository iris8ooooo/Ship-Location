/**
 * 실좌표 배치 회귀 테스트 — **실제 프로덕션 스냅샷**으로 실제 코드를 그대로 돌린다.
 *
 *   node scripts/test-plan-coords.mjs
 *
 * 2026-11-13: 수집은 매번 초록불이었는데 지도는 **24척 중 10척이 틀린 자리**였다.
 *  · 같은 선석 안에서 옮긴 배는 영영 안 따라갔다(「선석이 같으면 안 옮긴다」)
 *  · 리스트에서 빠진 배 6척이 자리를 차지해, 새로 온 배 2척이 빈 바다 「대기」로 밀렸다
 *  · 그 2척은 수집마다 「대기 → 대기」로 다시 써져 이력에 하루 두 번씩 헛줄이 쌓였다
 * 픽스처(`fixtures/yard-2026-11-13.json`)가 바로 그날의 지도와 그날의 수집이다.
 */
import { readFileSync } from 'node:fs';
import { planByCoords, absentHulls, labelsHidden, berthLabelAt, SAME_SPOT_PX, LABEL_W }
  from '../src/lib/safetyone-match.mjs';
import { TM_TO_YARD, tmToYard, namedRowsFromCoords } from '../src/lib/yard-transform.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); c ? pass++ : fail++; };

// 야드 좌표 → TM. 수집이 실제로 받는 것은 TM 이므로, 변환부터 이름 붙이기까지
// **수집과 같은 길**을 태우려면 역변환이 있어야 한다.
const T = TM_TO_YARD, det = T.a * T.e - T.b * T.d;
const yardToTm = (x, y) => {
  const X = x - T.c, Y = y - T.f;
  return { tmx: (T.e * X - T.b * Y) / det, tmy: (-T.d * X + T.a * Y) / det };
};
{ const t = yardToTm(500, 500), b = tmToYard(t.tmx, t.tmy);
  ok(Math.hypot(b.x - 500, b.y - 500) < 0.01, '역변환 왕복 오차 0 (이게 틀리면 아래 전부 무의미하다)'); }

const fx = JSON.parse(readFileSync(new URL('./fixtures/yard-2026-11-13.json', import.meta.url), 'utf8'));
const REAL = new Map(fx.seen.map(s => [s.hull, s]));

/** 수집 한 번: seen(야드 좌표) → TM → 이름 붙이기 → 계획. 스크립트가 하는 그대로다. */
function collect(seen, live) {
  const named = namedRowsFromCoords(
    seen.map(s => ({ hull: s.hull, ...yardToTm(s.x, s.y), angle: s.angle })), live);
  for (const r of named.rows) { const b = seen.find(s => s.hull === r.hull)?.bowDeg; if (b != null) r.bowDeg = b; }
  return { plan: planByCoords(named.rows, live), named };
}
/** 계획을 지도에 반영한 다음 상태. */
function apply(plan, live, now = 2) {
  const next = new Map([...live].map(([h, s]) => [h, { ...s }]));
  for (const it of [...plan.moves, ...plan.creates])
    next.set(it.hull, { ...(next.get(it.hull) ?? {}), ...it.to, syncedAt: now });
  for (const sk of plan.skips) next.get(sk.hull).syncedAt = now;
  return next;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const live0 = new Map(Object.entries(fx.live));

console.log('\n[1] 그날의 지도 — 고치기 전에 얼마나 틀려 있었나 (픽스처가 그 증거다)');
{
  const wrong = fx.seen.filter(s => dist(live0.get(s.hull), s) > SAME_SPOT_PX);
  console.log(`     ${wrong.map(s => `${s.hull}:${Math.round(dist(live0.get(s.hull), s))}px`).join(' ')}`);
  ok(wrong.length === 10, `리스트 24척 중 ${wrong.length}척이 실제 자리에서 ${SAME_SPOT_PX}px 넘게 떨어져 있었다`);
  ok(live0.get('8206').berth === '대기' && live0.get('8292').berth === '대기',
     '8206·8292 는 「대기」(빈 바다)에 있었다 — 공정관리비서에 배송지로 그대로 나간 글자');
  ok(live0.get('8323').berth === '2안벽 B선석', '8323 은 B선석으로 적혀 있었다 (실제는 A선석)');
}

const { plan, named } = collect(fx.seen, live0);
const live1 = apply(plan, live0);

console.log('\n[2] ★전부 실제 자리로 간다');
{
  const far = fx.seen.filter(s => dist(live1.get(s.hull), s) > SAME_SPOT_PX);
  ok(far.length === 0, `반영 뒤 24척 전부 실제 자리에서 ${SAME_SPOT_PX}px 안 (벗어난 배 ${far.map(s => s.hull).join(' ') || '없음'})`);
  ok(![...plan.moves, ...plan.creates].some(m => m.berth === 'waiting' || m.to.y >= 760),
     '아무도 「대기」로 가지 않는다');
  const to = (h) => plan.moves.find(m => m.hull === h);
  ok(to('8206') && berthLabelAt(to('8206').berth, to('8206').to) === '플로팅', `8206 → ${berthLabelAt(to('8206')?.berth, to('8206')?.to)}`);
  ok(to('8292') && berthLabelAt(to('8292').berth, to('8292').to) === '1돌핀', `8292 → ${berthLabelAt(to('8292')?.berth, to('8292')?.to)}`);
  ok(to('8323') && berthLabelAt(to('8323').berth, to('8323').to) === '2안벽 A선석',
     `8323 → ${berthLabelAt(to('8323')?.berth, to('8323')?.to)} (같은 선석 id 안에서도 따라간다)`);
  for (const h of ['8293', '8301', '8316', '8255'])
    // 번호 칸(18px) 안이면 실제 자리다 — 옆 배와 번호가 겹치면 그만큼은 비켜 선다(8301 이 2px).
    ok(to(h) && dist(to(h).to, REAL.get(h)) <= LABEL_W, `${h} 도크·선석 안에서 실제 자리로 (${to(h)?.to.x},${to(h)?.to.y})`);
  ok(plan.unknown.length === 0 && named.off.length === 0, '해석 못 한 배 없음');
}

console.log('\n[3] ★떠난 배는 자리를 차지하지 않는다 — 지우지도 않는다');
{
  ok(JSON.stringify(plan.absent) === JSON.stringify(['8208', '8222', '8265', '8282', '8314', '8315']),
     `명단에 없는 6척을 지도에서 내린다 (${plan.absent.join(' ')})`);
  ok(plan.untouched.length === 0, '손으로 놓은 배(확인 시각 없는 배)는 이날 없었다');
  ok(plan.absent.every(h => live1.has(h) && live1.get(h).x === live0.get(h).x),
     '문서는 그대로다 — 계획이 그 배들을 건드리지 않는다');
  // 그 배들이 그대로 장애물이었다면 8206·8292 는 제 자리에 못 선다(실제로 그랬다).
  ok(labelsHidden({ ...live0.get('8314') }, { x: 626, y: 710, r: 0 }),
     '8292 의 실제 자리는 떠난 8314 의 옛 자리와 겹친다 — 그래서 예전엔 못 들어갔다');
}

console.log('\n[4] 번호가 가려지지 않는다 — 멀리 안 가고 옆으로 조금만 비킨다');
{
  const vis = [...live1].filter(([h]) => !plan.absent.includes(h));
  const hidden = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++)
    if (labelsHidden(vis[i][1], vis[j][1])) hidden.push(`${vis[i][0]}/${vis[j][0]}`);
  ok(hidden.length === 0, `보이는 24척 중 번호가 겹치는 쌍 없음 (${hidden.join(' ') || '0'})`);
  // 8248 과 8247 은 실제로 16px 떨어져 나란히 붙어 있다(번호 칸은 18px).
  const m = plan.moves.find(x => x.hull === '8248');
  ok(m && dist(m.to, REAL.get('8248')) <= LABEL_W, `8248 은 실제 자리에서 ${dist(m.to, REAL.get('8248')).toFixed(1)}px 만 비켰다`);
  ok(!plan.moves.some(x => x.crowded), '비켜 설 데가 없어 겹친 채 놓인 배 없음');
  // ★새로 놓은 배는 옆 배와 **선체 폭(26px)** 만큼 띄운다. 번호 칸(18px)만 띄우면 선체가
  //  포개져 두 척의 숫자가 한 덩어리로 읽힌다(렌더해서 본 것: 8248·8247 이 「88/22/44/87」).
  const HULL_W = 26, moved = new Set(plan.moves.map(x => x.hull)), touching = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++)
    if ((moved.has(vis[i][0]) || moved.has(vis[j][0])) && labelsHidden(vis[i][1], vis[j][1], HULL_W))
      touching.push(`${vis[i][0]}/${vis[j][0]}`);
  ok(touching.length === 0, `옮긴 배 가운데 옆 배와 선체가 포개진 쌍 없음 (${touching.join(' ') || '0'})`);
  for (const h of ['8248', '8301', '8293']) {
    const mv = plan.moves.find(x => x.hull === h);
    ok(mv && dist(mv.to, REAL.get(h)) <= 12.7, `${h} 은 그러느라 실제 자리에서 ${dist(mv.to, REAL.get(h)).toFixed(1)}px — 좌표 오차(RMS 12.7px) 안`);
  }
}

console.log('\n[5] 손으로 다듬은 자리는 지킨다 · 안 움직인 배는 안 건드린다');
{
  // 8300 은 관리자가 끌어다 놓은 자리(132.07, 710.68)다. 실제 자리와 18px — 오차 범위 안이다.
  ok(plan.skips.some(s => s.hull === '8300') && live1.get('8300').x === live0.get('8300').x,
     `8300 은 그대로 (실제 자리와 ${dist(live0.get('8300'), REAL.get('8300')).toFixed(1)}px)`);
  const still = fx.seen.filter(s => dist(live0.get(s.hull), s) <= SAME_SPOT_PX).map(s => s.hull);
  ok(still.every(h => live1.get(h).x === live0.get(h).x && live1.get(h).y === live0.get(h).y),
     `제자리였던 ${still.length}척은 좌표가 한 픽셀도 안 바뀐다`);
}

console.log('\n[6] ★멱등 — 같은 수집을 다시 돌리면 이동 0 (이력에 헛줄이 안 쌓인다)');
{
  const again = collect(fx.seen, live1).plan;
  ok(again.moves.length === 0 && again.creates.length === 0,
     `두 번째 이동 ${again.moves.length} · 추가 ${again.creates.length}`);
  ok(again.skips.length === 24, `그대로 ${again.skips.length}`);
  const third = collect(fx.seen, apply(again, live1, 3)).plan;
  ok(third.moves.length === 0, '세 번째도 0');
}

console.log('\n[7] 떠났던 배가 돌아오면 그 순간 다시 놓인다');
{
  const back = [...fx.seen, { hull: '8208', x: 251, y: 606, angle: 0 }];
  const p = collect(back, live1).plan;
  const m = p.moves.find(x => x.hull === '8208');
  ok(m && Math.abs(m.to.x - 251) < 2 && !p.absent.includes('8208'),
     `8208 이 명단에 다시 나오면 실제 자리(${m?.to.x},${m?.to.y})로 — 새로 만들지 않고 옮긴다`);
}

console.log('\n[8] 아는 선석 밖 · 지도 밖');
{
  // 선석 이름은 모르지만 자리는 안다 → 이름 없이 놓는다(예전에는 「손 안 댐」으로 옛 자리에 남았다).
  const sea = collect([...fx.seen.filter(s => s.hull !== '8209'), { hull: '8209', x: 700, y: 790, angle: 0 }], live1);
  const m = sea.plan.moves.find(x => x.hull === '8209');
  ok(sea.named.off.includes('8209') && m && m.to.x === 700 && m.to.y === 790 && m.berth == null,
     '빈 바다에 뜬 배 → 실제 자리에, 선석 이름은 비워서 (지어내지 않는다)');
  // 지도 밖 좌표는 그릴 데가 없다 → 옮기지 않고 보고한다.
  const out = collect([...fx.seen.filter(s => s.hull !== '8209'), { hull: '8209', x: 1700, y: 300, angle: 0 }], live1);
  ok(out.plan.unknown.some(u => u.hull === '8209') && !out.plan.moves.some(x => x.hull === '8209'),
     '지도 밖 좌표 → 해석 실패로 보고, 옮기지 않는다');
}

console.log('\n[9] 손으로 놓은 배(확인 시각 없음)는 그대로 두고, 그 위에 겹쳐 놓지도 않는다');
{
  const live = new Map([['9001', { x: 966, y: 640, r: 0 }]]);          // 관리자가 놓음 — syncedAt 없음
  const p = collect([{ hull: '9002', x: 966, y: 640, angle: -90 }], live).plan;
  ok(p.untouched.includes('9001') && p.absent.length === 0, '확인 시각이 없으면 「떠난 배」로 치지 않는다');
  const c = p.creates.find(x => x.hull === '9002');
  ok(c && c.to.y === 640 && Math.abs(c.to.x - 966) === 26 && !labelsHidden(live.get('9001'), c.to, 26),
     `새 배는 옆으로 ${Math.abs(c.to.x - 966)}px(선체 폭) 비켜 선다 (대기열로 안 간다)`);
}

console.log('\n[10] absentHulls — 못 읽은 것을 「다 떠났다」로 읽지 않는다');
{
  const ships = { '8001': { x: 1, y: 1, syncedAt: 5 }, '8002': { x: 2, y: 2, syncedAt: 5 }, '8003': { x: 3, y: 3 } };
  ok(absentHulls(ships, null).size === 0, '명단이 없으면 아무도 안 숨긴다');
  ok(absentHulls(ships, []).size === 0, '빈 명단도 안 숨긴다');
  ok(absentHulls(ships, undefined).size === 0, 'undefined 도 안 숨긴다');
  const a = absentHulls(ships, ['8001']);
  ok(a.has('8002') && !a.has('8001'), '명단에 없고 확인 시각이 있는 배만 숨긴다');
  ok(!a.has('8003'), '확인 시각이 없는 배(손으로 놓은 배)는 명단에 없어도 보인다');
  ok(absentHulls(new Map(Object.entries(ships)), ['8001']).has('8002'), 'Map 으로 줘도 같다');
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
