/**
 * 호선 명부 — 공정관리비서(Supabase)에서 "우리 호선"과 "DF 호선"을 읽는다.
 *
 * 지도에는 야드의 모든 배가 뜨지만 우리가 붙는 배는 절반도 안 된다(실측 25척 중 10척).
 * 그래서 두 가지를 여기서 정한다:
 *   - 우리 호선: 공정관리비서 `vessels` 에 등록된 호선. 진하게 그린다.
 *   - DF 호선: `containment`/`vessel_name` 에 'DF' 가 있으면 초록, 아니면 노랑.
 *     (2026-08-29 사용자 지시: 대부분 LNGC 라 노랑, 늘어나는 CNTR DF 를 초록으로 가른다)
 *
 * ★2026-08-29 사고 — vessel_schedules 를 통째로 받으면 안 된다 ⭐
 *   처음엔 "vessel_schedules 에 한 줄이라도 있으면 우리 배" 로 짰다. 그런데
 *   Supabase REST(PostgREST)는 응답을 **1000행에서 자른다**(프로덕션 로그의
 *   `Content-Range: 0-999/*` 로 확인). vessel_schedules 는 호선당 144줄씩 1678행이라
 *   앞쪽 7척(8198~8207)에서 잘렸고, 뒤쪽 8208·8254·8262·8263·8292·8300 이
 *   "공정 없는 배" 로 오인돼 우리 배가 흐려졌다.
 *   → 명부는 **호선당 한 줄인 `vessels`(15행)** 에서 읽는다. 행 수가 호선 수와 같으니
 *     상한에 닿을 수가 없다. 요청도 두 번에서 한 번으로 준다.
 *   → 그래도 상한에 닿으면(>= MAX_ROWS) 명부를 못 믿으므로 fail open 한다.
 *
 * ★조회에 실패하면 아무것도 흐리지 않는다. 멀쩡한 배가 사라진 것처럼 보이는 쪽이
 *   덜 정리된 화면보다 훨씬 나쁘다 — fail open 이 맞다.
 *
 * anon publishable 키는 공개용이고, anon SELECT 정책을 확인했다.
 */

const SUPA_URL = 'https://ltjdaviuglvswkgxmkvl.supabase.co/rest/v1';
const SUPA_KEY = 'sb_publishable_d471VDiUvHlMVgvt1bQF6A_rx3lTLKW';
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

/** PostgREST 가 한 번에 주는 최대 행 수. 여기에 닿았으면 잘린 것이라 믿을 수 없다. */
const MAX_ROWS = 1000;

export interface Roster {
  /** 공정관리비서에 등록된 호선 = 우리가 작업하는 배. */
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
    const r = await fetch(
      `${SUPA_URL}/vessels?select=vessel_no,vessel_name,containment`, { headers: HEADERS });
    if (!r.ok) return null;
    const rows: any[] = await r.json();
    // 한 척도 못 읽었거나(명부 실패) 상한에 닿아 잘렸으면(명부 불완전) 흐리지 않는다.
    if (!rows.length || rows.length >= MAX_ROWS) return null;

    const working = new Set<string>(rows.map(v => String(v.vessel_no)));
    const df = new Set<string>(
      rows
        .filter(v => specIsDF(v.containment) || specIsDF(v.vessel_name))
        .map(v => String(v.vessel_no)),
    );
    const roster = { working, df };
    cached = { at: Date.now(), roster };
    return roster;
  } catch {
    return null;
  }
}
