/**
 * 선석 이름 표기 회귀 테스트.
 *
 * 2026-09-04: `berth` 가 `1안벽` 까지만 오던 것을 `1안벽 A선석` 까지 적게 바꿨다.
 * 세이프티원은 선석 이름을 주지 않으므로(배 레이어에 그 필드가 없다) **좌표로 역산**한다.
 *
 * ★여기서 깨지면 공정관리비서의 위치 배지와 자재 통보 배송지 문안이 같이 틀린다.
 *  그쪽은 이 문자열을 **그대로 찍는다** — 잘못된 선석이 그대로 현장에 나간다.
 */
import { BERTH_LABEL, BERTH_SLOTS, berthLabelAt, quaySplits, berthOfPos } from '../src/lib/safetyone-match.mjs';

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (!c) fail++; };

console.log('[1] 경계는 슬롯 표에서 자동으로 나온다');
const sp = quaySplits();
console.log(`     ${JSON.stringify(sp)}`);
for (const id of ['quay1', 'quay2']) {
  // 슬롯이 두 무리로 갈리고, 그 사이가 좌표계 최대 오차(23.4px)보다 훨씬 넓어야 한다.
  ok(sp[id].gap > 100, `${id}: 두 선석 사이가 ${sp[id].gap}px — 오차 23.4px 로는 못 뒤집는다`);
}

console.log('\n[2] 모든 슬롯이 자기 선석으로 분류된다');
for (const id of ['quay1', 'quay2']) {
  const xs = [...new Set(BERTH_SLOTS[id].map(s => s.x))].sort((a, b) => a - b);
  const got = xs.map(x => `${x}:${berthLabelAt(id, { x }).slice(-3, -2)}`);
  // 서쪽 절반은 B, 동쪽 절반은 A — 섞이면 안 된다.
  const letters = xs.map(x => berthLabelAt(id, { x }).slice(-3, -2));
  const flipped = letters.indexOf('A');
  ok(flipped > 0 && !letters.slice(flipped).includes('B'),
    `${id}: 서→동으로 B…B A…A 순서 (${got.join(' ')})`);
}

console.log('\n[3] A 는 동쪽(오른쪽)이다');
ok(berthLabelAt('quay1', { x: 830 }) === '1안벽 A선석', `1안벽 동쪽 끝(830) → ${berthLabelAt('quay1', { x: 830 })}`);
ok(berthLabelAt('quay1', { x: 500 }) === '1안벽 B선석', `1안벽 서쪽 끝(500) → ${berthLabelAt('quay1', { x: 500 })}`);
ok(berthLabelAt('quay2', { x: 290 }) === '2안벽 A선석', `2안벽 동쪽 끝(290) → ${berthLabelAt('quay2', { x: 290 })}`);
ok(berthLabelAt('quay2', { x: 75 })  === '2안벽 B선석', `2안벽 서쪽 끝(75)  → ${berthLabelAt('quay2', { x: 75 })}`);

console.log('\n[4] 안벽이 아닌 곳은 예전 그대로다 — 없는 선석을 지어내지 않는다');
for (const id of ['dock1', 'dock2', 'dolphin1', 'dolphin2', 'floating', 'berth1', 'waiting']) {
  const s = BERTH_SLOTS[id][0];
  ok(berthLabelAt(id, s) === BERTH_LABEL[id], `${id} → ${berthLabelAt(id, s)}`);
}

console.log('\n[5] 좌표가 없으면 안벽 단위로 물러난다 (거짓 선석을 만들지 않는다)');
ok(berthLabelAt('quay1', null) === '1안벽', `pos 없음 → ${berthLabelAt('quay1', null)}`);
ok(berthLabelAt('quay1', {}) === '1안벽', `x 없음 → ${berthLabelAt('quay1', {})}`);
ok(berthLabelAt('quay1', { x: 'abc' }) === '1안벽', `x 가 숫자가 아님 → ${berthLabelAt('quay1', { x: 'abc' })}`);

console.log('\n[6] ★선석 id 는 안 쪼갠다 — "선석이 같으면 안 옮긴다" 가 살아 있어야 한다');
// A 자리와 B 자리 둘 다 berthOfPos 로는 같은 quay1 이어야 한다.
// 여기가 깨지면 A↔B 를 넘나들 때마다 배를 옮기게 된다.
ok(berthOfPos({ x: 777, y: 574 }) === 'quay1', '1안벽 A 자리 → quay1');
ok(berthOfPos({ x: 549, y: 569 }) === 'quay1', '1안벽 B 자리 → quay1');
ok(berthOfPos({ x: 245, y: 563 }) === 'quay2', '2안벽 A 자리 → quay2');
ok(berthOfPos({ x: 75,  y: 560 }) === 'quay2', '2안벽 B 자리 → quay2');

console.log('\n[7] 프로덕션 실좌표(2026-09-04)가 현장과 맞는가');
for (const [hull, x, want] of [
  ['8206', 75, '2안벽 B선석'], ['8265', 75, '2안벽 B선석'],
  ['8207', 245, '2안벽 A선석'], ['8208', 246, '2안벽 A선석'],
  ['8254', 549, '1안벽 B선석'], ['8246', 552, '1안벽 B선석'],
  ['8262', 775, '1안벽 A선석'], ['8263', 777, '1안벽 A선석'],
]) {
  const id = x < 400 ? 'quay2' : 'quay1';
  ok(berthLabelAt(id, { x }) === want, `${hull} (x=${x}) → ${berthLabelAt(id, { x })}`);
}

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
