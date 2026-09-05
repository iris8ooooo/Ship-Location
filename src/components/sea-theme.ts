/**
 * 조석·바람 화면의 **색과 표면** 한 곳 (2026-09-05).
 *
 * ★칩과 시트가 **같은 값을 본다.** 각자 색을 들고 있으면 반드시 갈라진다 —
 *  이 레포가 아이콘 해시·앱 이름·탱크 표기에서 반복해서 당한 것과 같은 함정이다.
 *
 * ★색은 눈으로 고르지 않고 **검증기로 골랐다**(dataviz `validate_palette.js`).
 *  처음 고른 조석 sky-600(#0284c7)은 바람 cyan-600 과 **정상시력 ΔE 5.6** 으로
 *  하드 실패가 떴다 → blue-700 으로 바꿔 전 항목 통과(정상 19.6 · deutan 17.0 · 대비 3:1↑).
 *  어두운 판은 같은 자리에서 한 단계씩 밝힌 짝(cyan-400 / blue-400)이라 관계가 유지된다.
 *
 * ★★`SEA_VARIANTS` 는 **시안 비교용 임시물**이다. 사용자가 하나를 고르면 나머지 둘과
 *  `variant` prop, `localStorage.seaVariant` 를 **같이 지운다** — 안 지우면
 *  「어느 게 진짜지」가 코드에 영영 남는다.
 */
export type SeaVariant = 'deep' | 'paper' | 'tint';

export interface SeaTheme {
  id: SeaVariant;
  /** 시안 이름 — 화면에는 안 쓴다. 스크린샷·설명용. */
  name: string;
  /** 카드 배경. CSS `background` 값이면 뭐든 된다(그라디언트 포함). */
  card: string;
  ring: string;
  shadow: string;
  /** 제목·큰 숫자 */
  ink: string;
  /** 보조 글자 */
  ink2: string;
  /** 눈금·아주 작은 글자 */
  mute: string;
  grid: string;
  /** 마커 테두리·툴팁 글자에 쓰는 **표면색**. 겹치는 점을 떼어 놓는 2px 링이 이 색이다. */
  surface: string;
  wind: string;
  tide: string;
  /** 「지금」 하나에만 쓴다 — 대담함은 한 군데에만. */
  now: string;
  /** 면 그라디언트 위/아래 불투명도 */
  fill: [number, number];
  /** 나침반 원판 그라디언트 */
  disc: [string, string];
  discRing: string;
  discTick: string;
  /** 차트 블록의 바탕. null 이면 카드 위에 그대로 그린다. */
  ground: string | null;
  /** 탭 알약 */
  tabOn: string;
  tabOnInk: string;
  tabOffInk: string;
  tabTrack: string;
  /** 표 칸 */
  cell: string;
  cellOn: string;
  cellOnInk: string;
  /** 「근사」 배지 */
  badge: string;
  badgeInk: string;
}

const DEEP: SeaTheme = {
  id: 'deep', name: '심해',
  card: 'linear-gradient(165deg,#16293e 0%,#0d1a29 55%,#0a1421 100%)',
  ring: 'rgba(255,255,255,0.10)',
  shadow: '0 20px 45px -12px rgba(2,8,20,0.65)',
  ink: '#f1f5f9', ink2: '#a8bccf', mute: '#6d8397', grid: 'rgba(255,255,255,0.09)', surface: '#101d2c',
  wind: '#22d3ee', tide: '#60a5fa', now: '#fb7185',
  fill: [0.42, 0.02],
  disc: ['#20364f', '#111f31'], discRing: 'rgba(255,255,255,0.16)', discTick: 'rgba(255,255,255,0.34)',
  ground: 'rgba(255,255,255,0.045)',
  tabOn: '#f1f5f9', tabOnInk: '#0b1626', tabOffInk: '#8ba3ba', tabTrack: 'rgba(255,255,255,0.07)',
  cell: 'rgba(255,255,255,0.06)', cellOn: 'rgba(96,165,250,0.22)', cellOnInk: '#eff6ff',
  badge: 'rgba(251,191,36,0.16)', badgeInk: '#fcd34d',
};

const PAPER: SeaTheme = {
  id: 'paper', name: '백지',
  card: '#ffffff',
  ring: 'rgba(15,23,42,0.07)',
  shadow: '0 18px 40px -14px rgba(15,23,42,0.28)',
  ink: '#0f172a', ink2: '#475569', mute: '#94a3b8', grid: '#eef2f7', surface: '#ffffff',
  wind: '#0891b2', tide: '#1d4ed8', now: '#f43f5e',
  fill: [0.16, 0.01],
  disc: ['#f8fafc', '#e6ecf3'], discRing: '#cbd5e1', discTick: '#94a3b8',
  ground: null,
  tabOn: '#0f172a', tabOnInk: '#ffffff', tabOffInk: '#64748b', tabTrack: '#f1f5f9',
  cell: '#f6f8fb', cellOn: '#0f172a', cellOnInk: '#ffffff',
  badge: '#fef3c7', badgeInk: '#b45309',
};

const TINT: SeaTheme = {
  ...PAPER,
  id: 'tint', name: '물빛',
  card: 'linear-gradient(180deg,#ffffff 0%,#f7fbff 100%)',
  fill: [0.26, 0.02],
  ground: '#eff6ff', surface: '#eff6ff',
  cell: '#ffffff', cellOn: '#0f172a', cellOnInk: '#ffffff',
};

export const SEA_THEMES: Record<SeaVariant, SeaTheme> = { deep: DEEP, paper: PAPER, tint: TINT };
export const SEA_VARIANTS: SeaVariant[] = ['deep', 'paper', 'tint'];

/** 저장된 시안. ★`localStorage` 는 사파리 비공개에서 **읽기만 해도** 던진다. */
export function seaVariant(): SeaVariant {
  try {
    const v = localStorage.getItem('seaVariant');
    if (v && (SEA_VARIANTS as string[]).includes(v)) return v as SeaVariant;
  } catch { /* 저장소가 막혔으면 기본값 */ }
  return 'deep';
}
