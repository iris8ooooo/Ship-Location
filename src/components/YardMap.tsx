import {
  YARD_W, YARD_H, LAND_PATH, PLOT_PATHS, GRAY_PATHS, BLUE_PATHS,
} from './yardGeometry';

/**
 * HD현대삼호 야드 지도 — 세이프티원 3중점검 도면에서 추출.
 *
 * 도형은 손으로 베낀 게 아니라 세이프티원 캔버스를 그대로 뽑은 것이다
 * (yardGeometry.ts 주석 참고). 그래서 야드 모양·도크·안벽·건물 자리는
 * 그쪽 화면과 같다. 이 파일이 더하는 건 글자와 지역 버튼의 목표 범위뿐이다.
 *
 * 글자는 OCR 로 읽은 위치를 그대로 쓴다. Bay 번호 몇 개는 원본에서 비스듬히
 * 쓰여 있어 위치가 대략이다.
 *
 * 세이프티원 도면에는 '안벽'이라고만 적혀 있고 1안벽/2안벽도 A/B 도 없다.
 * 그 구분은 3중점검 리스트의 '위치' 칸에만 있다. 그래서 아래 지역 이름은
 * 도면이 아니라 사용자가 알려준 대로다.
 */
export { YARD_W, YARD_H };

/** 첫 화면이 맞추는 범위 — 배가 실제로 놓이는 띠 */
export const YARD_HOME = { x: 60, y: 420, w: 1860, h: 980 };

export interface YardRegion {
  id: string; label: string;
  x: number; y: number; w: number; h: number;
}

export const YARD_REGIONS: YardRegion[] = [
  { id: 'dock2',    label: '2도크',  x: 588,  y: 447,  w: 116, h: 512 },
  { id: 'dock1',    label: '1도크',  x: 728,  y: 494,  w: 109, h: 434 },
  { id: 'quay2',    label: '2안벽',  x: 60,   y: 890,  w: 700, h: 200 },
  { id: 'quay1',    label: '1안벽',  x: 820,  y: 910,  w: 760, h: 210 },
  { id: 'dolphin2', label: '2돌핀',  x: 190,  y: 1030, w: 200, h: 360 },
  { id: 'dolphin1', label: '1돌핀',  x: 1000, y: 1080, w: 180, h: 300 },
  { id: 'floating', label: '플로팅', x: 1690, y: 1050, w: 170, h: 300 },
  { id: 'berth1',   label: '1BERTH', x: 1480, y: 820,  w: 180, h: 180 },
  { id: 'all',      label: '전체',   x: 40,   y: 0,    w: 2320, h: 1440 },
];

const C = {
  sea:  '#9fc9e4',
  road: '#f7f4dc',
  plot: '#e6ded2',
  gray: '#a8a8a8',
  blue: '#cfe7f4',
  ink:  '#1c1c1c',
};

type L = [number, number, string, number?];

/** 구역 코드 */
const ZONES: L[] = [
  [137, 134, 'R901'],
  [222, 140, 'R902'],
  [302, 144, 'R903'],
  [383, 151, 'R904'],
  [465, 149, 'R905'],
  [113, 352, 'R2'],
  [109, 527, 'T1'],
  [102, 624, 'T2'],
  [94, 725, 'T3'],
  [88, 784, 'T4'],
  [498, 439, 'R1'],
  [473, 647, 'R3'],
  [434, 723, 'R4'],
  [217, 727, 'R4'],
  [329, 794, 'R5'],
  [135, 881, 'R7'],
  [399, 903, 'Q2'],
  [647, 326, 'P4'],
  [798, 446, 'P2'],
  [581, 666, 'P3'],
  [1803, 801, 'P5'],
  [1911, 806, 'P6'],
  [860, 664, 'M2'],
  [839, 947, 'M1'],
  [916, 805, 'J0'],
  [961, 893, 'J0'],
  [931, 518, 'G1'],
  [980, 558, 'B6'],
  [1020, 897, 'B7'],
  [1073, 900, 'B8'],
  [1424, 520, 'B2'],
  [1415, 597, 'B3'],
  [1540, 567, 'B1'],
  [1521, 675, 'B1'],
  [1627, 652, 'G5'],
  [1692, 659, 'G5'],
  [1529, 714, 'Y3'],
  [1620, 744, 'Y3'],
  [1245, 721, 'Y2'],
  [1299, 775, 'Y2'],
  [1117, 940, 'Y1'],
  [1188, 961, 'Y1'],
  [1408, 768, 'S02'],
  [959, 768, 'S3'],
  [1699, 101, 'A4'],
  [1765, 85, 'A3'],
  [1902, 317, 'A2'],
];
/** 공장·건물 */
const BUILDINGS: L[] = [
  [1075, 626, '대조립공장', 14],
  [1783, 283, '중조립공장', 14],
  [1816, 498, '판넬2공장', 14],
  [1235, 685, '판넬조립공장', 13],
  [1261, 884, '소조립공장', 13],
  [1413, 888, '가공공장', 13],
  [1061, 480, '선행의장공장', 12],
  [1150, 395, '제2도장공장 (Paint Shop)', 11],
  [1408, 425, '제2도장공장 (Blasting Cell)', 11],
  [1569, 413, '제1도장공장', 11],
  [1569, 290, '제5도장공장', 11],
  [472, 447, '제3도장공장', 11],
  [260, 661, '제4도장공장', 11],
  [1165, 597, '경계구역', 11],
];
/** 시설 */
const FACILITIES: L[] = [
  [1538, 955, 'GAS STATION #1', 10],
  [2012, 675, 'GAS STATION #2', 10],
  [347, 446, 'GAS STATION #3', 10],
  [1795, 69, 'GAS STATION #4', 10],
  [1127, 349, 'Air Comp #2', 9],
  [1011, 765, 'Air Comp #3', 9],
  [442, 508, 'Air Comp #5', 9],
  [277, 649, 'Air Comp #7', 9],
  [1786, 144, 'Air Comp #8', 9],
  [1916, 579, 'Air Comp #9', 9],
  [1627, 342, '소방대', 10],
];
/** 지명 */
const PLACES: L[] = [
  [676, 29, '삼호4차', 13],
  [910, 14, '삼호3차', 13],
  [1136, 73, '삼호서초', 13],
  [1226, 111, '한마음', 13],
  [1422, 139, '삼호2차', 13],
  [919, 208, '갈마산', 13],
  [1429, 290, '갈마산2', 12],
  [491, 291, '삼호1차', 12],
  [2112, 737, '산(호텔)', 11],
  [2171, 841, '호텔', 11],
];
/** Bay 번호 — 원본이 비스듬히 쓴 것들이라 위치가 대략이다 */
const BAYS: L[] = [
  [1075, 702, '72Bay', 10],
  [1214, 551, '54Bay', 10],
  [1786, 515, '12 Bay', 10],
  [1769, 257, '64 Bay', 10],
  [1261, 905, '35Bay', 10],
  [1413, 909, '25Bay', 10],
  [1145, 936, '36Bay', 10],
  [1370, 858, '21Bay', 10],
  [1335, 949, '26Bay', 10],
  [1266, 655, '51Bay', 10],
  [1287, 702, '53Bay', 10],
  [1197, 503, '11Bay', 10],
];

/**
 * 선석 이름 — 세이프티원 도면에는 '안벽'이라고만 적혀 있어 여기에는 없다.
 * 3중점검 리스트의 '위치' 칸(예: `2안벽 > CARGO TANK`)과 사용자 확인을 따랐다.
 * A 가 동쪽이다.
 */
const BERTHS: L[] = [
  [250, 930, '2안벽 B', 17], [620, 930, '2안벽 A', 17],
  [990, 950, '1안벽 B', 17], [1360, 960, '1안벽 A', 17],
  [285, 1330, '2돌핀', 17], [1120, 1350, '1돌핀', 17],
  [1775, 1230, '플로팅', 17], [1570, 900, '1BERTH', 17],
];

function T({ x, y, t, size = 13, weight = 600, fill = C.ink }: {
  x: number; y: number; t: string; size?: number; weight?: number; fill?: string;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill}
          textAnchor="middle" dominantBaseline="middle"
          fontFamily="system-ui, sans-serif" style={{ paintOrder: 'stroke' }}
          stroke="#ffffff" strokeWidth={3} strokeLinejoin="round">{t}</text>
  );
}

export default function YardMap() {
  return (
    <svg viewBox={`0 0 ${YARD_W} ${YARD_H}`} preserveAspectRatio="none"
         className="absolute inset-0 w-full h-full" aria-label="HD현대삼호 야드 지도">
      <rect x={0} y={0} width={YARD_W} height={YARD_H} fill={C.sea} />

      {/* 육지 — 구역 사이 빈틈이 곧 도로라 바탕을 도로색으로 깐다 */}
      {LAND_PATH.map((d, i) => (
        <path key={`l${i}`} d={d} fill={C.road} stroke="#b9b09a" strokeWidth={2.5} />
      ))}
      {PLOT_PATHS.map((d, i) => (
        <path key={`p${i}`} d={d} fill={C.plot} stroke="#cdc6ae" strokeWidth={1.2} />
      ))}
      {GRAY_PATHS.map((d, i) => (
        <path key={`g${i}`} d={d} fill={C.gray} stroke="#6a6a6a" strokeWidth={1.5} />
      ))}
      {BLUE_PATHS.map((d, i) => (
        <path key={`b${i}`} d={d} fill={C.blue} stroke="#d24b3e" strokeWidth={2}
              strokeDasharray="7 4" />
      ))}

      {[...ZONES, ...BUILDINGS, ...FACILITIES, ...PLACES, ...BAYS].map(([x, y, t, s], i) => (
        <T key={i} x={x} y={y} t={t} size={s ?? 13} />
      ))}
      {BERTHS.map(([x, y, t, s], i) => (
        <T key={`berth${i}`} x={x} y={y} t={t} size={s ?? 17} weight={800} fill="#12405c" />
      ))}
    </svg>
  );
}
