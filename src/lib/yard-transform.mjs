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
 * 실측 12.7px 의 세 배 — 정상 오차로는 절대 닿지 않고, 좌표계가 바뀌면 반드시 넘는다
 * (run 14 의 잘못된 후보는 215px 였다).
 */
export const MAX_RESIDUAL = 40;
