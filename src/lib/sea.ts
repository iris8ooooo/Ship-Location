/**
 * 조석·바람을 **화면에 그리기 위한 계산** — 파이어스토어도 React 도 모른다.
 * 그래서 `node scripts/test-sea.mjs` 로 실제 코드를 그대로 돌려 검증할 수 있다
 * (`yard-transform.mjs`·`visits-agg.ts` 와 같은 이유).
 */
import { TM_TO_YARD } from './yard-transform.mjs';

/**
 * ★**지도에서 북쪽이 화면 어느 쪽인가** — 찍지 않고 **변환계수에서 뽑는다.**
 *
 * 세이프티원 실좌표(TM)는 **+y 가 북**이다. 그 북쪽 단위벡터를 야드 좌표로 옮기면
 * 지도 안에서 북쪽이 어느 방향인지 그대로 나온다. 야드 좌표는 SVG 와 같아
 * (x 오른쪽 · y 아래) 화면 기준 시계각은 `atan2(x, -y)` 다.
 *
 * 실측값 **336.4°** — 즉 북쪽은 화면 위에서 **반시계로 23.6°** 기울어 있다.
 * (도면을 수평으로 맞추려고 약 23도 돌려 그린 것과 맞아떨어진다.)
 *
 * ★숫자를 박지 않는 이유: 변환식을 다시 맞추면(`mode=fit`) 북쪽도 같이 따라와야 한다.
 *  박아 두면 한쪽만 고치게 되고, 그때부터 화살표가 조용히 틀린 곳을 가리킨다.
 * ★TM 격자북과 진북은 이 경도에서 1° 안쪽으로 갈린다(자오선 수렴각). 화살표에는 무의미하다.
 */
export const NORTH_ON_MAP_DEG =
  (Math.atan2(TM_TO_YARD.b, -TM_TO_YARD.e) * 180 / Math.PI + 360) % 360;

/** 지도를 `rot` 만큼 돌렸을 때 화면에서 북쪽이 향하는 각(12시 기준 시계방향). */
export function northScreenDeg(rot: number): number {
  return (NORTH_ON_MAP_DEG + rot + 360) % 360;
}

/**
 * 바람이 **가는** 방향을 화면 각도로. 배가 밀리는 쪽이 이 방향이다.
 *
 * ★기상 풍향(`winddirection`)은 **불어오는 쪽**이다 — 「북서풍」은 북서에서 불어온다.
 *  화살표를 그대로 그리면 **정반대**를 가리킨다. 그래서 180 을 더한다.
 */
export function windTravelScreenDeg(fromDeg: number, rot: number): number {
  return ((fromDeg + 180) + NORTH_ON_MAP_DEG + rot + 720) % 360;
}

const DIRS = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동',
              '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];

/** 풍향 각도 → 「북서」. 16방위. */
export function dirName(fromDeg: number): string {
  return DIRS[Math.round(((fromDeg % 360) + 360) % 360 / 22.5) % 16];
}

export interface TideEntry { type: 'High' | 'Low'; time: string; height: number }

export interface NextTide {
  /** 다음에 오는 것 */
  next: TideEntry;
  /** 방금 지난 것 (없으면 어제 마지막 것으로 본다) */
  prev: TideEntry;
  /** 다음까지 남은 분 */
  minsLeft: number;
  /** prev → next 사이 어디쯤인가 (0~1). 진행 바가 이 값을 쓴다. */
  progress: number;
  /** 지금 물이 드는 중인가(다음이 만조면 밀물) */
  rising: boolean;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/**
 * 「지금 뭘 기다리고 있고 얼마나 남았나」 — 표를 눈으로 읽게 하지 않으려고 만든 것.
 *
 * ★하루가 넘어가는 경우를 반드시 다룬다. 마지막 만조가 20:36 인데 지금 23:00 이면
 *  **다음은 내일 첫 조석**이다. 이걸 빼먹으면 자정 직전에 「남은 시간 -156분」 같은
 *  값이 조용히 나온다 — 에러가 아니라 그냥 이상한 숫자다.
 */
export function nextTide(tides: TideEntry[], nowMin: number): NextTide | null {
  if (!tides.length) return null;
  const sorted = [...tides].sort((a, b) => toMin(a.time) - toMin(b.time));

  let nextIdx = sorted.findIndex(t => toMin(t.time) > nowMin);
  let nextMin: number;
  let prev: TideEntry;
  let prevMin: number;

  if (nextIdx === -1) {
    // 오늘 것은 다 지났다 → 내일 첫 조석
    nextIdx = 0;
    nextMin = toMin(sorted[0].time) + 24 * 60;
    prev = sorted[sorted.length - 1];
    prevMin = toMin(prev.time);
  } else {
    nextMin = toMin(sorted[nextIdx].time);
    if (nextIdx === 0) {
      // 오늘 첫 조석 전 → 직전 것은 어제 마지막
      prev = sorted[sorted.length - 1];
      prevMin = toMin(prev.time) - 24 * 60;
    } else {
      prev = sorted[nextIdx - 1];
      prevMin = toMin(prev.time);
    }
  }

  const next = sorted[nextIdx];
  const span = nextMin - prevMin;
  return {
    next,
    prev,
    minsLeft: nextMin - nowMin,
    progress: span > 0 ? Math.min(1, Math.max(0, (nowMin - prevMin) / span)) : 0,
    rising: next.type === 'High',
  };
}

/** 「2시간 41분」 · 「41분」. 0 이하는 「지금」. */
export function untilText(mins: number): string {
  if (mins <= 0) return '지금';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/** 조석 곡선 한 점. `min` 은 그날 0시부터의 분. */
export interface CurvePoint { min: number; cm: number }

/**
 * 만조·간조 네 점 사이를 **코사인으로 이어** 하루치 물높이 곡선을 만든다.
 *
 * ★왜 직선이 아니라 코사인인가 — 조석은 실제로 사인꼴로 오르내린다(그래서 뱃사람들이
 *  「12분조」로 어림한다). 직선으로 이으면 만조 직전에도 물이 같은 속도로 드는 것처럼
 *  보이는데, 실제로는 만조·간조 근처에서 거의 멈춘다. **그림이 사실과 달라진다.**
 *
 * ★하루 앞뒤는 **같은 하루가 반복된다고 보고** 감는다(첫 극값 −24h, 마지막 극값 +24h).
 *  실제 조석은 하루에 약 50분씩 밀리므로 자정 근처는 근사다 — 지금 조석값 자체가
 *  계산값이라 이 근사가 더 나쁠 것이 없고, 실측(KHOA)이 붙으면 **여러 날치를 받아
 *  앞뒤 극값을 진짜 값으로 채우면 된다**(그때 이 감기를 지운다).
 */
export function tideCurve(tides: TideEntry[], stepMin = 10): CurvePoint[] {
  if (tides.length < 2) return [];
  const ext = [...tides]
    .map(t => ({ min: toMin(t.time), cm: t.height }))
    .sort((a, b) => a.min - b.min);

  const padded = [
    { min: ext[ext.length - 1].min - 1440, cm: ext[ext.length - 1].cm },
    ...ext,
    { min: ext[0].min + 1440, cm: ext[0].cm },
  ];

  const out: CurvePoint[] = [];
  for (let m = 0; m <= 1440; m += stepMin) out.push({ min: m, cm: tideAt(padded, m) });
  return out;
}

/** 임의 시각의 물높이. `tideCurve` 와 같은 식을 쓴다 — 「지금」 점이 곡선 위에 정확히 앉는다. */
export function tideHeightAt(tides: TideEntry[], min: number): number | null {
  if (tides.length < 2) return null;
  const ext = [...tides]
    .map(t => ({ min: toMin(t.time), cm: t.height }))
    .sort((a, b) => a.min - b.min);
  const padded = [
    { min: ext[ext.length - 1].min - 1440, cm: ext[ext.length - 1].cm },
    ...ext,
    { min: ext[0].min + 1440, cm: ext[0].cm },
  ];
  return tideAt(padded, min);
}

function tideAt(padded: CurvePoint[], m: number): number {
  for (let i = 0; i < padded.length - 1; i++) {
    const a = padded[i], b = padded[i + 1];
    if (m >= a.min && m <= b.min) {
      const f = b.min === a.min ? 0 : (m - a.min) / (b.min - a.min);
      return a.cm + (b.cm - a.cm) * (1 - Math.cos(Math.PI * f)) / 2;
    }
  }
  return padded[padded.length - 1].cm;
}

/**
 * 12시간 창을 고른다 — 지나온 3시간(맥락) + 앞으로 9시간.
 * ★하루 24개 배열 밖으로 나가지 않게 자른다. 밖으로 나가면 그래프 끝이 조용히 0 으로 떨어진다.
 */
export function windWindow(hoursLen: number, nowHour: number, span = 12): { from: number; to: number } {
  const from = Math.max(0, Math.min(nowHour - 3, hoursLen - span));
  return { from, to: Math.min(hoursLen, from + span) };
}
