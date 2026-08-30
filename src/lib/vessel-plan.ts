/**
 * 호선 탭 카드에 보여줄 "그 호선의 오늘" — 공정관리비서(Supabase)에서 읽는다.
 *
 * 공정관리 앱으로 진입하는 대신 카드 안에서 바로 보여준다(2026-08-29 사용자 지시).
 *   - 공정(vessel_schedules): 오늘 걸쳐 있는 것 + 시작이 5일 안으로 다가온 것
 *     ("공정기준 -5일" — 2026-08-29 사용자 지시. 할일탭의 +14일과 일부러 다르다.)
 *   - 할일: 공정관리비서 **사이드바 `할일` 탭**의 `업무`·`준비` 두 종류 (2026-08-30 사용자 지시)
 *
 * ★혼동 주의 — 공정관리비서에는 이름이 비슷한 두 곳이 있다. 2026-08-30 에 헷갈려
 *   한 번 잘못 붙였다가 통째로 되돌렸다(#72 → #73):
 *     · **업무 탭**의 `할일 / 진행 / 완료` 칸 = work_tasks 원본. **이건 올리지 않는다.**
 *     · **할일 탭**(대시보드 바로 아래) = 날짜 있는 것만 모은 집계 피드.
 *       원본은 LNG 앱 `src/lib/todo-feed.ts` 의 `buildTodoFeed` — 아래 로직은 그걸 옮긴 것이다.
 *
 * 할일탭이 모으는 다섯 종류 중 여기 옮긴 것은 **업무·준비 둘**이다.
 *   · 업무: work_tasks 중 `status ≠ done` **이면서 마감일이 있는 것**. `진행`도 포함하고,
 *     마감일이 없으면 아예 안 올라간다. (`status=todo` 로 거르면 그게 업무탭 칸이다.)
 *   · 준비: prep_rules 의 트리거일 = 공정 계획일 − lead_days. prep_checks 완료분 제외.
 *   · 자재통보·자재지연은 **옮기지 않았다** — 파생 로직이 LNG 앱 materials.ts 843줄이라
 *     복사하면 두 앱이 조용히 갈라진다. 하려면 DB 에 공용 뷰를 만들어 둘이 같이 쓴다.
 *
 * ★PostgREST 필터는 `eq.` 만 쓴다. 이 개발 환경은 프록시가 supabase.co 를 막아 REST 문법을
 *   실서버로 확인할 방법이 없고, 문법이 틀리면 에러가 아니라 **빈 목록**으로 조용히 돌아온다.
 *   그래서 `neq.`·`not.is.null`·`in.(...)` 을 쓰지 않고 넉넉히 받아 코드에서 거른다
 *   (한 호선당 공정 144행·업무 14행 이하라 부담이 없다).
 *
 * anon 키는 공개용이다(브라우저 번들에 실리는 publishable key, RLS 가 접근을 정한다).
 * 세 테이블 모두 anon SELECT 정책이 열려 있음을 확인했다(2026-08-30).
 */

const SUPA_URL = 'https://ltjdaviuglvswkgxmkvl.supabase.co/rest/v1';
const SUPA_KEY = 'sb_publishable_d471VDiUvHlMVgvt1bQF6A_rx3lTLKW';
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

/** `vessel_no` 가 이 값이면 특정 호선이 아니라 전 호선 공통 할일이다(자유 텍스트 컬럼). */
const ALL_SHIPS = '모든호선';

/** 할일탭이 미래를 보는 범위. LNG 앱 buildTodoFeed 의 withinDays 와 같다. 지연은 항상 포함. */
const FEED_DAYS = 14;

/**
 * 공정관리비서 표준 룰북의 공정 개수. 이보다 큰 activity_order 를 가진 호선은 DF형이라
 * 준비 룰(표준 룰북 기준)을 통째로 적용하지 않는다 — LNG 앱과 같은 규칙이다.
 * ★LNG 앱 `src/lib/rulebook.ts` 의 RULEBOOK 길이와 **같아야 한다.**
 *  실측(2026-08-30): 표준 호선은 max activity_order 가 정확히 36, DF 호선(8292·8300)은 47.
 */
const RULEBOOK_LEN = 36;

export interface PlanItem {
  label: string;
  /** YYYY-MM-DD. */
  date: string | null;
  /** 오늘 기준 D-day. 음수 = 지났음(지연). */
  dday: number | null;
}

export interface TaskItem extends PlanItem {
  /** 할일탭의 종류 라벨. */
  kind: '준비' | '업무';
  /** 부가 설명 — 준비는 겨냥하는 공정 계획일, 업무는 분류. */
  sub: string;
}

export interface VesselPlan {
  /** 오늘 걸쳐 있는 공정 */
  today: PlanItem[];
  /** 시작이 D-5 이내로 다가온 공정 */
  upcoming: PlanItem[];
  /** 할일탭의 업무·준비. D-day 순 — 지난 것이 먼저. */
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
export function dateLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}
/** D-day 표기. 지난 것은 `D+n`(빨강으로 보여준다). */
export function ddayLabel(dday: number | null): string {
  if (dday === null) return '–';
  if (dday === 0) return 'D-DAY';
  return dday < 0 ? `D+${-dday}` : `D-${dday}`;
}

const cache = new Map<string, { at: number; plan: VesselPlan }>();
const TTL = 5 * 60 * 1000;

/** `vessel_no` 로 한 테이블을 통째로 받는다. `eq.` 만 쓴다(위 주석 참고). */
function byVessel(table: string, vessel: string, select: string): string {
  return `${SUPA_URL}/${table}?` + new URLSearchParams({ vessel_no: `eq.${vessel}`, select });
}

/** 실패는 null — 카드가 "연결 실패" 한 줄로 보여준다. 조용히 숨기면 죽은 걸 모른다. */
export async function fetchVesselPlan(hull: string): Promise<VesselPlan | null> {
  const hit = cache.get(hull);
  if (hit && Date.now() - hit.at < TTL) return hit.plan;
  const today = localIso(new Date());
  const horizon = addDays(today, 5);            // 공정 — 사용자가 정한 "공정기준 -5일"
  const feedEnd = addDays(today, FEED_DAYS);    // 할일 — 할일탭과 같은 +14일

  try {
    const soft = (url: string) => fetch(url, { headers: HEADERS }).catch(() => null);
    const [rSched, rTaskHull, rTaskAll, rRules, rChecks] = await Promise.all([
      fetch(byVessel('vessel_schedules', hull,
        'tank_no,activity_order,activity_name,planned_start_date,duration_days,applicable,actual_start_date,status'),
        { headers: HEADERS }),
      soft(byVessel('work_tasks', hull, 'title,category,due_date,status,vessel_no')),
      soft(byVessel('work_tasks', ALL_SHIPS, 'title,category,due_date,status,vessel_no')),
      soft(`${SUPA_URL}/prep_rules?` + new URLSearchParams({ select: 'id,activity_order,title,lead_days,active,per_tank,tanks' })),
      soft(byVessel('prep_checks', hull, 'rule_id,tank_no')),
    ]);
    if (!rSched.ok) return null;
    const schedRows: any[] = await rSched.json();

    // ── 공정 (예전 그대로) ─────────────────────────────────────────
    const todayItems: PlanItem[] = [];
    const upcoming: PlanItem[] = [];
    // 같은 공정이 탱크만 다르게 같은 날 시작하면 한 줄로 묶는다 (T1·T2 …).
    const grouped = new Map<string, { tanks: number[]; name: string; start: string }>();
    for (const r of schedRows) {
      if (r.status !== 'pending' || r.applicable === false || !r.planned_start_date) continue;
      if (r.planned_start_date > horizon) continue;
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

    // ── 할일탭: 업무 + 준비 ────────────────────────────────────────
    // 하나라도 못 읽으면 "할일 불러오기 실패" 를 적는다. 조용히 비워 두면 "할일이 없는 것" 과
    // "못 읽은 것" 을 구분할 수 없다 — 이 프로젝트가 반복해서 당한 조용한 오답이다.
    const tasks: TaskItem[] = [];
    let tasksFailed = !(rTaskHull?.ok && rTaskAll?.ok && rRules?.ok && rChecks?.ok);

    if (!tasksFailed) {
      // 업무 — status ≠ done 그리고 **마감일이 있는 것**만. 진행중도 올라간다.
      for (const r of [...await rTaskHull!.json(), ...await rTaskAll!.json()] as any[]) {
        if (r.status === 'done' || !r.due_date || r.due_date > feedEnd) continue;
        tasks.push({
          kind: '업무', label: r.title, date: r.due_date, dday: diffDays(today, r.due_date),
          sub: `${r.category ?? ''}${r.vessel_no === ALL_SHIPS ? ' · 모든호선' : ''}`.trim(),
        });
      }

      // 준비 — 공정 계획일에서 lead_days 를 뺀 날이 트리거다.
      // 룰은 표준 룰북 기준이라 DF형 호선(activity_order > RULEBOOK_LEN)은 통째로 제외한다.
      const isDF = schedRows.some(r => (r.activity_order ?? 0) > RULEBOOK_LEN);
      if (!isDF) {
        const done = new Set(((await rChecks!.json()) as any[]).map(c => `${c.rule_id}|${c.tank_no ?? 0}`));
        // (공정순번|탱크) → 가장 이른 **미실행** 계획일
        const byTank = new Map<string, { order: number; tank: number; planned: string }>();
        for (const r of schedRows) {
          if (r.applicable === false || r.actual_start_date || r.status === 'completed') continue;
          if (!r.planned_start_date) continue;
          const tank = r.tank_no ?? 0;
          const key = `${r.activity_order}|${tank}`;
          const cur = byTank.get(key);
          if (!cur || r.planned_start_date < cur.planned) {
            byTank.set(key, { order: r.activity_order, tank, planned: r.planned_start_date });
          }
        }
        for (const rule of (await rRules!.json()) as any[]) {
          if (rule.active === false) continue;
          const tankFilter = Array.isArray(rule.tanks) && rule.tanks.length > 0 ? rule.tanks as number[] : null;
          const rows = [...byTank.values()].filter(v =>
            v.order === rule.activity_order && (!tankFilter || tankFilter.includes(v.tank)));
          const push = (tank: number, planned: string) => {
            if (done.has(`${rule.id}|${tank}`)) return;         // 이미 완료 체크한 준비
            const trigger = addDays(planned, -(rule.lead_days ?? 7));
            if (trigger > feedEnd) return;                       // 아직 멀었다
            tasks.push({
              kind: '준비',
              label: rule.per_tank === true ? `${rule.title} (${tank}탱크)` : rule.title,
              // 왼쪽 D-day 는 준비 마감일이고 이건 그 준비가 겨냥하는 공정일이라 서로 다르다.
              // 라벨이 없으면 날짜 두 개가 나란히 떠서 헷갈린다(LNG 앱과 같은 이유).
              sub: `공정 ${dateLabel(planned)}`,
              date: trigger, dday: diffDays(today, trigger),
            });
          };
          if (rule.per_tank === true) {
            for (const v of rows) push(v.tank, v.planned);
          } else {
            // 호선 묶음 — 적용 탱크 중 가장 이른 계획일 1건
            let earliest: string | null = null;
            for (const v of rows) if (!earliest || v.planned < earliest) earliest = v.planned;
            if (earliest) push(0, earliest);
          }
        }
      }
      tasks.sort((a, b) => (a.dday! - b.dday!) || (a.kind < b.kind ? -1 : 1));
    }

    const plan = { today: todayItems, upcoming, tasks, tasksFailed };
    cache.set(hull, { at: Date.now(), plan });
    return plan;
  } catch {
    return null;
  }
}
