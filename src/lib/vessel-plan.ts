/**
 * 호선 탭 카드에 보여줄 "그 호선의 오늘" — 공정관리비서(Supabase)에서 읽는다.
 *
 * 공정관리 앱으로 진입하는 대신 카드 안에서 바로 보여준다(2026-08-29 사용자 지시).
 *   - 공정(vessel_schedule_rows): 오늘 걸쳐 있는 것 + 시작이 다가온 것
 *   - 할일: 공정관리비서 **사이드바 `할일` 탭**의 `업무`·`준비` 두 종류 (2026-08-30 사용자 지시)
 *   둘 다 **오늘부터 5일**까지만 본다("공정기준 -5일" — 2026-08-29·08-30 사용자 지시).
 *   ★할일탭 원본은 +14일을 보지만 여기서는 5일로 좁혔다 — 14일이면 준비만으로 카드가
 *    꽉 찬다(실측 8206: 묶고 나서도 14일 11줄 → 5일 5줄).
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
 * ★공정은 테이블이 아니라 **뷰 `vessel_schedule_rows`** 를 읽는다 (2026-09-02).
 *   한 공정에 묶여 있던 검사가 다른 날 따로 잡히는 경우가 생겼고(부모 행의 `sub_items` jsonb),
 *   공정관리 쪽이 그걸 별도 행으로 펼친 읽기전용 뷰를 만들어 뒀다.
 *   · `sub_key === null` → 예전 그대로의 공정 행 (뷰의 부모 행 1678건 = 테이블 행 수와 일치, 실측)
 *   · `sub_key` 있음 → 세부 검사 행. `activity_order` 는 부모 + 0.5, `duration_days` 1,
 *     `tank_no`·`applicable` 은 부모 것, `id` 는 음수.
 *   ★**종류를 코드에 박지 않는다.** `tw_85`·`final` 같은 값을 분기에 쓰면 새 종류가 생길 때마다
 *    십로케이션을 고쳐야 한다. `sub_key` 가 있냐 없냐만 본다.
 *   ★표기는 **`[19 세부]` 처럼 부모 공정 번호를 앞에 붙인다** (2026-09-03 사용자 지시).
 *    처음엔 `└` 들여쓰기를 썼는데 **이 목록은 표가 아니라 날짜순 피드**라 부모가 바로 위에 없다.
 *    `└` 는 "바로 위 줄에 딸린 것" 이라는 뜻이므로 날짜순에서는 거짓말이 된다 —
 *    부모가 5일 창 밖이면 아예 없고, 있어도 다른 날짜라 멀리 떨어져 있다.
 *    번호를 적으면 어느 공정의 세부인지가 줄 하나로 닫힌다. (`└` 는 공정 번호순 표에서만 맞다.)
 *    부모 번호는 `floor(activity_order)` 다 — 19.5 → 19.
 *
 * ★뷰로 바꾸면서 **조용히 깨질 자리 둘**을 같이 막았다(실제로 깨지기 전에 잡은 것이다):
 *   ① `activity_order` 자료형이 **integer → numeric** 으로 바뀐다(실측: 테이블 integer,
 *      뷰 numeric). PostgREST 가 numeric 을 문자열로 내보내면 `v.order === rule.activity_order`
 *      (prep_rules 는 integer)가 **전부 false** 가 되어 준비가 통째로 사라진다. 에러가 아니라
 *      빈 목록이라 아무도 모른다. 이 개발환경은 프록시가 supabase.co 를 막아 실서버로 확인할
 *      방법이 없으므로 **읽는 자리에서 `Number()` 로 못박는다** — 어느 쪽이든 안전하다.
 *   ② DF 판정(`max activity_order > 36`)에 세부 행이 섞이면, 표준 호선의 36번 공정에 세부
 *      검사가 붙는 순간 36.5 > 36 이 되어 **DF 로 오인**되고 준비가 통째로 사라진다.
 *      지금은 세부가 19.5·1.5 뿐이라 안 걸리지만(실측) 시간문제였다. **부모 행만 보고 판정한다.**
 *
 * anon 키는 공개용이다(브라우저 번들에 실리는 publishable key, RLS 가 접근을 정한다).
 * 세 테이블 모두 anon SELECT 정책이 열려 있음을 확인했다(2026-08-30).
 * 뷰도 anon SELECT 가 열려 있고 `security_invoker=true` 라 밑 테이블의 RLS 를 그대로 탄다(2026-09-02 확인).
 */

const SUPA_URL = 'https://ltjdaviuglvswkgxmkvl.supabase.co/rest/v1';
const SUPA_KEY = 'sb_publishable_d471VDiUvHlMVgvt1bQF6A_rx3lTLKW';
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

/** `vessel_no` 가 이 값이면 특정 호선이 아니라 전 호선 공통 할일이다(자유 텍스트 컬럼). */
const ALL_SHIPS = '모든호선';

/** 앞으로 며칠까지 볼 것인가. **공정과 할일이 같은 값을 쓴다** — 임계값을 두 군데 두면
 *  한쪽만 고치게 된다. 지난 것(지연)은 이 값과 무관하게 항상 올라온다.
 *  (참고: 할일탭 원본은 14일. 여기서는 사용자 지시로 5일.) */
const HORIZON_DAYS = 5;

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
  /** 부모 공정에서 떨어져 나온 세부 검사(뷰의 `sub_key` 있는 행).
   *  표기는 `label` 이 이미 `[19 세부]` 로 달고 있다 — 이 값은 그 사실 자체다(테스트가 문자열
   *  대신 이걸로 판정한다). 화면이 따로 꾸미지 않는다. */
  detail?: boolean;
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
/**
 * 탱크 묶음 표기 — `1·2탱크 `(뒤에 공백). 탱크가 없으면 빈 문자열.
 * ★**이름 앞에** 붙인다 (2026-08-30 사용자 지시). 뒤에 붙였더니 공정명이 길 때
 *  `truncate` 에 잘려 탱크번호가 통째로 안 보였다 — 정작 제일 먼저 봐야 할 값이다.
 * ★공정과 준비가 **같은 함수**를 쓴다 (2026-08-30 사용자 지시로 표기를 통일했다).
 *  각자 따로 만들면 한쪽만 고치게 된다 — 실제로 공정은 `T1·T2 이름`, 준비는
 *  `이름 (1·2탱크)` 로 갈라져 있었다.
 *  ★탱크가 안 붙어 있어도 그대로 나열한다(`1·3탱크`). `1~3` 처럼 범위로 줄이면
 *   빠진 2탱크가 포함된 것처럼 보인다.
 */
export function tankPrefix(tanks: number[]): string {
  const t = [...new Set(tanks)].filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  return t.length ? `${t.join('·')}탱크 ` : '';
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
  const horizon = addDays(today, HORIZON_DAYS);   // 공정·할일 공통

  try {
    const soft = (url: string) => fetch(url, { headers: HEADERS }).catch(() => null);
    const [rSched, rTaskHull, rTaskAll, rRules, rChecks] = await Promise.all([
      fetch(byVessel('vessel_schedule_rows', hull,
        'tank_no,activity_order,activity_name,planned_start_date,duration_days,applicable,actual_start_date,status,sub_key'),
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
    const grouped = new Map<string, { tanks: number[]; name: string; start: string; parent: number | null }>();
    for (const r of schedRows) {
      if (r.status !== 'pending' || r.applicable === false || !r.planned_start_date) continue;
      if (r.planned_start_date > horizon) continue;
      const end = addDays(r.planned_start_date, Math.max(1, r.duration_days ?? 1) - 1);
      if (end < today) continue;                       // 이미 끝난 창(pending 이어도) — 지연분은 소음이라 뺀다
      // 세부 행이면 부모 공정 번호(19.5 → 19). 부모 행이면 null.
      const parent = r.sub_key != null ? Math.floor(Number(r.activity_order)) : null;
      // 묶음 키에 sub_key 와 부모 번호를 넣는다 — 세부 검사가 부모와 같은 이름·같은 날이면
      // 한 줄로 뭉쳐 세부인지 아닌지가 사라지고, 같은 세부가 서로 다른 부모에 걸리면
      // 둘 중 한 번호만 살아남는다. 지금은 안 겹치지만 그건 우연이다.
      const key = `${r.sub_key ?? ''}|${parent ?? ''}|${r.activity_name}|${r.planned_start_date}`;
      const g = grouped.get(key)
        ?? { tanks: [], name: r.activity_name, start: r.planned_start_date, parent };
      g.tanks.push(r.tank_no);
      grouped.set(key, g);
    }
    for (const g of grouped.values()) {
      // 탱크 → 부모번호 → 이름 순. 제일 먼저 봐야 할 값이 앞에 온다(탱크 표기와 같은 이유).
      const mark = g.parent != null ? `[${g.parent} 세부] ` : '';
      const item: PlanItem = {
        label: `${tankPrefix(g.tanks)}${mark}${g.name}`, date: g.start, dday: diffDays(today, g.start),
        ...(g.parent != null ? { detail: true } : {}),
      };
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
        if (r.status === 'done' || !r.due_date || r.due_date > horizon) continue;
        tasks.push({
          kind: '업무', label: r.title, date: r.due_date, dday: diffDays(today, r.due_date),
          sub: `${r.category ?? ''}${r.vessel_no === ALL_SHIPS ? ' · 모든호선' : ''}`.trim(),
        });
      }

      // 준비 — 공정 계획일에서 lead_days 를 뺀 날이 트리거다.
      // 룰은 표준 룰북 기준이라 DF형 호선(activity_order > RULEBOOK_LEN)은 통째로 제외한다.
      // ★부모 행만 본다. 세부 행(부모+0.5)을 섞으면 36번 공정에 세부가 붙는 순간
      //  36.5 > 36 이라 표준 호선이 DF 로 오인되고 준비가 통째로 사라진다.
      const isDF = schedRows.some(r => r.sub_key == null && Number(r.activity_order ?? 0) > RULEBOOK_LEN);
      if (!isDF) {
        const done = new Set(((await rChecks!.json()) as any[]).map(c => `${c.rule_id}|${c.tank_no ?? 0}`));
        // (공정순번|탱크) → 가장 이른 **미실행** 계획일
        const byTank = new Map<string, { order: number; tank: number; planned: string }>();
        for (const r of schedRows) {
          if (r.sub_key != null) continue;               // 준비 룰은 부모 공정 번호에 걸린다
          if (r.applicable === false || r.actual_start_date || r.status === 'completed') continue;
          if (!r.planned_start_date) continue;
          const tank = r.tank_no ?? 0;
          // ★Number() 로 못박는다 — 뷰의 activity_order 는 numeric 이라 문자열로 올 수 있고,
          //  그러면 아래 `v.order === rule.activity_order`(integer)가 전부 false 가 되어
          //  준비가 조용히 사라진다.
          const order = Number(r.activity_order);
          const key = `${order}|${tank}`;
          const cur = byTank.get(key);
          if (!cur || r.planned_start_date < cur.planned) {
            byTank.set(key, { order, tank, planned: r.planned_start_date });
          }
        }
        for (const rule of (await rRules!.json()) as any[]) {
          if (rule.active === false) continue;
          const tankFilter = Array.isArray(rule.tanks) && rule.tanks.length > 0 ? rule.tanks as number[] : null;
          const rows = [...byTank.values()].filter(v =>
            v.order === Number(rule.activity_order) && (!tankFilter || tankFilter.includes(v.tank)));
          /** @param tanks 탱크별 룰이면 묶인 탱크들, 호선 묶음 룰이면 빈 배열. */
          const push = (tanks: number[], planned: string, trigger: string) => {
            tasks.push({
              kind: '준비',
              label: `${tankPrefix(tanks)}${rule.title}`,
              // 왼쪽 D-day 는 준비 마감일이고 이건 그 준비가 겨냥하는 공정일이라 서로 다르다.
              // 라벨이 없으면 날짜 두 개가 나란히 떠서 헷갈린다(LNG 앱과 같은 이유).
              sub: `공정 ${dateLabel(planned)}`,
              date: trigger, dday: diffDays(today, trigger),
            });
          };
          if (rule.per_tank === true) {
            // ★같은 준비가 같은 날 걸리면 한 줄로 묶는다 (2026-08-30 사용자 지시).
            //  탱크마다 한 줄이면 8206 이 준비만 17줄이라 카드가 그걸로 꽉 찬다.
            //  묶는 기준은 (룰, 마감일)이다. 마감일 = 공정일 − lead_days 이고 lead 는 룰마다
            //  고정이라, 같은 마감일이면 겨냥하는 공정일도 자동으로 같다.
            const bunch = new Map<string, { tanks: number[]; planned: string }>();
            for (const v of rows) {
              if (done.has(`${rule.id}|${v.tank}`)) continue;   // 이미 완료 체크한 준비
              const trigger = addDays(v.planned, -(rule.lead_days ?? 7));
              if (trigger > horizon) continue;                   // 아직 멀었다
              const g = bunch.get(trigger) ?? { tanks: [], planned: v.planned };
              g.tanks.push(v.tank);
              bunch.set(trigger, g);
            }
            for (const [trigger, g] of bunch) push(g.tanks, g.planned, trigger);
          } else {
            // 호선 묶음 — 적용 탱크 중 가장 이른 계획일 1건. 탱크 표기가 없다.
            if (done.has(`${rule.id}|0`)) continue;
            let earliest: string | null = null;
            for (const v of rows) if (!earliest || v.planned < earliest) earliest = v.planned;
            if (!earliest) continue;
            const trigger = addDays(earliest, -(rule.lead_days ?? 7));
            if (trigger > horizon) continue;
            push([], earliest, trigger);
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
