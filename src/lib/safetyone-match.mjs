/**
 * 세이프티원 3중점검 리스트 → 십로케이션 좌표 매칭 엔진.
 *
 * 입력은 "호선번호 + 위치 문자열" 목록이고(예: 8300 / "2도크 > TANK > 1TANK2"),
 * 출력은 파이어스토어에 반영할 이동/추가 계획이다. 앱의 붙여넣기 반영과
 * scripts/sync-safetyone.mjs 가 같은 로직을 쓰도록 순수 ESM 으로 둔다(의존성 없음).
 *
 * 규칙 (CLAUDE.md 의 수집 원칙):
 *  - 위치의 첫 구간(2도크·1안벽…)만 본다. 그 뒤(TANK > 1TANK2)는 배 안의 작업
 *    위치라 야드 좌표와 무관하다.
 *  - 선석이 같으면 옮기지 않는다 — 리스트는 구간 안 순서를 주지 않으므로,
 *    관리자가 손으로 다듬은 자리를 매 수집마다 되돌리면 안 된다.
 *  - 선석이 바뀐 배만 그 선석의 빈 슬롯으로 옮긴다.
 *  - 리스트에 없는 호선은 손대지 않는다. 지우지도 옮기지도 않는다.
 *  - 모르는 위치 문자열은 추측하지 않고 unknown 으로 보고한다.
 */

/** 선석별 슬롯. 2026-08-28 세이프티원 도면에서 배가 실제로 서 있던 자리 + 여분.
 *  좌표계는 지도의 1380x840. r 은 마커 회전(안벽 계류는 90 = 선체가 안벽과 나란히). */
export const BERTH_SLOTS = {
  dock2:    [{ x: 360, y: 316, r: 0 }, { x: 384, y: 298, r: 0 }, { x: 360, y: 470, r: 0 }, { x: 384, y: 458, r: 0 }],
  dock1:    [{ x: 438, y: 337, r: 0 }, { x: 462, y: 337, r: 0 }, { x: 438, y: 476, r: 0 }, { x: 462, y: 476, r: 0 }],
  // 안벽은 돌핀을 사이에 두고 B(서)·A(동) 두 선석. 리스트가 A/B 를 구분해 주지
  // 않으므로 한 풀로 두고 비는 자리부터 채운다. 두 줄 계류(이중 계류) 포함.
  quay2:    [{ x: 245, y: 563, r: 90 }, { x: 75, y: 560, r: 90 }, { x: 245, y: 593, r: 90 }, { x: 75, y: 590, r: 90 },
             { x: 290, y: 563, r: 90 }, { x: 110, y: 560, r: 90 }, { x: 290, y: 593, r: 90 }, { x: 110, y: 590, r: 90 }],
  quay1:    [{ x: 777, y: 574, r: 90 }, { x: 549, y: 569, r: 90 }, { x: 777, y: 604, r: 90 }, { x: 549, y: 599, r: 90 },
             { x: 830, y: 574, r: 90 }, { x: 500, y: 569, r: 90 }, { x: 830, y: 604, r: 90 }, { x: 500, y: 599, r: 90 }],
  dolphin2: [{ x: 138, y: 704, r: 0 }, { x: 174, y: 704, r: 0 }, { x: 207, y: 704, r: 0 }, { x: 108, y: 704, r: 0 }, { x: 240, y: 704, r: 0 }],
  dolphin1: [{ x: 611, y: 707, r: 0 }, { x: 634, y: 707, r: 0 }, { x: 585, y: 707, r: 0 }, { x: 680, y: 707, r: 0 }],
  floating: [{ x: 1021, y: 707, r: 0 }, { x: 966, y: 640, r: 0 }],
  berth1:   [{ x: 966, y: 368, r: 0 }, { x: 966, y: 484, r: 0 }],
  /** 리스트에 처음 나타났는데 선석을 모르는 배를 세워 두는 대기열(빈 바다). */
  waiting:  [{ x: 60, y: 780, r: 0 }, { x: 130, y: 780, r: 0 }, { x: 200, y: 780, r: 0 }, { x: 270, y: 780, r: 0 }, { x: 340, y: 780, r: 0 }],
};

export const BERTH_LABEL = {
  dock2: '2도크', dock1: '1도크', quay2: '2안벽', quay1: '1안벽',
  dolphin2: '2돌핀', dolphin1: '1돌핀', floating: '플로팅', berth1: '1BERTH',
  waiting: '대기',
};

/** 위치 문자열 → 선석 id. 첫 구간에서 아는 이름을 찾는다. 모르면 null. */
export function berthFromLoc(loc) {
  const s = String(loc ?? '').replace(/\s+/g, '').toUpperCase();
  if (!s) return null;
  if (s.includes('2도크')) return 'dock2';
  if (s.includes('1도크')) return 'dock1';
  if (s.includes('2안벽')) return 'quay2';
  if (s.includes('1안벽')) return 'quay1';
  if (s.includes('2돌핀')) return 'dolphin2';
  if (s.includes('1돌핀')) return 'dolphin1';
  if (s.includes('플로팅') || s.includes('FLOATING')) return 'floating';
  if (s.includes('1BERTH') || s.includes('1버스')) return 'berth1';
  return null;
}

/** 시운전·출항 등 야드 밖 상태. 이 배들은 지도에서 옮기지 않는다. */
export function isSeaLoc(loc) {
  const s = String(loc ?? '').replace(/\s+/g, '');
  return /시운전|출항|해상|인도/.test(s);
}

/**
 * 리스트 화면을 복사해 붙인 텍스트 → [{hull, loc}].
 * 표 형태를 모르므로 관대하게 읽는다: 한 줄에서 8xxx 네 자리 호선번호를 찾고,
 * 같은 줄의 나머지를 위치로 본다. 위치를 못 알아본 줄은 버리지 않고 돌려준다.
 */
export function parseListText(text) {
  const rows = [];
  const unknownLines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/\b(8\d{3})\b/);
    if (!m) continue;                          // 호선번호가 없는 줄(머리글 등)
    const hull = m[1];
    const inLine = `${line.slice(0, m.index)} ${line.slice(m.index + m[0].length)}`;
    // 표를 통째로 복사하면 상태·날짜 같은 다른 칸이 탭으로 같이 붙는다.
    // 선석 이름이 든 칸만 위치로 남긴다.
    const cell = inLine.split('\t').map(s => s.trim())
      .find(seg => berthFromLoc(seg) || isSeaLoc(seg));
    if (cell) rows.push({ hull, loc: cell });
    else unknownLines.push(line);
  }
  return { rows, unknownLines };
}

const near = (a, b, d) => Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d;

/** 현재 좌표가 어느 선석인가 — 가장 가까운 슬롯 45 이내. 없으면 null. */
export function berthOfPos(pos) {
  let best = null, bestD = 45;
  for (const [id, slots] of Object.entries(BERTH_SLOTS)) {
    for (const s of slots) {
      const d = Math.max(Math.abs(pos.x - s.x), Math.abs(pos.y - s.y));
      if (d < bestD) { bestD = d; best = id; }
    }
  }
  return best;
}

/**
 * 이동 계획을 세운다.
 * @param rows  [{hull, loc, at?}] — 리스트에서 읽은 것.
 *   `at: {x, y}` 는 세이프티원 실좌표를 우리 야드 좌표로 옮긴 **실제 자리**다
 *   (src/lib/yard-transform.mjs). 있으면 슬롯 대신 그 자리에 놓는다.
 *   ★슬롯을 쓰던 이유는 "리스트가 구간 안 순서를 주지 않아서" 였다(CLAUDE.md).
 *    이제 좌표를 알므로 그 제약이 없다 — 임의의 빈 슬롯보다 실제 자리가 언제나 낫다.
 *    다만 **선석이 같으면 안 옮긴다**는 규칙은 그대로다. 관리자가 손으로 다듬은 자리를
 *    매 수집마다 12px 씩 흔들 이유가 없다.
 * @param live  Map(hull → {x, y, r, ...}) — 파이어스토어의 현재 배들
 * @returns { moves, creates, skips, sea, unknown, untouched }
 */
export function planMoves(rows, live) {
  const moves = [], creates = [], skips = [], sea = [], unknown = [];

  // 1차: 분류. 배가 옮겨 갈지부터 정해야 비는 슬롯을 알 수 있다.
  const classed = rows.map(row => {
    if (isSeaLoc(row.loc)) return { ...row, kind: 'sea' };
    const berth = berthFromLoc(row.loc);
    if (!berth) return { ...row, kind: 'unknown' };
    const cur = live.get(row.hull);
    if (cur && berthOfPos(cur) === berth) return { ...row, kind: 'skip', berth };
    return { ...row, kind: cur ? 'move' : 'create', berth, cur };
  });

  // 자리 점유: 안 움직이는 배 전부(리스트 밖 배 포함) + 이 배치에서 정한 목적지.
  const movingHulls = new Set(classed.filter(c => c.kind === 'move').map(c => c.hull));
  const occupied = [...live.entries()]
    .filter(([hull]) => !movingHulls.has(hull))
    .map(([, s]) => ({ x: s.x, y: s.y }));

  const takeSlot = (berth) => {
    for (const slot of BERTH_SLOTS[berth]) {
      if (!occupied.some(o => near(o, slot, 22))) { occupied.push({ x: slot.x, y: slot.y }); return slot; }
    }
    return null;                               // 슬롯이 다 찼다 — 대기열로 보낸다
  };

  for (const c of classed) {
    if (c.kind === 'sea') { sea.push(c); continue; }
    if (c.kind === 'unknown') { unknown.push(c); continue; }
    if (c.kind === 'skip') { skips.push(c); continue; }
    let berth = c.berth;
    let slot;
    if (c.at) {
      // 실제 자리를 안다 — 슬롯을 고를 필요가 없다. 회전만 그 선석의 관례를 따른다
      // (안벽 계류는 90, 도크·돌핀은 0). 세이프티원의 angle 은 우리 각도계와 달라 쓰지 않는다.
      slot = { x: Math.round(c.at.x), y: Math.round(c.at.y), r: BERTH_SLOTS[berth][0].r };
    } else {
      slot = takeSlot(berth);
      if (!slot) { slot = takeSlot('waiting'); berth = 'waiting'; }
    }
    if (!slot) { unknown.push({ ...c, loc: `${c.loc} (자리 없음)` }); continue; }
    const item = { hull: c.hull, loc: c.loc, berth, to: slot, from: c.cur ? { x: c.cur.x, y: c.cur.y } : null };
    (c.kind === 'move' ? moves : creates).push(item);
  }

  const seen = new Set(rows.map(r => r.hull));
  const untouched = [...live.keys()].filter(h => !seen.has(h));
  return { moves, creates, skips, sea, unknown, untouched };
}
