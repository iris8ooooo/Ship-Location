import { headingFromBow } from './bow-detect.mjs';
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

/**
 * 안벽 안에서 A(동)·B(서) 선석을 가르는 x. **슬롯 표에서 뽑는다** — 숫자를 따로
 * 박아 두면 슬롯을 늘릴 때 한쪽만 고치게 된다(이 프로젝트가 반복해서 당한 모양).
 *
 * ★세이프티원은 선석 이름을 주지 않는다. 배 레이어에 그 필드가 아예 없고 좌표만 있다
 *  (2026-08-29 확정). 그래서 A/B 는 **좌표로 역산**할 수밖에 없다.
 * ★**A 가 동쪽(오른쪽)**이고, 돌핀이 자기 안벽의 두 선석 사이에 정확히 끼어 있다.
 *  그래서 슬롯 x 를 늘어놓으면 가운데가 크게 비고, 그 빈 곳 한가운데가 경계다.
 * ★실측 여유(2026-09-04 프로덕션 21척): 2안벽 85px · 1안벽 111px.
 *  좌표계 최대 오차가 23.4px 이므로 네 배 이상 여유가 있다 — 도크(실효 경계 27px)와
 *  달리 여기서는 오차가 선석을 뒤집지 못한다.
 */
function quaySplit(id) {
  const xs = [...new Set(BERTH_SLOTS[id].map(s => s.x))].sort((a, b) => a - b);
  let at = 1, gap = -1;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap) { gap = xs[i] - xs[i - 1]; at = i; }
  }
  return { cut: (xs[at - 1] + xs[at]) / 2, gap };
}
const QUAY_SPLIT = { quay1: quaySplit('quay1'), quay2: quaySplit('quay2') };

/** 진단·테스트용. 경계가 어디로 잡혔는지 눈으로 확인할 수 있어야 한다. */
export function quaySplits() {
  return Object.fromEntries(Object.entries(QUAY_SPLIT).map(([k, v]) => [k, { ...v }]));
}

/**
 * 그 자리에 있는 배의 **표기용 선석 이름** — `1안벽 A선석` 처럼.
 * 안벽이 아니면 예전 그대로(`2도크`·`1BERTH`·`플로팅` …).
 *
 * ★선석 id(`quay1`)는 **바꾸지 않는다.** "선석이 같으면 안 옮긴다" 판정이 그 id 로
 *  돌아가므로, id 를 쪼개면 A↔B 로 넘어갈 때마다 배를 옮기게 된다. 여기서 바뀌는 것은
 *  **화면에 찍는 글자 하나**뿐이다.
 */
export function berthLabelAt(id, pos) {
  const label = BERTH_LABEL[id] ?? '';
  const split = QUAY_SPLIT[id];
  if (!split || !pos || !Number.isFinite(Number(pos.x))) return label;
  return `${label} ${Number(pos.x) >= split.cut ? 'A' : 'B'}선석`;
}

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

/**
 * 호선번호가 차지하는 칸. 선체는 26x130 인데(App.tsx `w-[26px] h-[130px]`)
 * 숫자는 그 안 88x18 에 들어간다 (CLAUDE.md 실측: "폭 26px 안에 18px,
 * 길이 130px 안에 88px").
 */
export const LABEL_W = 18, LABEL_L = 88;

/**
 * 두 배의 **호선번호가 서로 가려지는가.**
 *
 * ★"좌표가 22px 안에 있으면 가깝다" 같은 한 개짜리 문턱으로는 안 된다
 *  (2026-08-29 사용자 지적). 마커는 정사각형이 아니라 길쭉하고 회전한다.
 *  8265(83,575)와 8206(75,560)은 세로로 15px 떨어져 있어 22px 검사를 통과했지만,
 *  번호 폭이 18px 이라 숫자가 통째로 가려졌다. 반대로 길이 방향으로는 88px 까지
 *  가려지는데 22px 검사는 그걸 아예 못 본다.
 *
 * ★선체 상자(26x130)로 재면 이번엔 과하다. 1BERTH 의 8209(966,368)와
 *  8238(966,484)은 116px 떨어져 선체 끝이 14px 스치지만 번호는 멀쩡히 읽힌다 —
 *  그걸 "겹침" 으로 잡으면 멀쩡한 배를 매시간 옮기게 된다. 지켜야 하는 건
 *  선체가 아니라 **번호가 읽히는 것**이므로 번호 칸으로 잰다.
 *
 *  r 이 0/180 이면 번호가 세로로 길고, 90/270 이면 가로로 길다.
 */
export function labelsHidden(a, b) {
  const half = (p) => (((p.r ?? 0) % 180 + 180) % 180 === 0)
    ? { x: LABEL_W / 2, y: LABEL_L / 2 }
    : { x: LABEL_L / 2, y: LABEL_W / 2 };
  const A = half(a), B = half(b);
  return Math.abs(a.x - b.x) < A.x + B.x && Math.abs(a.y - b.y) < A.y + B.y;
}

/** 그 자리에서 이 선석의 가장 가까운 슬롯까지 거리(체비셰프). 선석끼리 견줄 때 쓴다. */
export function berthDist(pos, id) {
  return Math.min(...BERTH_SLOTS[id].map(s => Math.max(Math.abs(pos.x - s.x), Math.abs(pos.y - s.y))));
}

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
/**
 * 마커 회전을 정한다 — **축은 세이프티원이, 앞뒤는 사람이.**
 *
 * ★세이프티원은 선수 방향을 주지 않는다 (2026-08-29 확정).
 *  배 레이어 22개 필드 중 각도는 `angle`·`rotation` 둘뿐이고, 값은 23척에서
 *  `0` 과 `±90` **두 가지**뿐이다 — 즉 "가로로 누웠나 세로로 섰나"(축)만 말하고
 *  뱃머리가 어느 끝인지는 말하지 않는다. 원본 도면도 마찬가지다: 배를 양끝이
 *  똑같은 대칭 렌즈(8206)나 직사각형(8222)으로 그린다. 공정관리비서 Supabase
 *  `vessels`·`vessel_specs` 에도 방향 필드가 없다. **어디에도 없다.**
 *
 *  그래서 앞뒤는 사람이 지도에서 돌려 정하는 수밖에 없고, 그렇다면 수집이 그걸
 *  덮어쓰면 안 된다. 예전에는 옮길 때마다 `BERTH_SLOTS[berth][0].r` 로 되돌려서
 *  관리자가 아무리 돌려놔도 다음 이동에서 사라졌다.
 *
 * @param curR    지금 마커 회전(없으면 null)
 * @param axisR   있어야 할 축 — 0(세로) 또는 90(가로). 모르면 fallbackR 의 축을 쓴다.
 * @param fallbackR 축이 바뀌어 앞뒤를 유추할 수 없을 때 쓸 값(그 선석의 관례)
 */
export function shipHeading(curR, axisR, fallbackR, bowDeg) {
  const axis = (((axisR ?? fallbackR) % 180) + 180) % 180;
  // ★그림에서 뱃머리를 읽었으면 그게 이긴다 (2026-08-30). 사람 손보다 세다 —
  //  애초에 사람이 정하던 건 "세이프티원이 말해 주지 않아서" 였고, 이제 말해 준다.
  //  블록(양끝 네모)은 bowDeg 가 안 오므로 아래의 사람 우선 규칙이 그대로 산다.
  if (Number.isFinite(bowDeg)) return headingFromBow(bowDeg, axis);
  if (!Number.isFinite(curR)) return fallbackR;
  const cur = ((curR % 360) + 360) % 360;
  // 이미 맞는 축이면 그대로 둔다 — 사람이 고른 앞뒤를 지키는 것이 여기 전부다.
  if (cur % 180 === axis) return cur;
  // 축이 90° 바뀌면 옛 방향은 새 앞뒤에 대해 아무 정보도 주지 않는다(양쪽이 등거리).
  // 지어내지 말고 그 선석의 관례로 돌아간다.
  return fallbackR;
}

export function planMoves(rows, live) {
  const moves = [], creates = [], skips = [], sea = [], unknown = [];

  // 1차: 분류. 배가 옮겨 갈지부터 정해야 비는 슬롯을 알 수 있다.
  const classed = rows.map(row => {
    if (isSeaLoc(row.loc)) return { ...row, kind: 'sea' };
    const berth = berthFromLoc(row.loc);
    if (!berth) return { ...row, kind: 'unknown' };
    const cur = live.get(row.hull);
    if (cur && berthOfPos(cur) === berth) return { ...row, kind: 'skip', berth, cur };
    return { ...row, kind: cur ? 'move' : 'create', berth, cur };
  });

  // 자리 점유: 안 움직이는 배 전부(리스트 밖 배 포함) + 이 배치에서 정한 목적지.
  // 회전도 같이 담는다 — 겹침 판정이 마커 방향을 알아야 하기 때문이다.
  const movingHulls = new Set(classed.filter(c => c.kind === 'move').map(c => c.hull));
  const occupied = [...live.entries()]
    .filter(([hull]) => !movingHulls.has(hull))
    .map(([, s]) => ({ x: s.x, y: s.y, r: s.r ?? 0 }));

  /** 그 선석에서 아무와도 안 겹치는 첫 슬롯. 없으면 null. */
  const freeSlot = (berth, taken) =>
    BERTH_SLOTS[berth].find(slot => !taken.some(o => labelsHidden(o, slot))) ?? null;

  const takeSlot = (berth) => {
    const slot = freeSlot(berth, occupied);
    if (slot) occupied.push({ x: slot.x, y: slot.y, r: slot.r });
    return slot;                               // 슬롯이 다 찼으면 null — 대기열로 보낸다
  };

  for (const c of classed) {
    if (c.kind === 'sea') { sea.push(c); continue; }
    if (c.kind === 'unknown') { unknown.push(c); continue; }
    if (c.kind === 'skip') {
      // 선석은 그대로인데 **축**이 세이프티원과 다르면 제자리에서 돌려만 준다.
      // ★이게 없으면 한 번 어긋난 축이 영영 고착된다 — "선석이 같으면 안 옮긴다" 때문에
      //  다음 수집부터 계속 "그대로" 로 읽히기 때문이다. 이 프로젝트가 반복해서 당한 모양이다.
      //  세이프티원이 축을 말해 줄 때(c.axisR)만 손댄다. 값이 없으면 추측하지 않는다.
      const curR = (((c.cur.r ?? 0) % 360) + 360) % 360;
      const want = (c.axisR == null && c.bowDeg == null)
        ? curR
        : shipHeading(curR, c.axisR, BERTH_SLOTS[c.berth][0].r, c.bowDeg);
      if (want === curR) { skips.push(c); continue; }
      const axisSame = c.axisR == null || curR % 180 === c.axisR % 180;
      moves.push({ hull: c.hull, loc: c.loc, berth: c.berth,
                   to: { x: c.cur.x, y: c.cur.y, r: want },
                   from: { x: c.cur.x, y: c.cur.y, r: curR }, reason: axisSame ? '뱃머리' : '축' });
      continue;
    }
    let berth = c.berth;
    let slot;
    if (c.at) {
      // 실제 자리를 안다 — 슬롯을 고를 필요가 없다. 회전은 축만 세이프티원(c.axisR)이
      // 정하고 앞뒤는 지금 값을 지킨다(shipHeading).
      const want = { x: Math.round(c.at.x), y: Math.round(c.at.y),
                     r: shipHeading(c.cur?.r, c.axisR, BERTH_SLOTS[berth][0].r, c.bowDeg) };
      // ★단, 그 자리에 이미 배가 있으면 놓지 않는다 (2026-08-29 실제로 겹쳤다).
      //  8265 를 실좌표 (83,575) 에 놓았더니 8206(75,560) 과 8px·15px 차이라
      //  마커 폭 26px 안에서 완전히 포개졌다. 세이프티원 좌표로도 둘은 21px 차이 —
      //  즉 실제로 나란히 붙어 있는(이중 계류) 배들이고, 좌표가 틀린 게 아니라
      //  **그 간격이 마커 폭보다 좁은** 것이다. 지도에서는 겹치면 안 되므로
      //  그럴 때는 그 선석의 빈 슬롯(이중 계류 자리 포함)으로 물러난다.
      if (!occupied.some(o => labelsHidden(o, want))) {
        slot = want;
        occupied.push({ ...want });
      }
    }
    if (!slot) {
      slot = takeSlot(berth);
      if (!slot) { slot = takeSlot('waiting'); berth = 'waiting'; }
    }
    if (!slot) { unknown.push({ ...c, loc: `${c.loc} (자리 없음)` }); continue; }
    // 슬롯으로 물러날 때도 앞뒤는 지킨다 — 자리를 양보한 것이지 뱃머리를 돌린 게 아니다.
    slot = { ...slot, r: shipHeading(c.cur?.r, c.axisR, slot.r, c.bowDeg) };
    const item = { hull: c.hull, loc: c.loc, berth, to: slot, from: c.cur ? { x: c.cur.x, y: c.cur.y } : null };
    (c.kind === 'move' ? moves : creates).push(item);
  }

  const seen = new Set(rows.map(r => r.hull));
  const untouched = [...live.keys()].filter(h => !seen.has(h));

  // ── 마지막: 이미 겹쳐 있는 배를 떼어놓는다 ────────────────────────────
  // ★"선석이 같으면 안 옮긴다" 는 **손으로 다듬은 자리**를 지키려는 규칙이지,
  //  겹쳐서 안 보이는 자리를 지키려는 규칙이 아니다. 한 번 겹쳐 써지고 나면
  //  그 다음 수집은 전부 "그대로" 로 읽어 **영영 겹친 채로 남는다** — 실제로 8265 가
  //  그랬다. 그래서 계획 마지막에 최종 자리를 다시 훑어 겹친 배를 옮긴다.
  //  리스트 밖 호선은 여기서도 손대지 않는다. 장애물로만 센다.
  {
    const finalOf = (h) => {
      const it = [...moves, ...creates].find(m => m.hull === h);
      if (it) return { x: it.to.x, y: it.to.y, r: it.to.r };
      const s = live.get(h);
      return s ? { x: s.x, y: s.y, r: s.r ?? 0 } : null;
    };
    // 슬롯에 가까운 배부터 자리를 인정한다 — 어긋난 쪽이 옮겨져야 한다.
    const offSlot = (p) => Math.min(...Object.values(BERTH_SLOTS).flat()
      .map(s => Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y))));
    const placed = [];
    for (const h of live.keys()) if (!seen.has(h)) { const p = finalOf(h); if (p) placed.push(p); }
    for (const it of [...moves, ...creates]) placed.push({ ...it.to });

    const ordered = [...skips]
      .map(c => ({ c, p: finalOf(c.hull) }))
      .filter(x => x.p)
      .sort((a, b) => offSlot(a.p) - offSlot(b.p));
    const kept = [];
    for (const { c, p } of ordered) {
      if (!placed.some(q => labelsHidden(q, p))) { placed.push(p); kept.push(c); continue; }
      const slot = freeSlot(c.berth, placed) ?? freeSlot('waiting', placed);
      if (!slot) { kept.push(c); continue; }            // 옮길 데가 없으면 그대로 둔다
      placed.push({ x: slot.x, y: slot.y, r: slot.r });
      moves.push({ hull: c.hull, loc: c.loc, berth: c.berth, to: slot,
                   from: { x: p.x, y: p.y }, reason: '겹침' });
    }
    skips.length = 0;
    skips.push(...kept);
  }

  return { moves, creates, skips, sea, unknown, untouched };
}
