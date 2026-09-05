/**
 * 조석·바람 상세 — 칩(나침반)을 탭하면 열린다 (2026-09-05, 사용자가 「수면」 방향을 골랐다).
 *
 * 예전에는 만조 4칸 표와 24시간 꺾은선 하나가 전부였다. 사용자가 「나침반을 터치하면
 * 12시간 풍속을 그래프로 이쁘게, 조석도 그렇게」라고 해서 둘 다 제대로 다시 그렸다.
 *
 * ★★**조석 탭은 카드가 곧 바다다.** 물이 지금 높이까지 차 있고 **그 수면이 오늘의 조석
 *  곡선**이다. 축 눈금을 읽어 높이를 가늠하는 대신 물을 보면 된다.
 * ★조석 곡선은 **직선이 아니라 코사인**이다(`tideCurve`). 직선으로 이으면 만조 직전에도
 *  물이 같은 속도로 드는 것처럼 보이는데 실제로는 거의 멈춘다 — 그림이 사실과 달라진다.
 * ★**「지금」에만 붉은색을 쓴다.** 대담한 색이 두 군데면 어느 쪽도 눈에 안 띈다.
 * ★만조·간조는 색을 하나 더 쓰지 않고 **모양으로 가른다**(속 채움 / 속 빔).
 * ★**「근사」 배지는 뗐다.** 값이 국립해양조사원 목포 실측 예보로 바뀌었으므로 그 배지는
 *  이제 사실이 아니다 — 어디서 온 값이고 언제 받았는지는 **헤더가 말한다.**
 * ★GPU 힌트(`filter`·`will-change`·`translate3d`)를 넣지 않는다 — 이 레포는 그것 때문에
 *  6커밋을 날린 적이 있다. 깊이는 전부 **SVG 그라디언트와 불투명도**로 낸다.
 *
 * ★**탭은 남겼다.** 「수면」 시안에는 탭이 없었지만, 사용자가 먼저 요청한 것이
 *  **12시간 풍속 그래프**였다. 한 카드에 둘 다 쌓으면 폰에서 지역 버튼 줄을 파고든다
 *  (아래에 넷이 이미 쌓여 있다). 그래서 바람 탭도 같은 심해 언어로 그려 한 식구로 묶었다.
 */
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  northScreenDeg, windTravelScreenDeg, nextTide, untilText,
  tideCurve, tideHeightAt, windWindow, type TideEntry,
} from '../lib/sea';
import { SEA } from './sea-theme';
import WindRose from './WindRose';

export interface SeaSheetProps {
  tab: 'wind' | 'tide';
  onTab: (t: 'wind' | 'tide') => void;
  tides: TideEntry[] | null;
  /** 「9월 5일 · 음력 24일 무시」 — 물때. */
  lunar?: string;
  /** 값의 출처와 수신 시각. ★「사흘째 그대로」와 「수집이 죽음」을 가르는 유일한 표시라
   *  지우면 안 된다(main 의 조석 패널이 갖고 있던 것을 그대로 이어받았다). */
  source?: { text: string; stale: boolean } | null;
  /** 스냅샷을 아직 못 받았다(문서가 없는 것과 다르다). */
  tideLoading?: boolean;
  nowMin: number;
  wind: { speed: number; direction: string; degrees: number; time: string; hourly: number[] } | null;
  windFailed: boolean;
  rot: number;
  onClose: () => void;
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

const W = 340;

/** 이만큼 내리면 닫는다. 짧으면 살짝 스치기만 해도 닫히고, 길면 「안 닫히네」가 된다. */
const CLOSE_PX = 64;

/**
 * 아이폰 시트처럼 **위쪽을 아래로 끌어 닫는다** (2026-09-05 사용자 지시).
 *
 * ★**React 상태로 두면 안 된다.** 끌 때마다 리렌더가 나면 손가락 밑의 노드가 갈리고,
 *  이 레포는 정확히 그것 때문에 핀치가 한 프레임 만에 죽는 것을 겪었다
 *  (`dangerouslySetInnerHTML` 사건). 배 끌기의 빨간 테두리를 DOM 에 직접 그린 것과 같은 이유로,
 *  끄는 동안에는 `style.transform` 을 **DOM 에 직접** 쓰고 놓을 때만 결정한다.
 * ★`translate3d`·`will-change` 를 쓰지 않는다 — GPU 레이어로 승격되면 그 위 글자가 흐려진다.
 */
function useDragToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);

  const paint = (dy: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = dy ? `translateY(${dy}px)` : '';
    el.style.opacity = dy ? String(Math.max(0.4, 1 - dy / 300)) : '';
  };
  const dyOf = (e: React.PointerEvent) => Math.max(0, e.clientY - (from.current ?? e.clientY));

  return {
    ref,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        from.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => { if (from.current !== null) paint(dyOf(e)); },
      onPointerUp: (e: React.PointerEvent) => {
        if (from.current === null) return;
        const dy = dyOf(e);
        from.current = null;
        paint(0);
        if (dy > CLOSE_PX) onClose();
      },
      onPointerCancel: () => { from.current = null; paint(0); },
    },
  };
}

export default function SeaSheet({
  tab, onTab, tides, lunar, source, tideLoading, nowMin, wind, windFailed, rot, onClose,
}: SeaSheetProps) {
  const drag = useDragToClose(onClose);

  return (
    <div
      ref={drag.ref}
      data-sea-sheet
      style={{ background: SEA.card, boxShadow: SEA.shadow, outline: `1px solid ${SEA.ring}`, outlineOffset: '-1px' }}
      className="overflow-hidden rounded-3xl backdrop-blur-md"
    >
      {/* 손잡이 — 여기와 아래 머리줄을 아래로 끌면 닫힌다 */}
      <div {...drag.handlers} className="flex touch-none cursor-grab justify-center pb-0.5 pt-2 active:cursor-grabbing">
        <span className="h-1 w-10 rounded-full" style={{ background: 'rgba(255,255,255,0.28)' }} aria-hidden />
      </div>
      <div {...drag.handlers} className="flex touch-none items-center gap-2 px-3 pb-2 pt-1.5">
        {/* 알약 하나가 트랙 안에서 옮겨 다니는 꼴 — 두 글자가 각자 밑줄을 갖는 것보다 조용하다 */}
        <div className="flex items-center gap-0.5 rounded-full p-0.5" style={{ background: SEA.tabTrack }}>
          {(['tide', 'wind'] as const).map(k => (
            <button key={k} onClick={() => onTab(k)}
              style={tab === k
                ? { background: SEA.tabOn, color: SEA.tabOnInk }
                : { color: SEA.tabOffInk }}
              onPointerDown={e => e.stopPropagation()}
              className="rounded-full px-3.5 py-1.5 text-[12px] font-extrabold">
              {k === 'wind' ? '바람' : '조석'}
            </button>
          ))}
        </div>
        {/* 어디서 온 값이고 언제 받았나. 수신이 주기의 1.5배를 넘으면 붉게. */}
        <span className="ml-auto truncate text-[10px] font-medium"
          style={{ color: tab === 'tide' && source?.stale ? SEA.now : SEA.mute }}>
          {tab === 'wind' ? (wind ? `${wind.time} 기준` : '') : (source?.text ?? '')}
        </span>
        {/* ★44x44. 예전 것은 25px 이라 CLAUDE.md 의 「터치 타겟 최소 44×44」를 어기고 있었다 —
            현장에서 **장갑 끼고** 누른다(2026-09-05 사용자 지시). 바탕도 깔아 눈에 띄게 한다.
            ★`touch-none` 인 머리줄 안에 있으므로 끌기와 섞이지 않게 pointerdown 을 여기서 멈춘다. */}
        <button onClick={onClose} aria-label="닫기"
          onPointerDown={e => e.stopPropagation()}
          className="-mr-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ color: SEA.ink2, background: SEA.tabTrack }}>
          <X size={20} strokeWidth={2.6} />
        </button>
      </div>

      {tab === 'wind'
        ? <WindTab wind={wind} windFailed={windFailed} rot={rot} nowMin={nowMin} />
        : <TideTab tides={tides} lunar={lunar} loading={tideLoading} nowMin={nowMin} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-3.5 pb-6 pt-2 text-center text-[13px]" style={{ color: SEA.mute }}>{text}</p>;
}

/* ══ 조석 — 카드가 곧 바다 ═══════════════════════════════════════════════ */

function TideTab({ tides, lunar, loading, nowMin }: {
  tides: TideEntry[] | null; lunar?: string; loading?: boolean; nowMin: number;
}) {
  const curve = tides ? tideCurve(tides, 10) : [];
  const scrub = useScrub(curve.length);
  const t = tides ? nextTide(tides, nowMin) : null;
  // ★예보가 없으면 **없다고 말한다.** 사인 공식 폴백은 없다(2026-09-05 KHOA 전환).
  if (!tides || curve.length < 2 || !t) {
    return <Empty text={loading ? '조석예보를 불러오는 중…' : '조석예보 없음'} />;
  }

  // ★TOP 은 「하늘을 얼마나 남기나」가 아니라 **「히어로 글자 아래로 만조를 내리는 값」**이다.
  //  46 으로 뒀더니 07:28 만조 점이 「2시간 35분 남음 · 지금 211cm」 글자 **사이에 박혀**
  //  구분점처럼 보였다(실측). 62 로 내리면 그 점이 글자 밑으로 빠진다.
  const H = 196, TOP = 62;
  const lo = Math.min(...curve.map(p => p.cm));
  const hi = Math.max(...curve.map(p => p.cm));
  const y = (cm: number) => TOP + (H - TOP) * (1 - (cm - lo) / (hi - lo || 1));
  const x = (min: number) => (min / 1440) * W;
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${y(p.cm).toFixed(1)}`).join(' ');
  const nowCm = tideHeightAt(tides, nowMin) ?? lo;
  const si = scrub.i;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const sorted = [...tides].sort((a, b) => toMin(a.time) - toMin(b.time));

  return (
    <>
      <div className="relative">
        <svg ref={scrub.ref} {...scrub.handlers} viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
          preserveAspectRatio="none" className="block touch-pan-y select-none" role="img" aria-label="오늘 물높이">
          <defs>
            <linearGradient id="seaSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SEA.sky[0]} /><stop offset="100%" stopColor={SEA.sky[1]} />
            </linearGradient>
            <linearGradient id="seaWater" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SEA.water[0]} stopOpacity="0.92" />
              <stop offset="100%" stopColor={SEA.water[1]} stopOpacity="0.96" />
            </linearGradient>
            {/* ★답이 물 위에 떠 있으려면 **글자 뒤가 잠잠해야** 한다. 첫 렌더에서 07:28 만조
                곡선이 「12:45」를 정통으로 뚫고 지나갔다 — 시안에서는 그날 만조가 낮아 안 보였던
                함정이다. 위쪽에 옅은 안개를 깔아 글자 자리를 비운다(사진 위 자막과 같은 처리). */}
            <linearGradient id="seaScrim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06182a" stopOpacity="0.86" />
              <stop offset="55%" stopColor="#06182a" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#06182a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width={W} height={H} fill="url(#seaSky)" />
          {/* ★물 — 곡선 아래가 전부 물이다. 이게 이 화면의 전부다. */}
          <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#seaWater)" />
          <path d={line} fill="none" stroke={SEA.tide} strokeWidth="2" />
          <rect width={W} height="120" fill="url(#seaScrim)" />

          {/* 만조는 속을 채우고 간조는 비운다 — 색을 하나 더 쓰지 않고 모양으로 가른다 */}
          {sorted.map(e => (
            <circle key={e.time} cx={x(toMin(e.time))} cy={y(e.height)} r="3.8"
              fill={e.type === 'High' ? SEA.tide : SEA.water[1]}
              stroke={e.type === 'High' ? SEA.water[1] : SEA.tide} strokeWidth="1.8" />
          ))}

          <line x1={x(nowMin)} x2={x(nowMin)} y1="14" y2={H} stroke={SEA.now} strokeWidth="1.2" opacity="0.9" />
          <text x={Math.min(W - 16, Math.max(16, x(nowMin)))} y="11" textAnchor="middle"
            fontSize="9.5" fontWeight="800" fill={SEA.now}>지금</text>
          <circle cx={x(nowMin)} cy={y(nowCm)} r="5" fill={SEA.now} stroke={SEA.water[1]} strokeWidth="2" />

          {/* ★「지금」 선에 깔리는 눈금은 **숨긴다.** 첫 렌더에서 붉은 선이 「12시」를 관통해
              읽을 수 없었다 — 겹치면 둘 다 못 읽으므로, 지금이 이미 그 자리를 말한다. */}
          {[0, 6, 12, 18, 24].filter(h => Math.abs(x(h * 60) - x(nowMin)) > 26).map(h => (
            <text key={h} x={Math.min(W - 18, Math.max(18, x(h * 60)))} y={H - 7} textAnchor="middle"
              fontSize="9" fill="rgba(255,255,255,0.78)" style={{ fontVariantNumeric: 'tabular-nums' }}>{h}시</text>
          ))}

          {si !== null && (
            <g>
              <line x1={x(curve[si].min)} x2={x(curve[si].min)} y1="0" y2={H} stroke="#fff" strokeWidth="1" opacity="0.45" />
              <circle cx={x(curve[si].min)} cy={y(curve[si].cm)} r="4.2" fill="#fff" />
            </g>
          )}
        </svg>

        {/* 물 위에 얹힌 답 */}
        <div className="pointer-events-none absolute left-4 top-3.5">
          <div className="text-[11px] font-extrabold" style={{ color: SEA.tide }}>
            다음 {t.rising ? '만조' : '간조'}
          </div>
          <div className="text-[38px] font-black leading-none tracking-tight tabular-nums" style={{ color: SEA.ink }}>
            {t.next.time}
          </div>
          <div className="mt-1 text-[12px] font-bold tabular-nums" style={{ color: SEA.ink2 }}>
            {untilText(t.minsLeft)} 남음 · 지금 {Math.round(nowCm)}cm
          </div>
        </div>
        {si !== null && (
          <div className="pointer-events-none absolute right-3 top-3.5 rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums"
            style={{ background: 'rgba(6,26,44,0.72)', color: SEA.ink }}>
            {String(Math.floor(curve[si].min / 60)).padStart(2, '0')}:
            {String(curve[si].min % 60).padStart(2, '0')} · {Math.round(curve[si].cm)}cm
          </div>
        )}
      </div>

      {/* 표 — 곡선이 라벨을 다 달지 않는 대신 값은 전부 여기 있다 */}
      <div className="grid grid-cols-4 gap-px" style={{ background: SEA.ring }}>
        {sorted.map(e => {
          const isNext = e.time === t.next.time;
          return (
            <div key={e.time} className="px-1 py-2 text-center"
              style={{ background: isNext ? SEA.cellOn : SEA.card }}>
              <div className="text-[9px] font-bold" style={{ color: isNext ? SEA.tide : SEA.mute }}>
                {e.type === 'High' ? '만조' : '간조'}
              </div>
              <div className="text-[13px] font-black leading-tight tabular-nums" style={{ color: SEA.ink }}>{e.time}</div>
              <div className="text-[9px] tabular-nums" style={{ color: SEA.mute }}>{e.height}cm</div>
            </div>
          );
        })}
      </div>
      {lunar && (
        <div className="px-3.5 py-1.5 text-center text-[10px] font-medium" style={{ color: SEA.mute }}>{lunar}</div>
      )}
    </>
  );
}

/* ══ 바람 — 같은 심해 언어 ═══════════════════════════════════════════════ */

function WindTab({ wind, windFailed, rot, nowMin }: {
  wind: SeaSheetProps['wind']; windFailed: boolean; rot: number; nowMin: number;
}) {
  const hours = wind?.hourly ?? [];
  const nowHour = Math.floor(nowMin / 60);
  const { from, to } = windWindow(hours.length, nowHour);
  const win = hours.slice(from, to);
  const scrub = useScrub(win.length);

  if (!wind || win.length < 2) {
    return <Empty text={windFailed ? '바람 정보를 못 받았습니다' : '불러오는 중…'} />;
  }

  const max = Math.max(...win, 3);
  const H = 130, T = 20, B = 22, L = 12, R = 10;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i: number) => L + (i / (win.length - 1)) * plotW;
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const line = win.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const maxI = win.indexOf(Math.max(...win));
  // 「지금」은 시각 그대로 — 정시에만 점이 있으므로 분까지 섞어 정확한 자리에 놓는다.
  const nowX = L + Math.min(1, Math.max(0, (nowMin / 60 - from) / (win.length - 1))) * plotW;
  const si = scrub.i;

  return (
    <div className="flex flex-col gap-3 px-3.5 pb-3.5">
      <div className="flex items-center gap-3">
        <WindRose deg={windTravelScreenDeg(wind.degrees, rot)} north={northScreenDeg(rot)} size={86} detail
          uid="sheet" disc={SEA.disc} ring={SEA.discRing} tick={SEA.discTick}
          arrow={SEA.wind} northInk={SEA.now} mute={SEA.mute} />
        <div className="min-w-0">
          <div className="text-[11px] font-bold" style={{ color: SEA.ink2 }}>지금 · {wind.direction}풍</div>
          <div className="flex items-baseline gap-1">
            <span className="text-[38px] font-black leading-none tracking-tight tabular-nums" style={{ color: SEA.ink }}>
              {wind.speed.toFixed(1)}
            </span>
            <span className="text-[13px] font-bold" style={{ color: SEA.mute }}>m/s</span>
          </div>
          <div className="mt-1.5 text-[10.5px] leading-snug" style={{ color: SEA.mute }}>
            화살표는 바람이 <b style={{ color: SEA.ink2 }}>가는 쪽</b><br />— 배가 밀리는 방향
          </div>
        </div>
      </div>

      <div className="rounded-2xl px-1.5 pb-1 pt-1.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="mb-0.5 flex items-baseline justify-between px-1">
          {/* ★「앞으로 12시간」이라고 적었다가 고쳤다 — 창은 **지나온 3시간**을 포함한다.
              화면 글귀가 사실과 다르면 그 다음 글귀까지 같이 못 믿게 된다. */}
          <span className="text-[10.5px] font-bold" style={{ color: SEA.ink2 }}>시간별 풍속</span>
          <span className="text-[10px] tabular-nums" style={{ color: SEA.mute }}>{from}시 → {to - 1}시 · m/s</span>
        </div>
        <svg ref={scrub.ref} {...scrub.handlers} viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-pan-y select-none" role="img" aria-label="시간별 풍속">
          <defs>
            <linearGradient id="seaWindFill" x1="0" y1="0" x2="0" y2="1">
              {/* ★첫 렌더에서 면이 **카키색으로 탁했다** — amber 를 남색 위에 넓게 깔면
                  보색이 섞인다. 위만 남기고 아래는 빠르게 비워 바탕이 그대로 보이게 한다. */}
              <stop offset="0%" stopColor={SEA.wind} stopOpacity="0.30" />
              <stop offset="38%" stopColor={SEA.wind} stopOpacity="0.08" />
              <stop offset="100%" stopColor={SEA.wind} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map(f => (
            <line key={f} x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke={SEA.grid} strokeWidth="1" />
          ))}
          <polygon points={`${L},${y(0)} ${line} ${W - R},${y(0)}`} fill="url(#seaWindFill)" />
          <polyline points={line} fill="none" stroke={SEA.wind} strokeWidth="2.2"
            strokeLinejoin="round" strokeLinecap="round" />

          <circle cx={x(maxI)} cy={y(win[maxI])} r="3.6" fill={SEA.wind} stroke={SEA.card} strokeWidth="1.8" />
          {/* ★첫 판에서 이 라벨이 「지금」 글자와 정면으로 겹쳐 **「지8.6」** 으로 읽혔다.
              최대가 지금 근처면 늘 부딪친다 — 그때는 점 **아래**로 내린다. */}
          <text x={Math.min(W - R - 12, Math.max(L + 12, x(maxI)))}
            y={Math.abs(x(maxI) - nowX) < 30 ? y(win[maxI]) + 16 : y(win[maxI]) - 9}
            textAnchor="middle" fontSize="10.5" fontWeight="800" fill={SEA.ink}
            style={{ fontVariantNumeric: 'tabular-nums' }}>{win[maxI].toFixed(1)}</text>

          <line x1={nowX} x2={nowX} y1={T - 5} y2={T + plotH} stroke={SEA.now} strokeWidth="1.2" />
          <text x={Math.min(W - R - 10, Math.max(L + 10, nowX))} y={T - 8} textAnchor="middle"
            fontSize="9.5" fontWeight="800" fill={SEA.now}>지금</text>

          {win.map((_, i) => (i + from) % 3 === 0 && (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill={SEA.mute}
              style={{ fontVariantNumeric: 'tabular-nums' }}>{i + from}시</text>
          ))}

          {si !== null && (
            <g>
              <line x1={x(si)} x2={x(si)} y1={T - 5} y2={T + plotH} stroke="#fff" strokeWidth="1" opacity="0.4" />
              <circle cx={x(si)} cy={y(win[si])} r="4.2" fill="#fff" />
              <rect x={Math.min(W - R - 34, Math.max(L, x(si) - 34))} y={T + plotH + 2} width="68" height="15" rx="7.5"
                fill="rgba(6,26,44,0.85)" />
              <text x={Math.min(W - R, Math.max(L + 34, x(si)))} y={T + plotH + 12.5}
                textAnchor="middle" fontSize="9.5" fontWeight="800" fill={SEA.ink}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {si + from}시 · {win[si].toFixed(1)} m/s
              </text>
            </g>
          )}
        </svg>
      </div>
      <p className="-mt-1 px-1 text-[10px]" style={{ color: SEA.mute }}>
        그래프를 손가락으로 훑으면 시각별 값이 나옵니다.
      </p>
    </div>
  );
}
