/**
 * 호선 탭 카드에 보여줄 "그 호선의 오늘" — 공정관리비서(Supabase)에서 읽는다.
 *
 * 공정관리 앱으로 진입하는 대신 카드 안에서 바로 보여준다(2026-08-29 사용자 지시).
 * 노출 규칙은 사용자가 정한 "공정기준 -5일":
 *   - 공정(vessel_schedules): 오늘 걸쳐 있는 것 + 시작이 5일 안으로 다가온 것
 *   - 할일(work_tasks): **`할일` 칸에 있는 것만**(status = todo), D-day 순
 *     (2026-08-30 사용자 지시로 추가)
 *
 * ★08-29 에 "빼라" 던 것과 지금 "넣어라" 는 것은 서로 다른 것이다 (2026-08-30 사용자 정정).
 *   업무탭은 `할일 / 진행 / 완료` 세 칸짜리다. 08-29 에 뺀 것은 **그 세 칸 전부**였고,
 *   지금 넣으라는 것은 대시보드 밑의 **`할일` 한 칸**이다. 그래서 `todo` 만 읽는다 —
 *   `in_progress`(진행)·`done`(완료)는 올리지 않는다.
 *
 * ★할일의 실제 데이터 실태 (2026-08-30 실측, 전체 87건):
 *   미완료 13건 중 **호선이 붙은 것은 5건**(8207·8208·8262·8292·8300 각 1건)이고,
 *   **마감일이 있는 미완료 할일은 1건뿐**이며 그마저 호선이 안 붙어 있다.
 *   즉 지금은 카드에 뜨는 할일이 거의 전부 "날짜 없음" 이다 — 정렬은 맞게 돌지만
 *   눈에 보이는 효과는 마감일을 넣기 시작해야 생긴다. 코드가 틀린 게 아니다.
 *
 * ★`vessel_no` 는 자유 텍스트다. 호선번호 말고 `모든호선`·`매립지 압테스트장` 같은
 *   값도 들어 있다. `모든호선` 은 모든 배에 해당한다는 뜻이라 어느 호선을 눌러도 같이 뜬다.
 *
 * anon 키는 공개용이다(브라우저 번들에 실리는 publishable key, RLS 가 접근을 정한다).
 * 두 테이블 모두 anon SELECT 정책이 열려 있음을 확인했다(work_tasks_select · anon read vs).
 */

/** `vessel_no` 가 이 값이면 특정 호선이 아니라 전 호선 공통 할일이다. */
const ALL_SHIPS = '모든호선';

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

export interface TaskItem extends PlanItem {
  /** 업무탭 분류(자재·소모품관련 …) */
  category: string;
  /** 이 호선 것이 아니라 `모든호선` 으로 걸린 것 */
  allShips: boolean;
}

export interface VesselPlan {
  /** 오늘 걸쳐 있는 공정 */
  today: PlanItem[];
  /** 시작이 D-5 이내로 다가온 공정 */
  upcoming: PlanItem[];
  /** 끝나지 않은 할일. D-day 순 — 지난 것 → 임박한 것 → 날짜 없는 것 순. */
  tasks: TaskItem[];
  /** 할일만 못 읽었을 때. 공정은 살아 있으므로 카드를 통째로 죽이지 않는다. */
  tasksFailed: boolean;
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
/** D-day 표기. 지난 것은 `D+n`(빨강으로 보여준다), 날짜 없는 것은 `–`. */
export function ddayLabel(dday: number | null): string {
  if (dday === null) return '–';
  if (dday === 0) return 'D-DAY';
  return dday < 0 ? `D+${-dday}` : `D-${dday}`;
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
    // 할일은 공정과 **같이** 부른다. 순서대로 부르면 카드가 두 번 늦게 찬다.
    // ★한 호선 것과 `모든호선` 것을 `in.(...)` 로 한 번에 부르지 않고 **eq 두 번**으로 나눴다.
    //  `in.()` 안에 한글·따옴표를 넣는 문법은 이 개발 환경에서 실제 서버로 확인할 방법이
    //  없고(프록시가 supabase.co 를 막는다), 틀리면 에러가 아니라 **빈 목록**으로 조용히
    //  돌아온다. `eq.` 는 바로 위 공정 조회가 프로덕션에서 이미 쓰고 있는 문법이다.
    const taskUrl = (vessel: string) => `${SUPA_URL}/work_tasks?` + new URLSearchParams({
      vessel_no: `eq.${vessel}`,
      status: 'eq.todo',                            // `진행`·`완료` 는 올리지 않는다
      order: 'sort_order.asc',
      select: 'title,category,due_date,vessel_no',
    });
    const [rs, rtHull, rtAll] = await Promise.all([
      fetch(`${SUPA_URL}/vessel_schedules?${sched}`, { headers: HEADERS }),
      fetch(taskUrl(hull), { headers: HEADERS }).catch(() => null),
      fetch(taskUrl(ALL_SHIPS), { headers: HEADERS }).catch(() => null),
    ]);
    if (!rs.ok) return null;
    const schedRows: any[] = await rs.json();

    // 할일이 실패해도 공정은 보여준다. 대신 실패했다고 화면에 적는다 —
    // 조용히 비워 두면 "할일이 없는 것" 과 "못 읽은 것" 을 구분할 수 없다.
    let tasks: TaskItem[] = [];
    let tasksFailed = false;
    if (rtHull?.ok && rtAll?.ok) {
      const taskRows: any[] = [...await rtHull.json(), ...await rtAll.json()];
      tasks = taskRows.map((r): TaskItem => ({
        label: r.title,
        date: r.due_date ?? null,
        dday: r.due_date ? diffDays(today, r.due_date) : null,
        category: r.category ?? '',
        allShips: r.vessel_no === ALL_SHIPS,
      }));
      // D-day 순. 날짜 없는 것은 맨 뒤로 — sort 가 안정적이라 업무탭 순서를 지킨다.
      tasks.sort((a, b) => {
        if (a.dday === null || b.dday === null) return a.dday === b.dday ? 0 : a.dday === null ? 1 : -1;
        return a.dday - b.dday;                       // 지난 것(음수)이 먼저
      });
    } else {
      tasksFailed = true;
    }

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

    const plan = { today: todayItems, upcoming, tasks, tasksFailed };
    cache.set(hull, { at: Date.now(), plan });
    return plan;
  } catch {
    return null;
  }
}
