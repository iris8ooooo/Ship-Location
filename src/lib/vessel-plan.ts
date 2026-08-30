/**
 * 호선 탭 카드에 보여줄 "그 호선의 오늘" — 공정관리비서(Supabase)에서 읽는다.
 *
 * 공정관리 앱으로 진입하는 대신 카드 안에서 바로 보여준다(2026-08-29 사용자 지시).
 * 노출 규칙은 사용자가 정한 "공정기준 -5일":
 *   - 공정(vessel_schedules): 오늘 걸쳐 있는 것 + 시작이 5일 안으로 다가온 것
 *   - 업무탭 할일(work_tasks)은 올리지 않는다(2026-08-29 사용자 지시).
 *
 * ★혼동 주의 — 공정관리비서에는 이름이 비슷한 두 곳이 있다 (2026-08-30 에 헷갈려 한 번
 *   잘못 붙였다가 되돌렸다):
 *     · **업무 탭**의 `할일 / 진행 / 완료` 칸 = `work_tasks` 원본. **이걸 올리지 말라는 것.**
 *     · **할일 탭**(사이드바, 대시보드 바로 아래) = 공정·준비·자재·업무를 날짜로 묶은
 *       집계 피드(`src/lib/todo-feed.ts` 의 buildTodoFeed). 이쪽은 나중에 붙일 대상이다.
 *   자세한 정의와 실측 건수는 CLAUDE.md 「공정관리비서 연동」 절에 적어 뒀다.
 *
 * anon 키는 공개용이다(브라우저 번들에 실리는 publishable key, RLS 가 접근을 정한다).
 * 두 테이블 모두 anon SELECT 가 열려 있음을 정책으로 확인했다(2026-08-29).
 */

const SUPA_URL = 'https://ltjdaviuglvswkgxmkvl.supabase.co/rest/v1';
const SUPA_KEY = 'sb_publishable_d471VDiUvHlMVgvt1bQF6A_rx3lTLKW';
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

export interface PlanItem {
  label: string;
  /** YYYY-MM-DD. 날짜 없는 할일은 null. */
  date: string | null;
  /** 오늘 기준 D-day. 음수 = 지났음(지연). 날짜 없으면 null. */
  dday: number | null;
}

export interface VesselPlan {
  /** 오늘 걸쳐 있는 공정 */
  today: PlanItem[];
  /** 시작이 D-5 이내로 다가온 공정 */
  upcoming: PlanItem[];
}

/** 로컬(한국시간) 기준 YYYY-MM-DD. toISOString 은 UTC 라 아침에 어제가 나온다. */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localIso(new Date(y, m - 1, d + n));
}
function diffDays(fromIso: string, toIso: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  return Math.round((p(toIso) - p(fromIso)) / 86400000);
}
export function dateLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

const cache = new Map<string, { at: number; plan: VesselPlan }>();
const TTL = 5 * 60 * 1000;

/** 실패는 null — 카드가 "연결 실패" 한 줄로 보여준다. 조용히 숨기면 죽은 걸 모른다. */
export async function fetchVesselPlan(hull: string): Promise<VesselPlan | null> {
  const hit = cache.get(hull);
  if (hit && Date.now() - hit.at < TTL) return hit.plan;
  const today = localIso(new Date());
  const horizon = addDays(today, 5);

  try {
    const sched = new URLSearchParams({
      vessel_no: `eq.${hull}`,
      status: 'eq.pending',
      planned_start_date: `lte.${horizon}`,
      select: 'tank_no,activity_name,planned_start_date,duration_days,applicable',
    });
    const rs = await fetch(`${SUPA_URL}/vessel_schedules?${sched}`, { headers: HEADERS });
    if (!rs.ok) return null;
    const schedRows: any[] = await rs.json();

    const todayItems: PlanItem[] = [];
    const upcoming: PlanItem[] = [];
    // 같은 공정이 탱크만 다르게 같은 날 시작하면 한 줄로 묶는다 (T1·T2 …).
    const grouped = new Map<string, { tanks: number[]; name: string; start: string }>();
    for (const r of schedRows) {
      if (r.applicable === false || !r.planned_start_date) continue;
      const end = addDays(r.planned_start_date, Math.max(1, r.duration_days ?? 1) - 1);
      if (end < today) continue;                       // 이미 끝난 창(pending 이어도) — 지연분은 소음이라 뺀다
      const key = `${r.activity_name}|${r.planned_start_date}`;
      const g = grouped.get(key) ?? { tanks: [], name: r.activity_name, start: r.planned_start_date };
      g.tanks.push(r.tank_no);
      grouped.set(key, g);
    }
    for (const g of grouped.values()) {
      const tanks = [...new Set(g.tanks)].sort((a, b) => a - b).map(t => `T${t}`).join('·');
      const item: PlanItem = { label: `${tanks} ${g.name}`, date: g.start, dday: diffDays(today, g.start) };
      (g.start <= today ? todayItems : upcoming).push(item);
    }
    upcoming.sort((a, b) => (a.date! < b.date! ? -1 : 1));

    const plan = { today: todayItems, upcoming };
    cache.set(hull, { at: Date.now(), plan });
    return plan;
  } catch {
    return null;
  }
}
