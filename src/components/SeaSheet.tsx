/**
 * 조석·바람 상세 — 칩(나침반)을 탭하면 열린다 (2026-09-05 사용자 요청).
 *
 * 예전에는 만조 4칸 표와 24시간 꺾은선 하나가 전부였다. 사용자가 「나침반을 터치하면
 * 12시간 풍속을 그래프로 이쁘게, 조석도 그렇게」라고 해서 둘 다 제대로 다시 그렸다.
 *
 * ★조석 곡선은 **직선이 아니라 코사인**이다(`tideCurve`). 직선으로 이으면 만조 직전에도
 *  물이 같은 속도로 드는 것처럼 보이는데 실제로는 거의 멈춘다 — 그림이 사실과 달라진다.
 * ★값에 라벨을 다 붙이지 않는다. **다음 극값 하나 + 지금**만 직접 달고 나머지는 아래 표가
 *  받는다(모든 점에 숫자를 붙이면 아무도 안 읽는다). 표가 있으니 툴팁이 값을 가두지 않는다.
 * ★만조·간조는 **색을 하나 더 쓰지 않고 모양으로 가른다**(속 채움 / 속 빔).
 * ★**「지금」에만 붉은색을 쓴다.** 대담한 색이 두 군데면 어느 쪽도 눈에 안 띈다.
 * ★GPU 힌트(`filter`·`will-change`·`translate3d`)를 넣지 않는다 — 이 레포는 그것 때문에
 *  6커밋을 날린 적이 있다. 깊이는 전부 **SVG 그라디언트와 불투명도**로 낸다.
 *
 * ★★색·표면은 `sea-theme.ts` 한 곳에서 온다. 칩과 시트가 같은 값을 본다.
 */
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  northScreenDeg, windTravelScreenDeg, nextTide, untilText,
  tideCurve, tideHeightAt, windWindow, type TideEntry,
} from '../lib/sea';
import { SEA_THEMES, type SeaTheme, type SeaVariant } from './sea-theme';
import WindRose from './WindRose';

export interface SeaSheetProps {
  tab: 'wind' | 'tide';
  onTab: (t: 'wind' | 'tide') => void;
  tides: TideEntry[] | null;
  /** 「9월 5일 · 음력 24일 무시」 — 물때. */
  lunar?: string;
  /** 값의 출처와 수신 시각. ★「3일째 그대로」와 「수집이 죽음」을 가르는 유일한 표시라
   *  지우면 안 된다(main 의 조석 패널이 갖고 있던 것을 그대로 이어받았다). */
  source?: { text: string; stale: boolean } | null;
  /** 스냅샷을 아직 못 받았다(문서가 없는 것과 다르다). */
  tideLoading?: boolean;
  nowMin: number;
  wind: { speed: number; direction: string; degrees: number; time: string; hourly: number[] } | null;
  windFailed: boolean;
  rot: number;
  onClose: () => void;
  variant?: SeaVariant;
}

/** 차트 위를 손가락으로 훑으면 따라오는 세로선. 값을 **가두지 않는다** — 표·직접라벨이 따로 있다. */
function useScrub(len: number) {
  const [i, setI] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const at = (clientX: number) => {
    const el = ref.current;
    if (!el || len < 2) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setI(Math.round(f * (len - 1)));
  };
  return {
    ref, i,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); at(e.clientX); },
      onPointerMove: (e: React.PointerEvent) => { if (e.buttons) at(e.clientX); },
      onPointerUp: () => setI(null),
      onPointerCancel: () => setI(null),
      onPointerLeave: () => setI(null),
    },
  };
}

// ★y축 눈금 글자를 없앴다(2026-09-05 2판). 이유가 둘이다:
//  ① **같은 숫자가 세 곳에** 있었다 — y축 「9」 · 헤더 「최대 8.6」 · 점 위 「8.6」.
//  ② 그 y축 글자가 `{hi}` 를 **날것으로** 찍고 있었다. 코사인 보간이 낸 값은
//     `407.99999999915` 같은 실수라 오른쪽정렬로 잘려 화면에 **「915」** 로 떴다.
//     에러가 아니라 그냥 이상한 숫자 — 이 레포가 반복해서 당한 조용한 오답이다.
//  값은 ① 히어로 숫자 ② 최대점 직접 라벨 ③ 손가락 스크럽 ④ 아래 4칸 표가 답한다.
//  덕분에 왼쪽 여백이 줄어 같은 폭에서 그래프가 넓어졌다.
const W = 320, T = 20, B = 22, L = 12, R = 10;

/** 차트를 감싸는 칸. 시안에 따라 바탕이 있기도, 없기도 하다. */
function Plot({ th, children }: { th: SeaTheme; children: React.ReactNode }) {
  return th.ground
    ? <div className="rounded-2xl px-1.5 pb-1 pt-1.5" style={{ background: th.ground }}>{children}</div>
    : <div>{children}</div>;
}

export default function SeaSheet({
  tab, onTab, tides, lunar, source, tideLoading, nowMin, wind, windFailed, rot, onClose, variant = 'deep',
}: SeaSheetProps) {
  const th = SEA_THEMES[variant];
  return (
    <div
      data-sea-sheet
      style={{ background: th.card, boxShadow: th.shadow, outline: `1px solid ${th.ring}`, outlineOffset: '-1px' }}
      className="flex flex-col gap-3 rounded-3xl p-3.5 backdrop-blur-md"
    >
      <div className="flex items-center gap-2">
        {/* 알약 하나가 트랙 안에서 옮겨 다니는 꼴 — 두 글자가 각자 밑줄을 갖는 것보다 조용하다 */}
        <div className="flex items-center gap-0.5 rounded-full p-0.5" style={{ background: th.tabTrack }}>
          {(['wind', 'tide'] as const).map(k => (
            <button key={k} onClick={() => onTab(k)}
              style={tab === k
                ? { background: th.tabOn, color: th.tabOnInk }
                : { color: th.tabOffInk }}
              className="rounded-full px-3.5 py-1 text-[12px] font-extrabold">
              {k === 'wind' ? '바람' : '조석'}
            </button>
          ))}
        </div>
        <span className="ml-auto truncate text-[10px] font-medium"
          style={{ color: tab === 'tide' && source?.stale ? th.now : th.mute }}>
          {tab === 'wind' ? (wind ? `${wind.time} 기준` : '') : (source?.text ?? '')}
        </span>
        <button onClick={onClose} aria-label="닫기" className="-mr-1 shrink-0 p-1" style={{ color: th.mute }}>
          <X size={17} />
        </button>
      </div>

      {tab === 'wind'
        ? <WindTab th={th} wind={wind} windFailed={windFailed} rot={rot} nowMin={nowMin} />
        : <TideTab th={th} tides={tides} lunar={lunar} loading={tideLoading} nowMin={nowMin} />}
    </div>
  );
}

function Empty({ th, text }: { th: SeaTheme; text: string }) {
  return <p className="py-8 text-center text-[13px]" style={{ color: th.mute }}>{text}</p>;
}

function WindTab({ th, wind, windFailed, rot, nowMin }: {
  th: SeaTheme; wind: SeaSheetProps['wind']; windFailed: boolean; rot: number; nowMin: number;
}) {
  const hours = wind?.hourly ?? [];
  const nowHour = Math.floor(nowMin / 60);
  const { from, to } = windWindow(hours.length, nowHour);
  const win = hours.slice(from, to);
  const scrub = useScrub(win.length);

  if (!wind || win.length < 2) {
    return <Empty th={th} text={windFailed ? '바람 정보를 못 받았습니다' : '불러오는 중…'} />;
  }

  const max = Math.max(...win, 3);
  const H = 128, plotW = W - L - R, plotH = H - T - B;
  const x = (i: number) => L + (i / (win.length - 1)) * plotW;
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const line = win.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const maxI = win.indexOf(Math.max(...win));
  // 「지금」은 시각 그대로 — 정시에만 점이 있으므로 분까지 섞어 정확한 자리에 놓는다.
  const nowX = L + Math.min(1, Math.max(0, (nowMin / 60 - from) / (win.length - 1))) * plotW;
  const si = scrub.i;
  const gid = `wfill-${th.id}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <WindRose deg={windTravelScreenDeg(wind.degrees, rot)} north={northScreenDeg(rot)} size={86} detail
          uid={`sheet-${th.id}`} disc={th.disc} ring={th.discRing} tick={th.discTick}
          arrow={th.wind} northInk={th.now} mute={th.mute} />
        <div className="min-w-0">
          <div className="text-[11px] font-bold" style={{ color: th.ink2 }}>지금 · {wind.direction}풍</div>
          <div className="flex items-baseline gap-1">
            <span className="text-[38px] font-black leading-none tracking-tight tabular-nums" style={{ color: th.ink }}>
              {wind.speed.toFixed(1)}
            </span>
            <span className="text-[13px] font-bold" style={{ color: th.mute }}>m/s</span>
          </div>
          <div className="mt-1.5 text-[10.5px] leading-snug" style={{ color: th.mute }}>
            화살표는 바람이 <b style={{ color: th.ink2 }}>가는 쪽</b><br />— 배가 밀리는 방향
          </div>
        </div>
      </div>

      <Plot th={th}>
        <div className="mb-0.5 flex items-baseline justify-between px-1">
          {/* ★「앞으로 12시간」이라고 적었다가 고쳤다 — 창은 **지나온 3시간**을 포함한다.
              화면 글귀가 사실과 다르면 그 다음 글귀까지 같이 못 믿게 된다. */}
          <span className="text-[10.5px] font-bold" style={{ color: th.ink2 }}>시간별 풍속</span>
          <span className="text-[10px] tabular-nums" style={{ color: th.mute }}>{from}시 → {to - 1}시 · m/s</span>
        </div>
        <svg ref={scrub.ref} {...scrub.handlers} viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-pan-y select-none" role="img" aria-label="시간별 풍속">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={th.wind} stopOpacity={th.fill[0]} />
              <stop offset="100%" stopColor={th.wind} stopOpacity={th.fill[1]} />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map(f => (
            <line key={f} x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke={th.grid} strokeWidth="1" />
          ))}
          <polygon points={`${L},${y(0)} ${line} ${W - R},${y(0)}`} fill={`url(#${gid})`} />
          <polyline points={line} fill="none" stroke={th.wind} strokeWidth="2.2"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* 최대 한 점만 직접 라벨 — 모든 점에 숫자를 붙이면 아무도 안 읽는다 */}
          <circle cx={x(maxI)} cy={y(win[maxI])} r="3.6" fill={th.wind} stroke={th.surface} strokeWidth="1.8" />
          {/* ★첫 판에서 이 라벨이 「지금」 글자와 정면으로 겹쳐 **「지8.6」** 으로 읽혔다.
              최대가 지금 근처면 늘 부딪친다 — 그때는 점 **아래**로 내린다. */}
          <text x={Math.min(W - R - 12, Math.max(L + 12, x(maxI)))}
            y={Math.abs(x(maxI) - nowX) < 30 ? y(win[maxI]) + 16 : y(win[maxI]) - 9}
            textAnchor="middle" fontSize="10.5" fontWeight="800" fill={th.ink}
            style={{ fontVariantNumeric: 'tabular-nums' }}>{win[maxI].toFixed(1)}</text>

          <line x1={nowX} x2={nowX} y1={T - 5} y2={T + plotH} stroke={th.now} strokeWidth="1.2" />
          <text x={Math.min(W - R - 10, Math.max(L + 10, nowX))} y={T - 8} textAnchor="middle"
            fontSize="9.5" fontWeight="800" fill={th.now}>지금</text>

          {win.map((_, i) => (i + from) % 3 === 0 && (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill={th.mute}
              style={{ fontVariantNumeric: 'tabular-nums' }}>{i + from}시</text>
          ))}

          {si !== null && (
            <g>
              <line x1={x(si)} x2={x(si)} y1={T - 5} y2={T + plotH} stroke={th.ink} strokeWidth="1" opacity="0.4" />
              <circle cx={x(si)} cy={y(win[si])} r="4.2" fill={th.ink} />
              <rect x={Math.min(W - R - 34, Math.max(L, x(si) - 34)) } y={T + plotH + 2} width="68" height="15" rx="7.5" fill={th.ink} opacity="0.92" />
              <text x={Math.min(W - R, Math.max(L + 34, x(si)))} y={T + plotH + 12.5}
                textAnchor="middle" fontSize="9.5" fontWeight="800" fill={th.surface}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {si + from}시 · {win[si].toFixed(1)} m/s
              </text>
            </g>
          )}
        </svg>
      </Plot>
      <p className="-mt-1 px-1 text-[10px]" style={{ color: th.mute }}>
        그래프를 손가락으로 훑으면 시각별 값이 나옵니다.
      </p>
    </div>
  );
}

function TideTab({ th, tides, lunar, loading, nowMin }: {
  th: SeaTheme; tides: TideEntry[] | null; lunar?: string; loading?: boolean; nowMin: number;
}) {
  const curve = tides ? tideCurve(tides, 10) : [];
  const scrub = useScrub(curve.length);
  const t = tides ? nextTide(tides, nowMin) : null;
  // ★예보가 없으면 **없다고 말한다.** 사인 공식 폴백은 없다(2026-09-05 KHOA 전환).
  if (!tides || curve.length < 2 || !t) {
    return <Empty th={th} text={loading ? '조석예보를 불러오는 중…' : '조석예보 없음'} />;
  }

  const H = 132, plotW = W - L - R, plotH = H - T - B;
  const lo = Math.min(...curve.map(p => p.cm));
  const hi = Math.max(...curve.map(p => p.cm));
  const pad = Math.max(10, (hi - lo) * 0.14);
  const y = (cm: number) => T + plotH - ((cm - (lo - pad)) / ((hi + pad) - (lo - pad))) * plotH;
  const x = (min: number) => L + (min / 1440) * plotW;
  const line = curve.map(p => `${x(p.min).toFixed(1)},${y(p.cm).toFixed(1)}`).join(' ');
  const nowCm = tideHeightAt(tides, nowMin) ?? 0;
  const si = scrub.i;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const sorted = [...tides].sort((a, b) => toMin(a.time) - toMin(b.time));
  const gid = `tfill-${th.id}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold" style={{ color: th.tide }}>
              다음 {t.rising ? '만조' : '간조'}
            </span>
            {/* ★「근사」 배지는 뗐다 (2026-09-05). 값이 국립해양조사원 목포 실측 예보로
                바뀌었으므로 그 배지는 이제 **사실이 아니다** — 출처는 헤더가 말한다. */}
            {lunar && <span className="text-[10px] font-medium" style={{ color: th.mute }}>{lunar}</span>}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[38px] font-black leading-none tracking-tight tabular-nums" style={{ color: th.ink }}>
              {t.next.time}
            </span>
            <span className="text-[13px] font-bold tabular-nums" style={{ color: th.mute }}>{t.next.height}cm</span>
          </div>
        </div>
        <div className="pb-0.5 text-right">
          <div className="text-[12px] font-extrabold tabular-nums" style={{ color: th.ink2 }}>{untilText(t.minsLeft)} 남음</div>
          <div className="text-[10.5px] tabular-nums" style={{ color: th.mute }}>
            지금 {Math.round(nowCm)}cm · {t.rising ? '드는 중' : '나는 중'}
          </div>
        </div>
      </div>

      <Plot th={th}>
        <div className="mb-0.5 flex items-baseline justify-between px-1">
          <span className="text-[10.5px] font-bold" style={{ color: th.ink2 }}>오늘 물높이</span>
          <span className="text-[10px]" style={{ color: th.mute }}>cm</span>
        </div>
        <svg ref={scrub.ref} {...scrub.handlers} viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-pan-y select-none" role="img" aria-label="오늘 물높이">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={th.tide} stopOpacity={th.fill[0]} />
              <stop offset="100%" stopColor={th.tide} stopOpacity={th.fill[1]} />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map(f => {
            const cm = (lo - pad) + f * ((hi + pad) - (lo - pad));
            return <line key={f} x1={L} x2={W - R} y1={y(cm)} y2={y(cm)} stroke={th.grid} strokeWidth="1" />;
          })}
          <polygon points={`${L},${T + plotH} ${line} ${W - R},${T + plotH}`} fill={`url(#${gid})`} />
          <polyline points={line} fill="none" stroke={th.tide} strokeWidth="2.2"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* 만조는 속을 채우고 간조는 비운다 — 색을 하나 더 쓰지 않고 모양으로 가른다 */}
          {sorted.map(e => (
            <circle key={e.time} cx={x(toMin(e.time))} cy={y(e.height)} r="3.8"
              fill={e.type === 'High' ? th.tide : th.surface}
              stroke={e.type === 'High' ? th.surface : th.tide} strokeWidth="1.8" />
          ))}
          {/* 다음 것 하나만 직접 라벨 — 나머지 값은 아래 표가 받는다 */}
          <text x={Math.min(W - R - 22, Math.max(L + 22, x(toMin(t.next.time))))}
            y={y(t.next.height) - 9} textAnchor="middle" fontSize="10.5" fontWeight="800" fill={th.ink}>
            {t.rising ? '만조' : '간조'}
          </text>

          <line x1={x(nowMin)} x2={x(nowMin)} y1={T - 5} y2={T + plotH} stroke={th.now} strokeWidth="1.2" />
          <circle cx={x(nowMin)} cy={y(nowCm)} r="4.2" fill={th.now} stroke={th.surface} strokeWidth="1.8" />
          <text x={Math.min(W - R - 10, Math.max(L + 10, x(nowMin)))} y={T - 8} textAnchor="middle"
            fontSize="9.5" fontWeight="800" fill={th.now}>지금</text>

          {[0, 6, 12, 18, 24].map(h => (
            <text key={h} x={x(h * 60)} y={H - 6} textAnchor="middle" fontSize="9" fill={th.mute}
              style={{ fontVariantNumeric: 'tabular-nums' }}>{h}시</text>
          ))}

          {si !== null && (
            <g>
              <line x1={x(curve[si].min)} x2={x(curve[si].min)} y1={T - 5} y2={T + plotH} stroke={th.ink} strokeWidth="1" opacity="0.4" />
              <circle cx={x(curve[si].min)} cy={y(curve[si].cm)} r="4.2" fill={th.ink} />
              <rect x={Math.min(W - R - 38, Math.max(L, x(curve[si].min) - 38))} y={T + plotH + 2} width="76" height="15" rx="7.5" fill={th.ink} opacity="0.92" />
              <text x={Math.min(W - R, Math.max(L + 38, x(curve[si].min)))} y={T + plotH + 12.5}
                textAnchor="middle" fontSize="9.5" fontWeight="800" fill={th.surface}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {String(Math.floor(curve[si].min / 60)).padStart(2, '0')}:
                {String(curve[si].min % 60).padStart(2, '0')} · {Math.round(curve[si].cm)}cm
              </text>
            </g>
          )}
        </svg>
      </Plot>

      {/* 표 — 곡선이 라벨을 다 달지 않는 대신 값은 전부 여기 있다 */}
      <div className="grid grid-cols-4 gap-1.5">
        {sorted.map(e => {
          const isNext = e.time === t.next.time;
          return (
            <div key={e.time} className="rounded-xl px-1 py-1.5 text-center"
              style={{ background: isNext ? th.cellOn : th.cell }}>
              <div className="text-[9px] font-bold" style={{ color: isNext ? th.cellOnInk : th.mute, opacity: isNext ? 0.75 : 1 }}>
                {e.type === 'High' ? '만조' : '간조'}
              </div>
              <div className="text-[13px] font-black leading-tight tabular-nums"
                style={{ color: isNext ? th.cellOnInk : th.ink }}>{e.time}</div>
              <div className="text-[9px] tabular-nums" style={{ color: isNext ? th.cellOnInk : th.mute, opacity: isNext ? 0.7 : 1 }}>
                {e.height}cm
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
