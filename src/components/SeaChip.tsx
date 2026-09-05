/**
 * 지도 위에 **항상 떠 있는** 조석·바람 칩 (2026-09-05 사용자 요청 2·4·5번).
 *
 * 왜 만들었나 — 원래는 오른쪽 FAB 을 눌러야 시트가 열렸고, 열어도 **만조 4칸 표**라
 * 「지금 뭘 기다리는지」를 눈으로 계산해야 했다. 칩은 그 계산을 대신 해 준다.
 *
 * ★**바람 화살표는 바람이 가는 쪽**을 가리킨다 — 배가 밀리는 방향이다.
 *  기상 풍향은 「불어오는 쪽」이라 그대로 그리면 정반대를 가리킨다(`sea.ts`).
 * ★**지도를 돌리면 나침반도 같이 돈다.** 안 돌면 세운 화면에서 화살표가 거짓말을 한다.
 *  북쪽 위치는 좌표 변환계수에서 뽑는다 — 지도는 북쪽이 위가 아니라 **반시계 23.6°** 다.
 * ★**조석에 「근사」 배지를 단다.** 지금 조석값은 실측이 아니라 사인 곡선이다.
 *  국립해양조사원 값을 받아오기 전까지 이 배지를 **떼면 안 된다.**
 * ★애니메이션을 넣지 않았다. 이 레포는 GPU 승격 흐림으로 6커밋을 날린 적이 있고,
 *  화살표는 움직여서가 아니라 **맞는 곳을 가리켜서** 쓸모가 있다.
 *
 * ★★`variant` 는 **시안 비교용**이다(2026-09-05). 하나를 고르면 나머지 둘과 이 prop 을
 *  지운다 — 안 지우면 「어느 게 진짜지」가 코드에 남는다.
 */
import { northScreenDeg, windTravelScreenDeg, nextTide, untilText, type TideEntry } from '../lib/sea';

export type SeaVariant = 'light' | 'dark' | 'mini';

export interface SeaChipProps {
  tides: TideEntry[] | null;
  /** 지금 시각의 분(0~1439). 부모가 1분마다 갱신한다. */
  nowMin: number;
  wind: { speed: number; direction: string; degrees: number } | null;
  /** 지도 회전각(0·90·270). 나침반이 이걸 그대로 따라간다. */
  rot: number;
  onOpen: () => void;
  variant?: SeaVariant;
}

/** 나침반 원판. 지도와 같이 돌고, 화살표는 바람이 가는 쪽을 가리킨다. */
function Compass({ deg, north, dark }: { deg: number | null; north: number; dark?: boolean }) {
  const ring = dark ? '#475569' : '#cbd5e1';
  const arrow = dark ? '#22d3ee' : '#0891b2';
  return (
    <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0" aria-hidden>
      <defs>
        <linearGradient id="seaDiscL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fafc" /><stop offset="100%" stopColor="#e2e8f0" />
        </linearGradient>
        <linearGradient id="seaDiscD" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#334155" /><stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <circle cx="22" cy="22" r="19.5" fill={`url(#seaDisc${dark ? 'D' : 'L'})`} stroke={ring} strokeWidth="1" />
      <circle cx="22" cy="22" r="13.5" fill="none" stroke={dark ? '#475569' : '#e2e8f0'} strokeWidth="0.8" />
      {/* 빨간 침이 북. ★「N」 글자는 뺐다 — 6px 로는 안 읽히면서 화살표와 자리를 다퉜다. */}
      <g transform={`rotate(${north} 22 22)`}>
        <path d="M22 2.8 L24.6 7.8 L22 6.6 L19.4 7.8 Z" fill={dark ? '#fb7185' : '#f43f5e'} />
      </g>
      {deg === null ? (
        <circle cx="22" cy="22" r="3" fill={ring} />
      ) : (
        <g transform={`rotate(${deg} 22 22)`}>
          <rect x="20.7" y="17.5" width="2.6" height="14.5" rx="1.3" fill={arrow} opacity="0.45" />
          <path d="M22 8.6 L27.4 19.6 L22 16.9 L16.6 19.6 Z" fill={arrow} />
        </g>
      )}
    </svg>
  );
}

/** 미니 시안 — 원판 없이 화살표만. */
function MiniArrow({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" aria-hidden>
      <g transform={`rotate(${deg} 8 8)`}>
        <path d="M8 1.6 L12.4 10.2 L8 8 L3.6 10.2 Z" fill="#0891b2" />
        <rect x="7.3" y="8.6" width="1.4" height="5.4" rx="0.7" fill="#0891b2" opacity="0.45" />
      </g>
    </svg>
  );
}

export default function SeaChip({ tides, nowMin, wind, rot, onOpen, variant = 'light' }: SeaChipProps) {
  const t = tides ? nextTide(tides, nowMin) : null;
  if (!t && !wind) return null;

  const rising = t?.rising ?? true;
  const pct = Math.round((t?.progress ?? 0) * 100);
  const label = `다음 ${rising ? '만조' : '간조'}`;
  const time = t ? t.next.time : '--:--';
  const until = t ? untilText(t.minsLeft) : '';
  const travel = wind ? windTravelScreenDeg(wind.degrees, rot) : null;

  // ── 시안 C · 미니 알약 ──────────────────────────────────────────────
  if (variant === 'mini') {
    return (
      <button onClick={onOpen} aria-label="조석·바람 자세히 보기" className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-white/90 py-1 pl-2 pr-2.5 shadow-md shadow-slate-900/10 ring-1 ring-slate-900/5 backdrop-blur">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: rising ? '#f43f5e' : '#0ea5e9' }} />
          <span className="text-[12px] font-black leading-none tabular-nums text-slate-800">{time}</span>
          <span className="text-[10px] leading-none text-slate-500">{until}</span>
        </span>
        <span className="flex items-center gap-1 rounded-full bg-white/90 py-1 pl-1.5 pr-2.5 shadow-md shadow-slate-900/10 ring-1 ring-slate-900/5 backdrop-blur">
          {travel === null ? <span className="text-[10px] text-slate-400">—</span> : <MiniArrow deg={travel} />}
          <span className="text-[12px] font-black leading-none tabular-nums text-slate-800">
            {wind ? wind.speed.toFixed(1) : '—'}
          </span>
        </span>
      </button>
    );
  }

  const dark = variant === 'dark';
  const accent = rising ? (dark ? '#fb7185' : '#f43f5e') : (dark ? '#38bdf8' : '#0ea5e9');

  return (
    <button
      onClick={onOpen}
      aria-label="조석·바람 자세히 보기"
      className={`flex items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left backdrop-blur-md transition-shadow active:shadow-md ${
        dark
          ? 'bg-slate-900/85 shadow-xl shadow-black/40 ring-1 ring-white/10 hover:shadow-2xl'
          : 'bg-white/90 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5 hover:shadow-xl'
      }`}
    >
      {/* 바람 */}
      <div className="flex flex-col items-center gap-0.5">
        <Compass deg={travel} north={northScreenDeg(rot)} dark={dark} />
        <span className={`whitespace-nowrap text-[10px] font-bold leading-none ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          {wind ? (
            <>
              {wind.direction}{' '}
              <span className={`tabular-nums ${dark ? 'text-slate-100' : 'text-slate-700'}`}>{wind.speed.toFixed(1)}</span>{' '}
              <span className={`font-medium ${dark ? 'text-slate-500' : 'text-slate-400'}`}>m/s</span>
            </>
          ) : '바람 —'}
        </span>
      </div>

      <span className={`w-px shrink-0 self-stretch ${dark ? 'bg-white/15' : 'bg-slate-900/10'}`} aria-hidden />

      {/* 조석 */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold leading-none" style={{ color: accent }}>{label}</span>
          {/* ★조석은 아직 계산값이다. 실측을 붙이기 전까지 이 배지를 떼지 말 것. */}
          <span className={`rounded px-1 text-[9px] font-bold leading-[1.4] ${dark ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>근사</span>
        </div>
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className={`text-[15px] font-black leading-none tabular-nums ${dark ? 'text-white' : 'text-slate-800'}`}>{time}</span>
          <span className={`text-[11px] leading-none tabular-nums ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{until}</span>
        </div>
        <span className={`block h-1 w-full overflow-hidden rounded-full ${dark ? 'bg-white/15' : 'bg-slate-900/10'}`} aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
        </span>
      </div>
    </button>
  );
}
