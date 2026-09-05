/**
 * 바람 나침반 — **칩과 시트가 같은 것을 쓴다** (2026-09-05).
 * 크기만 다르고 기하는 하나다. 두 벌로 그리면 한쪽만 고치게 된다.
 *
 * ★**화살표는 바람이 가는 쪽**이다 — 배가 밀리는 방향. 기상 풍향은 「불어오는 쪽」이라
 *  그대로 그리면 정반대를 가리킨다(`sea.ts` 의 `windTravelScreenDeg`).
 * ★**지도를 돌리면 나침반도 같이 돈다.** 지도는 북쪽이 위가 아니라 반시계 23.6° 다.
 * ★**방위 글자는 테두리 밖에 둔다.** 안에 두면 화살표와 자리를 다툰다 — 첫 판에서
 *  6px 「N」이 화살표에 부딪쳐 통째로 뺐었다. 밖으로 내니 다 살았다.
 * ★글자는 **회전시키지 않는다.** 원판이 돌아도 글자는 서 있어야 읽힌다 — 자리만 삼각함수로
 *  옮긴다(호선번호를 눕히지 않고 쌓기로 한 것과 같은 이유).
 */
const RAD = Math.PI / 180;
const at = (deg: number, r: number): [number, number] =>
  [50 + r * Math.sin(deg * RAD), 50 - r * Math.cos(deg * RAD)];

export interface WindRoseProps {
  /** 바람이 가는 쪽(화면 시계각). null 이면 바람을 못 받은 것 — 화살표를 안 그린다. */
  deg: number | null;
  /** 화면에서 북쪽이 향하는 각. */
  north: number;
  /** px */
  size: number;
  disc: [string, string];
  ring: string;
  tick: string;
  arrow: string;
  northInk: string;
  /** 방위 글자·잔눈금. 큰 판에서만 켠다 — 작은 판에서는 안 읽히면서 자리만 먹는다. */
  detail?: boolean;
  mute?: string;
  /** 그라디언트 id 충돌 방지 */
  uid: string;
}

export default function WindRose({
  deg, north, size, disc, ring, tick, arrow, northInk, detail, mute = '#94a3b8', uid,
}: WindRoseProps) {
  const letters: [string, number][] = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`rose-${uid}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={disc[0]} /><stop offset="100%" stopColor={disc[1]} />
        </linearGradient>
        <linearGradient id={`tail-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={arrow} stopOpacity="0.55" />
          <stop offset="100%" stopColor={arrow} stopOpacity="0.06" />
        </linearGradient>
      </defs>

      <circle cx="50" cy="50" r="34" fill={`url(#rose-${uid})`} stroke={ring} strokeWidth="1.2" />
      <circle cx="50" cy="50" r="24" fill="none" stroke={ring} strokeWidth="0.9" />

      {/* 눈금 — 8방위는 길게, 사이 8개는 짧게 */}
      {Array.from({ length: 8 }, (_, i) => i * 45).map(a => {
        const [x1, y1] = at(a + north, 34), [x2, y2] = at(a + north, 28.5);
        return <line key={`M${a}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={tick} strokeWidth="1.3" strokeLinecap="round" />;
      })}
      {detail && Array.from({ length: 8 }, (_, i) => i * 45 + 22.5).map(a => {
        const [x1, y1] = at(a + north, 34), [x2, y2] = at(a + north, 31);
        return <line key={`m${a}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={tick} strokeWidth="0.9" strokeLinecap="round" opacity="0.7" />;
      })}

      {/* 북쪽 — 붉은 눈금 하나. 지도가 돌면 같이 돈다. */}
      {(() => {
        const [x1, y1] = at(north, 34.5), [x2, y2] = at(north, 25);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={northInk} strokeWidth="2.6" strokeLinecap="round" />;
      })()}

      {detail && letters.map(([ch, a]) => {
        const [x, y] = at(a + north, 43);
        return (
          <text key={ch} x={x} y={y + 3.4} textAnchor="middle"
            fontSize={ch === 'N' ? 11 : 9} fontWeight={ch === 'N' ? 800 : 700}
            fill={ch === 'N' ? northInk : mute}>{ch}</text>
        );
      })}

      {deg === null
        ? <circle cx="50" cy="50" r="4.5" fill={ring} />
        : (
          <g transform={`rotate(${deg} 50 50)`}>
            <rect x="48.4" y="34" width="3.2" height="40" rx="1.6" fill={`url(#tail-${uid})`} />
            <path d="M50 19 L58 40 L50 35.4 L42 40 Z" fill={arrow} />
          </g>
        )}
    </svg>
  );
}
