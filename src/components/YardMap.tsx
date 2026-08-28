/**
 * HD현대삼호 야드 지도 (벡터).
 *
 * 좌표계는 앱이 쓰는 논리 공간 2000 x 1400 을 그대로 따른다. 배와 구역의 x, y 가
 * 이 공간에 저장돼 있으므로, 이 지도를 갈아끼워도 기존 위치가 그대로 살아난다.
 *
 * 기존 public/map.jpg (968x828 사진을 2000x1400 으로 늘려 쓰던 것)를 트레이싱했다.
 * 사진 좌표 → 논리 좌표 환산: x * 2.0661, y * 1.6908
 */

export const YARD_W = 2000;
export const YARD_H = 1400;

/** 지역 바로가기. 논리 좌표 기준 사각형 — 버튼을 누르면 이 영역으로 확대한다. */
export interface YardRegion {
  id: string;
  label: string;
  x: number; y: number; w: number; h: number;
}

export const YARD_REGIONS: YardRegion[] = [
  { id: 'dock2',    label: '2도크',   x: 430,  y: 200, w: 240, h: 420 },
  { id: 'dock1',    label: '1도크',   x: 650,  y: 200, w: 220, h: 420 },
  { id: 'quay2',    label: '2안벽',   x: 120,  y: 520, w: 560, h: 220 },
  { id: 'quay1',    label: '1안벽',   x: 880,  y: 520, w: 640, h: 220 },
  { id: 'dolphin2', label: '2돌핀',   x: 180,  y: 600, w: 260, h: 320 },
  { id: 'dolphin1', label: '1돌핀',   x: 1000, y: 600, w: 260, h: 320 },
  { id: 'floating', label: '플로팅',  x: 1580, y: 620, w: 300, h: 260 },
  { id: 'all',      label: '전체',    x: 0,    y: 0,   w: 2000, h: 780 },
];

const C = {
  sea:      '#9fc9e4',
  land:     '#f1ece1',
  quay:     '#ffffff',
  dock:     '#bcdcf0',
  bldg:     '#c3d8ea',
  bldgEdge: '#7f9fbe',
  road:     '#4b433c',
  green:    '#b9d99a',
  crane:    '#e79338',
  ink:      '#22303c',
  code:     '#c0392b',
};

/** 반복되는 공장 블록을 한 번에 그린다. */
function Blocks({ items }: { items: [number, number, number, number][] }) {
  return (
    <>
      {items.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={3}
              fill={C.bldg} stroke={C.bldgEdge} strokeWidth={1.5} />
      ))}
    </>
  );
}

export default function YardMap() {
  return (
    <svg
      viewBox={`0 0 ${YARD_W} ${YARD_H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
      aria-label="HD현대삼호 야드 지도"
    >
      {/* ── 바다 ─────────────────────────────────────────── */}
      <rect x={0} y={0} width={YARD_W} height={YARD_H} fill={C.sea} />

      {/* ── 육지 ─────────────────────────────────────────── */}
      <path d="M0,0 H2000 V560 H1520 V600 H1180 V560 H900 V600 H560 V560 H0 Z" fill={C.land} />

      {/* 갈마산 */}
      <path d="M360,20 H1160 V180 H360 Z" fill={C.green} />
      <path d="M1240,20 H1460 V150 H1240 Z" fill={C.green} />
      <text x={760} y={115} fontSize={40} fontWeight={700} fill="#4a6b35" textAnchor="middle">갈마산</text>
      <text x={1350} y={100} fontSize={28} fontWeight={700} fill="#4a6b35" textAnchor="middle">갈마산</text>

      {/* ── 도크 ─────────────────────────────────────────── */}
      <rect x={465} y={235} width={155} height={350} fill={C.dock} stroke="#6f9fc0" strokeWidth={3} />
      <text x={542} y={430} fontSize={34} fontWeight={800} fill={C.ink} textAnchor="middle">2도크</text>

      <rect x={682} y={235} width={135} height={350} fill={C.dock} stroke="#6f9fc0" strokeWidth={3} />
      <text x={750} y={430} fontSize={34} fontWeight={800} fill={C.ink} textAnchor="middle">1도크</text>

      {/* 골리앗 크레인 */}
      {[300, 380, 470].map(y => (
        <line key={y} x1={430} y1={y} x2={660} y2={y} stroke={C.crane} strokeWidth={11} strokeLinecap="round" />
      ))}
      {[330, 450].map(y => (
        <line key={y} x1={655} y1={y} x2={850} y2={y} stroke={C.crane} strokeWidth={11} strokeLinecap="round" />
      ))}

      {/* ── 건물 블록 ─────────────────────────────────────── */}
      <Blocks items={[
        [70, 130, 150, 60], [240, 130, 130, 55],
        [80, 250, 120, 45], [230, 250, 140, 45],
        [80, 330, 160, 50], [270, 330, 150, 50],
        [90, 420, 200, 45],
        [880, 230, 90, 300], [1000, 250, 120, 260],
        [1180, 200, 200, 120], [1180, 350, 200, 160],
        [1420, 230, 150, 280], [1600, 250, 130, 240],
        [1780, 260, 160, 230],
      ]} />

      {/* Bay 셀 (우측 반복 구획) */}
      {Array.from({ length: 6 }).map((_, i) => (
        <g key={i}>
          <rect x={1180} y={210 + i * 50} width={190} height={40} rx={2}
                fill="#d7e6f3" stroke={C.bldgEdge} strokeWidth={1} />
          <text x={1275} y={237 + i * 50} fontSize={17} fill="#3d566e" textAnchor="middle">{`${i + 1} Bay`}</text>
        </g>
      ))}

      {/* ── 도로 ─────────────────────────────────────────── */}
      <path d="M40,215 H1960" stroke={C.road} strokeWidth={9} fill="none" strokeLinecap="round" />
      <path d="M40,500 H860 M900,500 H1960" stroke={C.road} strokeWidth={9} fill="none" strokeLinecap="round" />
      <path d="M430,215 V560 M860,215 V560 M1150,215 V560" stroke={C.road} strokeWidth={7} fill="none" />
      <text x={500} y={205} fontSize={17} fill="#5b524a">메인도로</text>
      <text x={1200} y={205} fontSize={17} fill="#5b524a">메인도로</text>

      {/* ── 안벽 ─────────────────────────────────────────── */}
      <rect x={0} y={545} width={700} height={22} fill={C.quay} stroke="#9aa2a8" strokeWidth={2} />
      <rect x={880} y={545} width={1120} height={22} fill={C.quay} stroke="#9aa2a8" strokeWidth={2} />
      <text x={300} y={533} fontSize={30} fontWeight={800} fill={C.ink} textAnchor="middle">2안벽</text>
      <text x={1250} y={533} fontSize={30} fontWeight={800} fill={C.ink} textAnchor="middle">1안벽</text>

      {/* ── 돌핀 ─────────────────────────────────────────── */}
      {[{ x: 250, label: '2돌핀' }, { x: 1065, label: '1돌핀' }].map(d => (
        <g key={d.label}>
          <rect x={d.x} y={560} width={70} height={280} fill={C.quay} stroke="#9aa2a8" strokeWidth={2} />
          <rect x={d.x - 22} y={840} width={114} height={70} fill={C.quay} stroke="#9aa2a8" strokeWidth={2} />
          <rect x={d.x + 12} y={866} width={46} height={26} fill={C.crane} />
          <text x={d.x - 70} y={700} fontSize={30} fontWeight={800} fill={C.ink} textAnchor="middle">{d.label}</text>
        </g>
      ))}

      {/* ── 플로팅 도크 / 1Berth ──────────────────────────── */}
      <rect x={1640} y={660} width={130} height={190} fill={C.dock} stroke="#6f9fc0" strokeWidth={3} />
      <text x={1705} y={880} fontSize={24} fontWeight={700} fill={C.ink} textAnchor="middle">플로팅도크</text>
      <text x={1700} y={505} fontSize={26} fontWeight={700} fill={C.ink} textAnchor="middle">1Berth</text>

      {/* ── 선석 코드 — 세이프티원 '위치' 칼럼과 대조하는 핵심 라벨 ── */}
      {[
        ['2Q-2', 120, 600], ['2Q-1', 330, 600], ['2D-1', 520, 600],
        ['DH-2', 830, 470], ['DH-1', 830, 545],
        ['1Q-2', 1000, 600], ['1Q-1', 1280, 600],
        ['1D-1', 1620, 640], ['1D-2', 1620, 890],
      ].map(([t, x, y]) => (
        <text key={t as string} x={x as number} y={y as number}
              fontSize={22} fontWeight={800} fill={C.code} textAnchor="middle">{t}</text>
      ))}

      {/* SEA */}
      <text x={700} y={1000} fontSize={40} fontWeight={600} fill="#ffffff" opacity={0.75}
            letterSpacing={8} textAnchor="middle">SEA</text>
      <text x={1500} y={1000} fontSize={40} fontWeight={600} fill="#ffffff" opacity={0.75}
            letterSpacing={8} textAnchor="middle">SEA</text>
    </svg>
  );
}
