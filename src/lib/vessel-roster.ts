/**
 * 호선 명부 — 공정관리비서(Supabase)에서 "우리가 작업하는 호선"과 "DF 호선"을 읽는다.
 *
 * 지도에는 야드의 모든 배가 뜨지만 우리가 붙는 배는 절반도 안 된다(실측 25척 중 10척).
 * 그래서 두 가지를 여기서 정한다:
 *   - 작업 호선: vessel_schedules 에 한 줄이라도 있으면 우리 배. 진하게 그린다.
 *   - DF 호선: vessels 의 선종/containment 에 'DF' 가 있으면 초록, 아니면 노랑.
 *     (2026-08-29 사용자 지시: 대부분 LNGC 라 노랑, 늘어나는 CNTR DF 를 초록으로 가른다)
 *
 * ★조회에 실패하면 아무것도 흐리지 않는다. 멀쩡한 배가 사라진 것처럼 보이는 쪽이
 *   덜 정리된 화면보다 훨씬 나쁘다 — fail open 이 맞다.
 *
 * anon publishable 키는 공개용이고, 두 테이블 모두 anon SELECT 정책을 확인했다.
 */

const SUPA_URL = 'https://ltjdaviuglvswkgxmkvl.supabase.co/rest/v1';
const SUPA_KEY = 'sb_publishable_d471VDiUvHlMVgvt1bQF6A_rx3lTLKW';
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

export interface Roster {
  /** vessel_schedules 에 공정이 있는 호선 = 우리가 작업하는 배. */
  working: Set<string>;
  /** 선종·containment 에 DF 가 든 호선 = 초록으로 그릴 배. */
  df: Set<string>;
}

/** 조회 실패. 이때는 전부 진하게 = 지금까지와 같은 화면. */
export const OPEN_ROSTER: Roster = { working: new Set(), df: new Set() };

let cached: { at: number; roster: Roster } | null = null;
const TTL = 10 * 60 * 1000;   // 호선 명부는 하루에 몇 번 바뀔 일이 없다

/** 세이프티원 선종 문자열에도 DF 가 박혀 있다 — "15500 CNTR(LNG DF)". 보조 판정용. */
export function specIsDF(spec: unknown): boolean {
  return /\bDF\b/i.test(String(spec ?? ''));
}

/**
 * 명부를 읽는다. 실패하면 null — 호출부가 "아무것도 흐리지 않음"으로 처리한다.
 * 성공/실패 모두 10분 캐시해서 배를 탭할 때마다 사내망을 때리지 않는다.
 */
export async function fetchRoster(): Promise<Roster | null> {
  if (cached && Date.now() - cached.at < TTL) return cached.roster;
  try {
    const [rs, rv] = await Promise.all([
      fetch(`${SUPA_URL}/vessel_schedules?select=vessel_no`, { headers: HEADERS }),
      fetch(`${SUPA_URL}/vessels?select=vessel_no,vessel_name,containment`, { headers: HEADERS }),
    ]);
    if (!rs.ok || !rv.ok) return null;
    const schedRows: any[] = await rs.json();
    const vesselRows: any[] = await rv.json();
    // 공정이 한 줄도 없으면 명부를 못 읽은 것과 같다 — 전부 흐려지는 사고를 막는다.
    if (!schedRows.length) return null;

    const working = new Set<string>(schedRows.map(r => String(r.vessel_no)));
    const df = new Set<string>(
      vesselRows
        .filter(r => specIsDF(r.containment) || specIsDF(r.vessel_name))
        .map(r => String(r.vessel_no)),
    );
    const roster = { working, df };
    cached = { at: Date.now(), roster };
    return roster;
  } catch {
    return null;
  }
}
