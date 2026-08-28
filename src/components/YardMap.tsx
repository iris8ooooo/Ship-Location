/**
 * HD현대삼호 야드 지도 (벡터).
 *
 * 좌표계는 앱이 쓰는 논리 공간 2000 x 1400 을 그대로 따른다. 배와 구역의 x, y 가
 * 이 공간에 저장돼 있으므로 지도를 갈아끼워도 기존 위치가 살아난다.
 *
 * docs/reference/yard-map-original.png (968 x 828 사진)을 트레이싱했다.
 * 사진 좌표 → 논리 좌표:  x * 2.0661,  y * 1.6908
 * 아래 주석의 (photo …) 는 사진에서 읽은 원좌표다. 나중에 대조·수정할 때 쓴다.
 */

export const YARD_W = 2000;
export const YARD_H = 1400;
/** 육지와 바다의 경계. photo y≈355 */
const COAST = 600;

export interface YardRegion {
  id: string;
  label: string;
  x: number; y: number; w: number; h: number;
}

export const YARD_REGIONS: YardRegion[] = [
  { id: 'dock2',    label: '2도크',  x: 440,  y: 220, w: 220, h: 400 },
  { id: 'dock1',    label: '1도크',  x: 650,  y: 220, w: 200, h: 400 },
  { id: 'quay2',    label: '2안벽',  x: 60,   y: 500, w: 620, h: 200 },
  { id: 'quay1',    label: '1안벽',  x: 860,  y: 500, w: 700, h: 200 },
  { id: 'dolphin2', label: '2돌핀',  x: 170,  y: 580, w: 260, h: 320 },
  { id: 'dolphin1', label: '1돌핀',  x: 980,  y: 580, w: 260, h: 320 },
  { id: 'floating', label: '플로팅', x: 1580, y: 600, w: 300, h: 260 },
  { id: 'berth1',   label: '1BERTH', x: 1560, y: 400, w: 340, h: 260 },
  { id: 'all',      label: '전체',   x: 0,    y: 0,   w: 2000, h: 900 },
];

const C = {
  sea:    '#9fc9e4',
  land:   '#efe9dc',
  dock:   '#a9d2ea',
  quay:   '#ffffff',
  bldg:   '#bcd4e8',
  bldgLn: '#7794b4',
  road:   '#463f38',
  green:  '#b5d795',
  crane:  '#e08a30',
  ink:    '#1f2d38',
  code:   '#c0392b',
};

/** 사진에서 읽은 건물 덩어리. [x, y, w, h] 논리좌표. */
const BUILDINGS: [number, number, number, number][] = [
  // 좌상단 클러스터 (photo x45-180, y60-270)
  [110, 108, 130, 55], [252, 108, 100, 55],
  [ 95, 195, 100, 40], [205, 195, 130, 45],
  [ 95, 255, 220, 42],
  [ 95, 325, 150, 45], [265, 325, 155, 45],
  [ 95, 400, 210, 40],
  // 도크 사이 좁은 건물 (photo x300-330)
  [630, 250, 40, 330],
  // 중앙 블록 (photo x420-530, y115-350)
  [875, 205, 90, 120], [875, 350, 90, 230],
  [985, 195, 105, 90], [985, 300, 105, 280],
  // 우측 대형 블록 (photo x540-760, y130-350)
  [1125, 225, 175, 120], [1125, 370, 175, 210],
  [1320, 210, 120, 150], [1320, 385, 120, 195],
  [1465, 250, 95, 330],
  // 최우측 (photo x900-968)
  [1870, 230, 110, 160], [1870, 420, 110, 160],
];

/** Bay 셀 묶음. 사진 우상단의 반복 구획 두 그룹. */
const BAY_GROUPS: { x: number; y: number; rows: number; label: (i: number) => string }[] = [
  { x: 1590, y: 30,  rows: 5, label: i => `E${i + 1} Bay` },
  { x: 1590, y: 210, rows: 4, label: i => `${i + 1} Bay` },
];

export default function YardMap() {
  return (
    <svg
      viewBox={`0 0 ${YARD_W} ${YARD_H}`}
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
      aria-label="HD현대삼호 야드 지도"
    >
      <rect x={0} y={0} width={YARD_W} height={YARD_H} fill={C.sea} />

      {/* ── 육지. 해안선은 거의 직선이고, 우측에 부두 구조물이 바다로 뻗는다 ── */}
      <path
        d={`M0,0 H2000 V${COAST}
            H1790 V${COAST + 30} H1600 V${COAST}
            H0 Z`}
        fill={C.land}
      />

      {/* 갈마산 (photo x175-555 / x600-700, y12-100) */}
      <path d="M362,18 H1147 V172 H900 V140 H362 Z" fill={C.green} />
      <rect x={1240} y={18} width={206} height={150} fill={C.green} />
      <text x={720} y={110} fontSize={38} fontWeight={700} fill="#4d7034" textAnchor="middle">갈마산</text>
      <text x={1343} y={105} fontSize={30} fontWeight={700} fill="#4d7034" textAnchor="middle">갈마산</text>

      {/* ── 건물 ─────────────────────────────────────────── */}
      {BUILDINGS.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={3}
              fill={C.bldg} stroke={C.bldgLn} strokeWidth={1.5} />
      ))}

      {BAY_GROUPS.map((g, gi) => (
        <g key={gi}>
          {Array.from({ length: g.rows }).map((_, i) => (
            <g key={i}>
              <rect x={g.x} y={g.y + i * 34} width={270} height={28} rx={2}
                    fill="#cfe0f0" stroke={C.bldgLn} strokeWidth={1} />
              <text x={g.x + 135} y={g.y + 20 + i * 34} fontSize={16}
                    fill="#3d566e" textAnchor="middle">{g.label(i)}</text>
            </g>
          ))}
        </g>
      ))}

      {/* ── 도크 (photo 2도크 x228-300 / 1도크 x330-390, y145-350) ── */}
      <rect x={471} y={245} width={149} height={347} fill={C.dock} stroke="#6f9fc0" strokeWidth={3} />
      <rect x={682} y={245} width={124} height={347} fill={C.dock} stroke="#6f9fc0" strokeWidth={3} />

      {/* 골리앗 크레인 (photo y≈180, 210, 245, 262) */}
      {[304, 355, 414, 443].map((y, i) => (
        <line key={i} x1={440} y1={y} x2={650} y2={y} stroke={C.crane} strokeWidth={10} strokeLinecap="round" />
      ))}
      {[320, 400, 460].map((y, i) => (
        <line key={i} x1={660} y1={y} x2={840} y2={y} stroke={C.crane} strokeWidth={10} strokeLinecap="round" />
      ))}
      {/* 도크 사이의 짙은 삼각 구조 (photo x325-395, y185-235) */}
      <polygon points="672,313 817,313 745,397" fill="#4a5a3f" opacity={0.85} />

      <text x={545} y={500} fontSize={34} fontWeight={800} fill={C.ink} textAnchor="middle">2도크</text>
      <text x={744} y={500} fontSize={34} fontWeight={800} fill={C.ink} textAnchor="middle">1도크</text>

      {/* ── 도로 ─────────────────────────────────────────── */}
      <path d={`M0,190 H2000`} stroke={C.road} strokeWidth={9} fill="none" />
      <path d={`M0,470 H430 M860,470 H2000`} stroke={C.road} strokeWidth={8} fill="none" />
      <path d={`M430,190 V${COAST} M855,190 V${COAST} M1100,190 V${COAST} M1560,190 V${COAST}`}
            stroke={C.road} strokeWidth={7} fill="none" />
      <text x={330} y={180} fontSize={17} fill="#6b6157">메인도로</text>
      <text x={1180} y={180} fontSize={17} fill="#6b6157">메인도로</text>

      {/* ── 안벽 ─────────────────────────────────────────── */}
      <rect x={0} y={COAST - 14} width={1560} height={16} fill={C.quay} stroke="#98a1a8" strokeWidth={2} />

      {/* 안벽은 A / B 선석으로 나뉜다. 어느 쪽이 A 인지는 확인 필요 — 일단 좌측을 A 로 둔다. */}
      {([
        ['2안벽', 0, 680],
        ['1안벽', 860, 1560],
      ] as [string, number, number][]).map(([name, x0, x1]) => {
        const mid = (x0 + x1) / 2;
        return (
          <g key={name}>
            <line x1={mid} y1={COAST - 26} x2={mid} y2={COAST + 6}
                  stroke="#7d868d" strokeWidth={3} strokeDasharray="6 5" />
            <text x={(x0 + mid) / 2} y={COAST - 24} fontSize={19} fontWeight={700}
                  fill="#5b666e" textAnchor="middle">{`${name} A`}</text>
            <text x={(mid + x1) / 2} y={COAST - 24} fontSize={19} fontWeight={700}
                  fill="#5b666e" textAnchor="middle">{`${name} B`}</text>
            <text x={mid} y={COAST + 46} fontSize={28} fontWeight={800}
                  fill={C.ink} textAnchor="middle">{name}</text>
          </g>
        );
      })}

      {/* ── 돌핀 (photo 2돌핀 x120-160 / 1돌핀 x512-550, y360-512) ── */}
      {[{ x: 248, label: '2돌핀' }, { x: 1058, label: '1돌핀' }].map(d => (
        <g key={d.label}>
          <rect x={d.x} y={COAST} width={80} height={230} fill={C.quay} stroke="#98a1a8" strokeWidth={2} />
          <rect x={d.x - 30} y={830} width={140} height={62} fill={C.quay} stroke="#98a1a8" strokeWidth={2} />
          <rect x={d.x + 18} y={852} width={44} height={22} fill={C.crane} />
          <text x={d.x - 78} y={716} fontSize={30} fontWeight={800} fill={C.ink} textAnchor="middle">{d.label}</text>
        </g>
      ))}

      {/* ── 우측 부두 · 1Berth · 플로팅도크 (photo x765-860, y275-470) ── */}
      <rect x={1600} y={COAST} width={190} height={30} fill={C.quay} stroke="#98a1a8" strokeWidth={2} />
      <text x={1694} y={487} fontSize={26} fontWeight={700} fill={C.ink} textAnchor="middle">1Berth</text>
      <rect x={1653} y={668} width={113} height={118} fill={C.dock} stroke="#6f9fc0" strokeWidth={3} />
      <text x={1710} y={818} fontSize={23} fontWeight={700} fill={C.ink} textAnchor="middle">플로팅도크</text>

      {/* ── 선석 코드 — 세이프티원 '위치' 칼럼과 대조하는 핵심 라벨 ── */}
      {([
        ['2Q-2', 150, 640], ['2Q-1', 300, 640], ['2D-1', 425, 640],
        ['DH-2', 838, 443], ['DH-1', 848, 558], ['1D-1', 786, 521],
        ['1Q-2', 1023, 640], ['1Q-1', 1219, 640],
        ['1D-2', 1643, 685], ['1D-1', 1748, 782],
      ] as [string, number, number][]).map(([t, x, y], i) => (
        <text key={i} x={x} y={y} fontSize={21} fontWeight={800} fill={C.code} textAnchor="middle">{t}</text>
      ))}

      <text x={690} y={790} fontSize={38} fontWeight={600} fill="#ffffff" opacity={0.7}
            letterSpacing={8} textAnchor="middle">SEA</text>
      <text x={1455} y={790} fontSize={38} fontWeight={600} fill="#ffffff" opacity={0.7}
            letterSpacing={8} textAnchor="middle">SEA</text>
    </svg>
  );
}
