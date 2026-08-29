/**
 * 세이프티원 실좌표(TM) → 십로케이션 야드 좌표(1380x840).
 *
 * ★왜 좌표인가 (2026-08-29 스키마 실측)
 *  세이프티원 지도 배 레이어 `/gis/ships` 에는 **선석 이름이 없다.** 지도가 <canvas> 인
 *  것도 같은 이유다 — 이름표 없이 그림만 있다. 그래서 "어느 필드가 선석인가" 를 네 번
 *  물었고 네 번 다 틀렸다. 답은 이름이 아니라 좌표를 읽고 우리 좌표계로 옮기는 것이다.
 *
 * ★왜 centerTm 인가 (run 14 → run 15)
 *  같은 응답의 `x`·`y` 는 **구조물 안의 지역 좌표**다. 안벽에 붙은 배끼리만 맞추면
 *  오차 1~4px 인데 도크 안 배는 x 가 60~4100 으로 자릿수부터 다르다. 23척을 한 식으로
 *  맞추면 RMS 215px(run 14). 반면 `centerTmX`·`centerTmY` 로 맞추면 RMS 12.7px,
 *  최대 23.4px — 배 폭(26px) 안이다(run 15, 실야드 22척).
 *  두 축 축척이 0.46519 / 0.46757 로 0.5% 밖에 차이가 없다. 회전+균등축척뿐인
 *  강체 변환이라는 뜻이고, 우연히 이렇게 나올 수 없다.
 *
 * ★계수를 박는 이유
 *  두 좌표계는 둘 다 고정된 그림이라 계수도 상수다. 매 수집마다 다시 맞추면 순환이
 *  된다 — 잘못 옮겨진 좌표로 변환식을 만들고 그 변환식으로 다시 좌표를 정하게 된다.
 *  대신 **박아 두고 매번 검증한다**(residualMedian). 도면을 다시 그리거나 세이프티원이
 *  좌표계를 바꾸면 잔차가 튀고, 그때 `sync-safetyone.yml` 을 fit 모드로 돌려 다시 잰다.
 */
import { berthOfPos, berthDist, BERTH_LABEL } from './safetyone-match.mjs';

/** run 15 (2026-08-29) 실측. 기준점 22쌍 · RMS 12.7px · 최대 23.4px. */
export const TM_TO_YARD = {
  a:  0.419981, b: -0.187020, c:  -14749.412,
  d: -0.200049, e: -0.428538, f:  131107.472,
};

/** TM 실좌표 → 야드 좌표. 값이 없으면 null. */
export function tmToYard(tmx, tmy) {
  if (!Number.isFinite(tmx) || !Number.isFinite(tmy)) return null;
  const t = TM_TO_YARD;
  return { x: t.a * tmx + t.b * tmy + t.c, y: t.d * tmx + t.e * tmy + t.f };
}

/**
 * 박아 둔 변환식이 아직 맞는지 잰다 — 수집한 배와 지도의 현재 좌표 사이 거리.
 *
 * ★평균이 아니라 **중앙값**이다. 배가 진짜로 몇 척 움직이면 그 배들의 잔차는 크고,
 *  평균(RMS)을 쓰면 정상적인 이동이 "변환식이 깨졌다" 로 읽혀 수집이 멈춘다.
 *  중앙값은 몇 척이 움직여도 흔들리지 않으므로 "좌표계가 어긋났다" 만 잡아낸다.
 *
 * @param rows [{hull, tmx, tmy}]
 * @param live Map(hull → {x, y})
 * @returns {n, median} — 짝지은 수와 잔차 중앙값(px). 짝이 없으면 n:0.
 */
export function residualMedian(rows, live) {
  const ds = [];
  for (const r of rows) {
    const cur = live.get(r.hull);
    const p = tmToYard(r.tmx, r.tmy);
    if (!cur || !p || !Number.isFinite(cur.x) || !Number.isFinite(cur.y)) continue;
    ds.push(Math.hypot(p.x - cur.x, p.y - cur.y));
  }
  if (!ds.length) return { n: 0, median: NaN };
  ds.sort((a, b) => a - b);
  const m = ds.length % 2
    ? ds[(ds.length - 1) / 2]
    : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2;
  return { n: ds.length, median: m };
}

/**
 * 잔차 중앙값이 이보다 크면 변환식을 믿지 않는다.
 *
 * ★"실측의 몇 배" 로 정하면 안 된다 — 이 값이 지켜야 하는 건 **선석 판정의 여유**다
 *  (2026-08-29 적대적 리뷰에서 잡힘). 서로 다른 선석의 최근접 슬롯 쌍은
 *  2도크(384,458) ↔ 1도크(438,476) 로 체비셰프 54px 뿐이고, 최근접 판정이라 실효
 *  경계는 그 절반인 27px 다. 좌표가 통째로 그만큼 밀리면 도크 이름이 뒤집힌다.
 *  실제로 (28,20) = 34.4px 을 먹이면 중앙값 34.4 ≤ 40 이라 예전 값으로는 **가드를
 *  통과하면서** 8283·8300 이 1도크로 넘어갔다(실측). 20 은 그 27 아래이고 실측
 *  중앙값 12.7px 대비 1.6배 여유가 있다. 같은 실험을 20px 로 하면 이동 0.
 */
export const MAX_RESIDUAL = 20;

/**
 * 수집한 좌표 행 → 매칭 엔진이 먹는 `{hull, loc, at}` 행.
 *
 * 스크립트가 아니라 여기 있는 이유: 이게 **틀리면 배가 엉뚱한 데로 가는 판정**이라
 * 파이어스토어 없이 그대로 돌려 볼 수 있어야 한다. 실제 코드를 테스트해야 의미가 있다.
 *
 * @param rows [{hull, tmx, tmy, angle}]
 * @param live Map(hull → {x, y})
 * @returns {rows, off, held} — off: 아는 선석 근처가 아닌 호선 / held: 경계라 이름을 유지한 호선
 */
/**
 * 세이프티원 `angle` → 우리 마커의 **축**. 0 = 세로(r 0/180), 90 = 가로(r 90/270).
 *
 * ★축까지만이다. 실측 23척의 angle 은 `0` 과 `±90` 두 값뿐이라 "가로냐 세로냐" 밖에
 *  말하지 못한다 — 뱃머리가 어느 끝인지는 세이프티원에 없다(safetyone-match.mjs
 *  shipHeading 주석 참고). 여기서 그 이상을 지어내면 안 된다.
 *
 *  검증(2026-08-29 실야드 23척): angle=0 인 8척은 전부 안벽 계류(가로), ±90 인
 *  15척은 전부 도크·돌핀·1BERTH·플로팅(세로)로, 지도의 현재 축과 23/23 일치했다.
 */
export function axisFromAngle(angle) {
  if (!Number.isFinite(angle)) return null;      // 값이 없으면 추측하지 않는다
  return (((angle % 180) + 180) % 180) === 0 ? 90 : 0;
}

export function namedRowsFromCoords(rows, live) {
  const off = [], held = [];
  const out = rows.map(r => {
    const at = tmToYard(r.tmx, r.tmy);
    let berth = at && berthOfPos(at);
    if (!berth) { off.push(r.hull); return { hull: r.hull, loc: '', axisR: axisFromAngle(r.angle) }; }
    // ★경계에서는 지금 선석을 유지한다 (2026-08-29 적대적 리뷰에서 잡힌 결함).
    //  2도크와 1도크는 슬롯 간격이 체비셰프 54px 뿐이라 실효 경계가 27px 인데,
    //  8300 은 22.0px · 8283 은 23.0px 만 밀려도 이름이 뒤집힌다 — 실측 변환 오차
    //  최대치(23.4px)와 겹친다. 한 번 뒤집히면 그 자리로 써지고 다음 수집부터
    //  "그대로" 로 잡혀 **오답이 영구 고착**된다. 로그에는 정상 이동 한 줄로만 남는다.
    //  그래서 새 선석이 지금 선석보다 확실히(허용 잔차만큼) 가까울 때만 이름을 바꾼다.
    //  진짜로 도크를 옮긴 배는 두 도크 거리 차가 그보다 훨씬 커서 그대로 잡힌다.
    const cur = live.get(r.hull);
    const curBerth = cur ? berthOfPos(cur) : null;
    if (curBerth && curBerth !== berth &&
        berthDist(at, curBerth) <= berthDist(at, berth) + MAX_RESIDUAL) {
      held.push(`${r.hull}(${BERTH_LABEL[berth]}→${BERTH_LABEL[curBerth]})`);
      berth = curBerth;
    }
    return { hull: r.hull, loc: BERTH_LABEL[berth], at, axisR: axisFromAngle(r.angle) };
  });
  return { rows: out, off, held };
}
