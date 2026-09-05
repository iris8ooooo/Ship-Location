/**
 * 조석·바람 화면의 **색과 표면** 한 곳 (2026-09-05, 사용자가 「수면」 방향을 골랐다).
 *
 * ★칩과 시트가 **같은 값을 본다.** 각자 색을 들고 있으면 반드시 갈라진다 —
 *  이 레포가 아이콘 해시·앱 이름·탱크 표기에서 반복해서 당한 것과 같은 함정이다.
 *
 * ★생각: **카드가 곧 바다다.** 물이 지금 높이까지 차 있고, 그 수면이 오늘의 조석 곡선이다.
 *  숫자를 읽지 않아도 「물이 많나 적나 · 드는 중인가 나는 중인가」가 먼저 보인다.
 *
 * ★★색은 눈으로 고르지 않고 **검증기로 골랐다**(dataviz `validate_palette.js`).
 *  처음 고른 조합(물 #8ed3f5 · 바람 cyan #22d3ee)은 **정상시력 ΔE 7.1** 로 하드 실패였다 —
 *  둘 다 청록이라 칩에서 화살표가 물에 묻힌다. 물을 sky-300 으로 내리고 바람을 **amber** 로
 *  옮겨 전 항목 통과: 정상 ΔE 22.7 · deutan 16.3 · tritan 15.9 · 채도 하한 통과.
 *  실제 카드 바탕(#0b2a45) 대비도 쟀다 — 물 8.8:1 · 바람 8.8:1 · 지금 5.5:1 · 눈금 4.9:1.
 *
 * ★**잰 값 중 하나는 트레이드오프로 남겼다**: 바람 amber(#fbbf24)는 지도의 호선 노랑
 *  (#ffe066)과 **ΔE 8.1** 로 가깝다. 그런데 그 둘은 한 차트 안의 이웃이 아니라 **다른 층**이다
 *  (칩은 어두운 카드 + 테두리 안, 호선은 지도 위 번호 달린 길쭉한 도형). 셋을 한 화면에서
 *  가려야 하는 물·바람·지금 쪽이 더 중요해서 이쪽을 택했다. 다른 후보(보라·주황·민트)는
 *  전부 물과 ΔE 10~12 로 **정상시력 하한에 걸려** 쓸 수 없었다.
 */
export interface SeaTheme {
  /** 카드 바탕(하늘 쪽) */
  card: string;
  /** 물 위 하늘 그라디언트 */
  sky: [string, string];
  /** 물 몸통 그라디언트 */
  water: [string, string];
  /** 수면선·조석 표식 */
  tide: string;
  /** 바람 */
  wind: string;
  /** 「지금」 하나에만 쓴다 — 대담함은 한 군데에만. */
  now: string;
  ring: string;
  shadow: string;
  ink: string;
  ink2: string;
  mute: string;
  grid: string;
  /** 마커 테두리에 쓰는 표면색. 겹치는 점을 떼어 놓는 2px 링이 이 색이다. */
  surface: string;
  /** 나침반 원판 */
  disc: [string, string];
  discRing: string;
  discTick: string;
  tabOn: string;
  tabOnInk: string;
  tabOffInk: string;
  tabTrack: string;
  cell: string;
  cellOn: string;
}

export const SEA: SeaTheme = {
  card: '#0b2a45',
  sky: ['#123a5c', '#0d2c47'],
  water: ['#3b9fd8', '#0e3f66'],
  tide: '#7dd3fc',
  wind: '#fbbf24',
  now: '#fb7185',
  ring: 'rgba(255,255,255,0.12)',
  shadow: '0 20px 45px -12px rgba(2,8,20,0.60)',
  ink: '#ffffff',
  ink2: '#cfe8f7',
  mute: '#6f9ab5',
  grid: 'rgba(255,255,255,0.10)',
  surface: '#0d2c47',
  disc: ['#17415f', '#0b2438'],
  discRing: 'rgba(255,255,255,0.22)',
  discTick: 'rgba(255,255,255,0.42)',
  tabOn: '#e8f4fb',
  tabOnInk: '#0b2a45',
  tabOffInk: '#8fb4cd',
  tabTrack: 'rgba(255,255,255,0.09)',
  cell: 'rgba(255,255,255,0.06)',
  cellOn: 'rgba(125,211,252,0.18)',
};
