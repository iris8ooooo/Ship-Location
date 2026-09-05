/**
 * 지도 위에 **항상 떠 있는** 조석·바람 칩 (2026-09-05 사용자 요청 2·4·5번).
 *
 * 왜 만들었나 — 원래는 오른쪽 FAB 을 눌러야 시트가 열렸고, 열어도 **만조 4칸 표**라
 * 「지금 뭘 기다리는지」를 눈으로 계산해야 했다. 칩은 그 계산을 대신 해 준다.
 *
 * ★**진행 막대를 그만두고 조석 곡선을 넣었다**(2026-09-05 2판). 막대는 「얼마나 왔나」만
 *  말하는데, 정작 궁금한 것은 **물이 드는 중인가 나는 중인가, 지금이 어디쯤인가**다.
 *  같은 폭에 곡선을 그리면 그 셋이 한 번에 보인다 — 칸을 더 쓰지 않고 답을 늘린 것이다.
 * ★**「근사」 배지는 뗐다** (2026-09-05). 값이 국립해양조사원 목포(DT_0007) 예보로 바뀌었다 —
 *  사인 곡선이던 시절의 경고라 지금 붙어 있으면 그게 거짓말이 된다. 출처는 시트 헤더가 말한다.
 * ★애니메이션을 넣지 않았다. 이 레포는 GPU 승격 흐림으로 6커밋을 날린 적이 있고,
 *  화살표는 움직여서가 아니라 **맞는 곳을 가리켜서** 쓸모가 있다.
 *
 * ★★`variant` 는 **시안 비교용**이다. 하나를 고르면 나머지와 이 prop 을 같이 지운다.
 */
import { northScreenDeg, windTravelScreenDeg, nextTide, untilText, tideCurve, tideHeightAt, type TideEntry } from '../lib/sea';
import { SEA_THEMES, type SeaVariant } from './sea-theme';
import WindRose from './WindRose';

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

const SW = 66, SH = 20;

/** 오늘 물높이를 손톱만하게. 「드는 중인가 나는 중인가」가 한눈에 보이는 것이 목적이다. */
function TideSpark({ tides, nowMin, color, now }: {
  tides: TideEntry[]; nowMin: number; color: string; now: string;
}) {
  const curve = tideCurve(tides, 20);
  if (curve.length < 2) return null;
  const lo = Math.min(...curve.map(p => p.cm)), hi = Math.max(...curve.map(p => p.cm));
  const span = hi - lo || 1;
  const x = (m: number) => (m / 1440) * SW;
  const y = (cm: number) => SH - 2.5 - ((cm - lo) / span) * (SH - 5);
  const pts = curve.map(p => `${x(p.min).toFixed(1)},${y(p.cm).toFixed(1)}`).join(' ');
  const nx = x(nowMin), ny = y(tideHeightAt(tides, nowMin) ?? lo);
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} className="block" aria-hidden>
      <polygon points={`0,${SH} ${pts} ${SW},${SH}`} fill={color} opacity="0.16" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" opacity="0.85" />
      <line x1={nx} y1={ny} x2={nx} y2={SH} stroke={now} strokeWidth="1" opacity="0.45" />
      <circle cx={nx} cy={ny} r="2.4" fill={now} />
    </svg>
  );
}

export default function SeaChip({ tides, nowMin, wind, rot, onOpen, variant = 'deep' }: SeaChipProps) {
  const th = SEA_THEMES[variant];
  const t = tides ? nextTide(tides, nowMin) : null;
  if (!t && !wind) return null;

  const travel = wind ? windTravelScreenDeg(wind.degrees, rot) : null;

  return (
    <button
      onClick={onOpen}
      aria-label="조석·바람 자세히 보기"
      style={{ background: th.card, boxShadow: th.shadow, outline: `1px solid ${th.ring}`, outlineOffset: '-1px' }}
      className="flex items-center gap-2.5 rounded-[18px] px-2.5 py-2 text-left backdrop-blur-md"
    >
      {/* 바람 */}
      <div className="flex flex-col items-center gap-1">
        <WindRose deg={travel} north={northScreenDeg(rot)} size={42} uid={`chip-${variant}`}
          disc={th.disc} ring={th.discRing} tick={th.discTick} arrow={th.wind} northInk={th.now} />
        <span className="whitespace-nowrap text-[10px] font-bold leading-none" style={{ color: th.ink2 }}>
          {wind ? (
            <>
              {wind.direction}{' '}
              <span className="tabular-nums" style={{ color: th.ink }}>{wind.speed.toFixed(1)}</span>{' '}
              <span className="font-medium" style={{ color: th.mute }}>m/s</span>
            </>
          ) : '바람 —'}
        </span>
      </div>

      <span className="w-px shrink-0 self-stretch" style={{ background: th.ring }} aria-hidden />

      {/* 조석 */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold leading-none" style={{ color: th.tide }}>
            다음 {t?.rising ? '만조' : '간조'}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[16px] font-black leading-none tabular-nums" style={{ color: th.ink }}>
            {t ? t.next.time : '--:--'}
          </span>
          <span className="text-[11px] leading-none tabular-nums" style={{ color: th.ink2 }}>
            {t ? untilText(t.minsLeft) : ''}
          </span>
        </div>
        {tides && <TideSpark tides={tides} nowMin={nowMin} color={th.tide} now={th.now} />}
      </div>
    </button>
  );
}
