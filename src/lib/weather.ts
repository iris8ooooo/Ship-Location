/**
 * 기상 코드 → 지도 위에 그릴 날씨. **네트워크를 모르는 순수 함수**만 둔다.
 *
 * 그래야 브라우저 없이 `node scripts/test-weather.mjs` 로 실제 코드를 그대로 돌려
 * 검증할 수 있다 (`sea.ts`·`yard-transform.mjs` 와 같은 이유).
 *
 * ★**요청이 한 건도 늘지 않는다.** 바람을 받으려고 이미 부르고 있는
 *  open-meteo `current_weather=true` 응답에 `weathercode` 가 **원래 들어 있었는데**
 *  앱이 `windspeed`·`winddirection`·`time` 만 꺼내고 버리고 있었다.
 */

export type WxKind = '비' | '눈' | '뇌우';
export interface Wx {
  kind: WxKind;
  /** 1 약함 · 2 보통 · 3 강함 */
  level: 1 | 2 | 3;
}

/**
 * WMO 날씨 해석 코드(WW) → 종류·세기.
 *
 * 표는 open-meteo 가 문서로 공개한 그 표다. 여기 **없는 코드는 효과 없음**이다 —
 * 맑음(0) · 대체로 맑음/구름(1~3) · 안개(45,48) 는 유리에 맺힐 것이 없다.
 * ★모르는 코드를 「비」로 넘겨짚지 않는다. 지어낸 날씨는 지어낸 조석과 같은 종류의 거짓말이다.
 */
const TABLE: Record<number, [WxKind, 1 | 2 | 3]> = {
  51: ['비', 1], 53: ['비', 2], 55: ['비', 3],       // 이슬비
  56: ['비', 1], 57: ['비', 3],                       // 어는 이슬비
  61: ['비', 1], 63: ['비', 2], 65: ['비', 3],       // 비
  66: ['비', 1], 67: ['비', 3],                       // 어는 비
  80: ['비', 1], 81: ['비', 2], 82: ['비', 3],       // 소나기
  71: ['눈', 1], 73: ['눈', 2], 75: ['눈', 3],       // 눈
  77: ['눈', 1],                                      // 싸락눈
  85: ['눈', 1], 86: ['눈', 3],                       // 소낙눈
  95: ['뇌우', 2], 96: ['뇌우', 3], 99: ['뇌우', 3], // 뇌우(96·99 는 우박 동반)
};

export function wmoToWx(code: unknown): Wx | null {
  const n = Number(code);
  if (!Number.isFinite(n)) return null;
  const hit = TABLE[n];
  return hit ? { kind: hit[0], level: hit[1] } : null;
}

/**
 * 풍속(m/s) → 빗줄기가 기우는 각(도).
 *
 * 실제 구현들이 쓰는 대역은 **잔잔한 비 10~18° · 폭풍 40°** 다. 40°에서 자른다 —
 * 그 이상은 비가 아니라 화면을 가로지르는 선이 되어 지도를 못 읽는다.
 */
export function windTiltDeg(speedMs: number | null | undefined): number {
  const v = Number(speedMs);
  if (!Number.isFinite(v) || v <= 0) return 4;
  return Math.min(40, Math.max(4, v * 2.2));
}

/**
 * 화면에서 **가로로 미는 양**(-1~1). 유리에 맺힌 물방울은 중력으로 아래로 흐르고
 * 바람은 옆으로만 민다 — 그래서 세로 성분은 쓰지 않는다.
 *
 * ★`screenTravelDeg` 는 `sea.ts` 의 `windTravelScreenDeg()` 가 내는 값을 그대로 받는다
 *  (12시 기준 시계방향, **바람이 가는 쪽**). 각도 규약을 여기서 새로 만들지 않는다 —
 *  사본을 만들면 반드시 갈라지고, 그러면 칩의 나침반과 비가 서로 다른 쪽을 가리킨다.
 */
export function windPushX(speedMs: number | null | undefined, screenTravelDeg: number): number {
  const rad = (Number(screenTravelDeg) || 0) * Math.PI / 180;
  return Math.sin(rad) * Math.sin(windTiltDeg(speedMs) * Math.PI / 180);
}

/**
 * 앱이 뜨고 이만큼 지난 뒤에 효과를 시작한다 (2026-09-06 사용자 지시:
 * 「앱로딩 구동후에 시간을 줘서 **앱로딩은 느리게 하지 않고**」).
 * 첫 화면·지도·배 위치가 다 자리를 잡은 뒤에 캔버스가 붙는다.
 */
export const FX_START_DELAY_MS = 4000;
