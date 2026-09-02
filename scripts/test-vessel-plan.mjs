/**
 * 호선 카드의 공정·할일 계산 회귀 테스트.
 *
 * 2026-09-02 에 공정 소스를 테이블 `vessel_schedules` → 뷰 `vessel_schedule_rows` 로 바꿨다.
 * 뷰는 한 공정에 묶여 있던 검사를 **별도 행**(`sub_key` 있음, `activity_order` = 부모 + 0.5)으로
 * 펼쳐 준다. 그 과정에서 **조용히 깨질 수 있는 자리**가 생겼고, 이 테스트가 그걸 지킨다.
 *
 * ★날짜를 박지 않는다. 전부 "오늘 기준 며칠 뒤" 로 만든다 —
 *  고정 날짜로 쓰면 며칠 뒤 테스트가 썩고, 썩은 테스트는 없느니만 못하다.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── vessel-plan.ts 를 그대로 돌린다 (픽스처용 사본을 만들지 않는다) ──────────
const out = join(mkdtempSync(join(tmpdir(), 'vp-')), 'vessel-plan.mjs');
execFileSync('npx', ['esbuild', 'src/lib/vessel-plan.ts', '--format=esm', '--target=es2022', `--outfile=${out}`],
  { stdio: 'pipe' });
const { fetchVesselPlan } = await import(out);

// ── 날짜 도우미 (모듈 안 로직과 같은 방식: 로컬 기준) ────────────────────────
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(new Date());
const day = n => { const [y, m, d] = TODAY.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };

// ── 픽스처 ────────────────────────────────────────────────────────────────
const RULE = {
  id: 'rule-passinghole', activity_order: 25, title: '본딩샵 패싱홀 불출',
  lead_days: 7, active: true, per_tank: true, tanks: null,
};

/** 호선별 공정 행. `order` 를 문자열로 줄지 숫자로 줄지도 시험 대상이다. */
const SCHED = {
  // ① 세부 검사가 창 안(D-2)과 창 밖(D+9)에 하나씩
  A: [
    { tank_no: 3, activity_order: 19, activity_name: '부모 공정', planned_start_date: day(4), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
    { tank_no: 3, activity_order: 19.5, activity_name: '8.5단 SPRAY PIPE T/W', planned_start_date: day(2), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: 'tw_85' },
    { tank_no: 4, activity_order: 19.5, activity_name: '8.5단 SPRAY PIPE T/W', planned_start_date: day(2), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: 'tw_85' },
    { tank_no: 1, activity_order: 1.5, activity_name: '창 밖 세부 검사', planned_start_date: day(9), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: 'final' },
    { tank_no: 1, activity_order: 25, activity_name: '패싱홀 클로징', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
  ],
  // ② 표준 호선(부모 max 36)인데 36번에 세부가 붙어 36.5 가 생긴다 → DF 오인 함정
  B: [
    { tank_no: 1, activity_order: 36, activity_name: '마지막 공정', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
    { tank_no: 1, activity_order: 36.5, activity_name: '막판 검사', planned_start_date: day(3), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: 'final' },
    { tank_no: 1, activity_order: 25, activity_name: '패싱홀 클로징', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
  ],
  // ③ 진짜 DF 호선 — 부모 행 자체가 36 을 넘는다
  C: [
    { tank_no: 1, activity_order: 47, activity_name: 'DF 전용 공정', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
    { tank_no: 1, activity_order: 25, activity_name: '패싱홀 클로징', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
  ],
  // ④ ②와 같은데 activity_order 가 **문자열**로 온다 (numeric 직렬화 대비)
  D: [
    { tank_no: 1, activity_order: '36', activity_name: '마지막 공정', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
    { tank_no: 1, activity_order: '36.5', activity_name: '막판 검사', planned_start_date: day(3), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: 'final' },
    { tank_no: 1, activity_order: '25', activity_name: '패싱홀 클로징', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
  ],
  // ⑤ 세부 행이 준비 계산에 끼어들지 않는가 — 25번 세부(25.5)가 더 이른 날짜를 갖는다.
  //    끼어들면 준비 마감일이 그쪽으로 당겨져 틀린 날이 나온다.
  E: [
    { tank_no: 1, activity_order: 25, activity_name: '패싱홀 클로징', planned_start_date: day(12), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: null },
    { tank_no: 1, activity_order: 25.5, activity_name: '패싱홀 검사', planned_start_date: day(8), duration_days: 1, applicable: true, actual_start_date: null, status: 'pending', sub_key: 'final' },
  ],
};

let usedTable = null;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const hull = (u.searchParams.get('vessel_no') ?? '').replace('eq.', '');
  const json = body => ({ ok: true, json: async () => body });
  if (table === 'vessel_schedule_rows' || table === 'vessel_schedules') {
    usedTable = table;
    return json(SCHED[hull] ?? []);
  }
  if (table === 'prep_rules') return json([RULE]);
  if (table === 'prep_checks') return json([]);
  if (table === 'work_tasks') return json([]);
  throw new Error(`예상 못 한 테이블: ${table}`);
};

// ── 단언 ──────────────────────────────────────────────────────────────────
let fail = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? '✅' : '❌'} ${msg}`); if (!cond) fail++; };
const labels = list => list.map(i => i.label);
const prep = p => p.tasks.filter(t => t.kind === '준비');

console.log(`오늘 = ${TODAY}\n`);

console.log('[1] 뷰를 읽는가, 그리고 세부 검사가 보이는가');
const A = await fetchVesselPlan('A');
ok(usedTable === 'vessel_schedule_rows', `테이블이 아니라 뷰를 읽는다 (실제: ${usedTable})`);
const tw = A.upcoming.find(i => i.label.includes('8.5단 SPRAY PIPE T/W'));
ok(!!tw, '세부 검사 줄이 나온다');
ok(tw?.label === '3·4탱크 8.5단 SPRAY PIPE T/W',
  `탱크가 묶여 앞에 붙는다 (실제: ${tw?.label})`);
ok(tw?.detail === true, '세부 행에 detail 표시가 붙는다 (화면의 └)');
ok(A.upcoming.find(i => i.label === '부모 공정')?.detail === undefined,
  '부모 행에는 detail 이 안 붙는다');
ok(!labels(A.upcoming).some(l => l.includes('창 밖')),
  'D-5 창 밖의 세부 검사는 안 나온다');
ok(!labels(A.upcoming).some(l => l.includes('tw_85') || l.includes('final')),
  'sub_key 값이 화면 글귀에 새지 않는다');

console.log('\n[2] 세부 행 때문에 표준 호선이 DF 로 오인되지 않는가');
const B = await fetchVesselPlan('B');
ok(prep(B).length > 0,
  `부모 max 36 + 세부 36.5 → 준비가 살아 있다 (실제 ${prep(B).length}건)`);
const C = await fetchVesselPlan('C');
ok(prep(C).length === 0,
  `진짜 DF(부모 47) → 준비를 빼는 것은 그대로 (실제 ${prep(C).length}건)`);

console.log('\n[3] activity_order 가 문자열로 와도 준비가 살아 있는가');
const D = await fetchVesselPlan('D');
ok(prep(D).length > 0,
  `numeric 이 문자열로 직렬화돼도 준비가 계산된다 (실제 ${prep(D).length}건)`);

console.log('\n[4] 세부 행이 준비 계산에 끼어들지 않는가');
const E = await fetchVesselPlan('E');
const e = prep(E)[0];
ok(prep(E).length === 1, `준비 1건 (실제 ${prep(E).length}건)`);
ok(e?.date === day(5),
  `마감일은 부모(D+12)−7 = D+5 여야 한다. 세부(D+8)에 끌려가면 안 된다 (실제 ${e?.date} / 기대 ${day(5)})`);

console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
