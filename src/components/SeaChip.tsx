/**
 * 지도 위에 **항상 떠 있는** 조석·바람 칩 (2026-09-05 사용자 요청 2·4·5번, 시안 ② 「수면」).
 *
 * 왜 만들었나 — 원래는 오른쪽 FAB 을 눌러야 시트가 열렸고, 열어도 **만조 4칸 표**라
 * 「지금 뭘 기다리는지」를 눈으로 계산해야 했다. 칩은 그 계산을 대신 해 준다.
 *
 * ★**칩 자체가 물이다.** 오늘 최저~최고 사이에서 지금 물높이만큼 차오른다 —
 *  숫자를 안 읽어도 「물이 많나 적나」가 먼저 보인다. 진행 막대를 쓰던 첫 판은
 *  「얼마나 왔나」만 말했는데, 정작 궁금한 것은 **지금 물이 어디쯤인가**였다.
 * ★**바람 화살표는 바람이 가는 쪽**을 가리킨다 — 배가 밀리는 방향.
 *  기상 풍향은 「불어오는 쪽」이라 그대로 그리면 정반대를 가리킨다(`sea.ts`).
 * ★**지도를 돌리면 나침반도 같이 돈다.** 지도는 북쪽이 위가 아니라 반시계 23.6° 다.
 * ★**「근사」 배지는 뗐다** (2026-09-05). 값이 국립해양조사원 목포(DT_0007) 예보로 바뀌었다 —
 *  사인 곡선이던 시절의 경고라 지금 붙어 있으면 그게 거짓말이 된다. 출처는 시트 헤더가 말한다.
 * ★애니메이션을 넣지 않았다. 이 레포는 GPU 승격 흐림으로 6커밋을 날린 적이 있고,
 *  물은 움직여서가 아니라 **맞는 높이에 있어서** 쓸모가 있다.
 */
import { northScreenDeg, windTravelScreenDeg, nextTide, untilText, tideCurve, tideHeightAt, type TideEntry } from '../lib/sea';
import { SEA } from './sea-theme';
import WindRose from './WindRose';

export interface SeaChipProps {
  tides: TideEntry[] | null;
  /** 지금 시각의 분(0~1439). 부모가 1분마다 갱신한다. */
  nowMin: number;
  wind: { speed: number; direction: string; degrees: number } | null;
  /** 지도 회전각(0·90·270). 나침반이 이걸 그대로 따라간다. */
  rot: number;
  onOpen: () => void;
}

/** 오늘 최저~최고 사이에서 지금 물높이가 차지하는 비율(0~1). */
function waterLevel(tides: TideEntry[], nowMin: number): { pct: number; cm: number } | null {
  const curve = tideCurve(tides, 20);
  if (curve.length < 2) return null;
  const lo = Math.min(...curve.map(p => p.cm));
  const hi = Math.max(...curve.map(p => p.cm));
  const cm = tideHeightAt(tides, nowMin);
  if (cm == null || hi === lo) return null;
  // ★바닥에 딱 붙거나 천장까지 차면 「물이 없다/넘친다」로 읽힌다. 실제로는 늘 물이 있다.
  //  12~92% 로 가둔다 — 차이는 그대로 보이면서 거짓말은 안 한다.
  return { pct: Math.round(12 + ((cm - lo) / (hi - lo)) * 80), cm: Math.round(cm) };
}

export default function SeaChip({ tides, nowMin, wind, rot, onOpen }: SeaChipProps) {
  const t = tides ? nextTide(tides, nowMin) : null;
  if (!t && !wind) return null;

  const travel = wind ? windTravelScreenDeg(wind.degrees, rot) : null;
  const level = tides ? waterLevel(tides, nowMin) : null;

  return (
    <button
      onClick={onOpen}
      aria-label="조석·바람 자세히 보기"
      style={{ background: SEA.card, boxShadow: SEA.shadow, outline: `1px solid ${SEA.ring}`, outlineOffset: '-1px' }}
      className="relative flex items-center gap-2.5 overflow-hidden rounded-[18px] px-3 py-2 text-left backdrop-blur-md"
    >
      {/* 물 — 지금 높이까지 차 있다. 글자보다 뒤에 깔린다. */}
      {level && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            height: `${level.pct}%`,
            // ★물을 옅게 깐다. 진하게(알파 .88) 깔았더니 물 윗면에서 **흰 글자 대비가
            //  3.49:1** 밖에 안 나왔다 — 「지금 211cm」이 바로 거기 앉는다. .60 으로 낮춰
            //  5.4:1 로 올렸고, 수면선은 밝게 남겨 「어디까지 찼나」는 그대로 보인다.
            background: `linear-gradient(180deg, ${SEA.water[0]}99, ${SEA.water[1]}f0)`,
            borderTop: `1.5px solid ${SEA.tide}`,
          }} />
      )}

      {/* 바람 */}
      <div className="relative flex flex-col items-center gap-1">
        <WindRose deg={travel} north={northScreenDeg(rot)} size={40} uid="chip"
          disc={SEA.disc} ring={SEA.discRing} tick={SEA.discTick} arrow={SEA.wind} northInk={SEA.now} />
        <span className="whitespace-nowrap text-[10px] font-bold leading-none" style={{ color: SEA.ink }}>
          {wind ? (
            <>
              <span className="tabular-nums">{wind.speed.toFixed(1)}</span>
              <span className="font-medium" style={{ color: SEA.ink2 }}> m/s</span>
            </>
          ) : '바람 —'}
        </span>
      </div>

      <span className="relative w-px shrink-0 self-stretch" style={{ background: SEA.ring }} aria-hidden />

      {/* 조석 */}
      <div className="relative flex min-w-0 flex-col">
        <span className="text-[10px] font-bold leading-tight" style={{ color: SEA.tide }}>
          {t ? `${t.rising ? '만조' : '간조'}까지` : '조석 —'}
        </span>
        <span className="whitespace-nowrap text-[17px] font-black leading-tight tabular-nums" style={{ color: SEA.ink }}>
          {t ? untilText(t.minsLeft) : '--'}
        </span>
        <span className="whitespace-nowrap text-[10px] font-semibold leading-tight tabular-nums" style={{ color: SEA.ink2 }}>
          {level ? `지금 ${level.cm}cm` : ''}
        </span>
      </div>
    </button>
  );
}
