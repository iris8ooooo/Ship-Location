/**
 * 「이름을 또 묻지 않는가」 회귀 테스트 — 실제 코드를 그대로 돌린다.
 *
 * 2026-09-05 여기서 틀렸다. 접속 집계를 붙이면서 `visitorName` 이라는 **두 번째 이름 칸**을
 * 만들었는데, 이 앱에는 이미 `adminName`(관리자 전환 시 받는 「작업 이력에 남길 성함」)이
 * 있었다. 그래서 **이미 이름을 등록한 사람에게 또 물었다.**
 *
 * 이 파일이 지키는 것 셋:
 *  ① 이미 등록한 사람에게 다시 묻지 않는다
 *  ② 「나중에」가 관리자 이름을 **지우지 않는다** (지우면 다음 이력이 이름 없이 남는다)
 *  ③ 둘째 칸을 쓰던 하루치 사용자도 그대로 이어진다
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── 가짜 localStorage. 모듈이 **함수 안에서** 읽으므로 import 전에 심어 두면 된다 ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: k => void store.delete(k),
};
const reset = (seed = {}) => { store.clear(); for (const [k, v] of Object.entries(seed)) store.set(k, v); };

const out = join(mkdtempSync(join(tmpdir(), 'vn-')), 'visitor-name.mjs');
execFileSync('npx', ['esbuild', 'src/lib/visitor-name.ts', '--format=esm', '--target=es2022', `--outfile=${out}`],
  { stdio: 'pipe' });
const { getVisitorName, setVisitorName, nameAsked, NAME_MAX } = await import(out);

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${what}`); }
  else { fail++; console.log(`  ✗ ${what}\n      기대 ${w}\n      실제 ${g}`); }
};

console.log('\n① 관리자로 이미 이름을 적은 사람 — 다시 묻지 않는다 ★사용자가 지적한 것');
{
  reset({ adminName: '김은호', isAdmin: 'true' });
  eq(nameAsked(), true, '카드를 띄우지 않는다');
  eq(getVisitorName(), '김은호', '집계에 그 이름이 그대로 쓰인다');
}

console.log('\n② 아무것도 없는 새 기기 — 한 번은 묻는다');
{
  reset();
  eq(nameAsked(), false, '처음엔 묻는다');
  setVisitorName('박철수');
  eq(nameAsked(), true, '적고 나면 안 묻는다');
  eq(getVisitorName(), '박철수', '이름이 남는다');
  eq(store.get('adminName'), '박철수', '★관리자 이름 칸에 쓴다 — 사본을 만들지 않는다');
}

// ★닫는 버튼(「나중에」)은 2026-09-05 에 뺐다. 부르는 곳은 없지만 가드는 남아 있고,
//  다시 닫는 버튼을 붙이는 날 이 함정을 또 밟게 되므로 시험은 그대로 둔다.
console.log('\n③ 빈 이름으로 부르면 — **관리자 이름을 지우지 않는다** (가드)');
{
  reset({ adminName: '김은호' });
  setVisitorName('');                       // 닫는 버튼이 부르던 것
  eq(getVisitorName(), '김은호', '★이름이 살아 있다 (지우면 이력이 이름 없이 남는다)');
  eq(nameAsked(), true, '다시 안 묻는다');
}
{
  reset();
  setVisitorName('');                       // 이름 없는 사람이 그냥 닫은 경우
  eq(getVisitorName(), '', '이름은 없다');
  eq(nameAsked(), true, '그래도 다시 안 묻는다 (성가시면 아무도 안 적는다)');
  eq(store.has('adminName'), false, '빈 이름을 만들어 두지 않는다');
}

console.log('\n④ 둘째 칸을 쓰던 하루치 사용자 — 그대로 이어진다');
{
  reset({ visitorName: '이영희' });
  eq(getVisitorName(), '이영희', '옛 칸에서 읽어 온다');
  eq(nameAsked(), true, '다시 묻지 않는다');
}
{
  reset({ visitorName: '' });               // 옛 「나중에」
  eq(getVisitorName(), '', '이름 없음');
  eq(nameAsked(), true, '이미 물어본 사람이다');
}
{
  reset({ adminName: '김은호', visitorName: '오타' });
  eq(getVisitorName(), '김은호', '★둘 다 있으면 관리자 이름이 이긴다');
}

console.log('\n⑤ 길이 상한 · 공백');
{
  reset();
  setVisitorName('  홍길동  ');
  eq(getVisitorName(), '홍길동', '앞뒤 공백을 턴다');
  reset();
  setVisitorName('가'.repeat(40));
  eq(getVisitorName().length, NAME_MAX, `${NAME_MAX}자에서 자른다 (규칙이 거부하는 길이)`);
  reset();
  setVisitorName('   ');
  eq(store.has('adminName'), false, '공백만 적은 것은 이름이 아니다');
  eq(nameAsked(), true, '그래도 물어본 것으로 친다');
}

console.log('\n⑥ 저장소가 막힌 브라우저(사파리 비공개) — 앱이 죽지 않는다');
{
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  eq(getVisitorName(), '', '이름은 빈 값');
  eq(nameAsked(), true, '★물어봐야 저장할 곳이 없으므로 안 묻는다');
  setVisitorName('김은호');           // 던지면 안 된다
  eq(true, true, 'setVisitorName 이 예외를 밖으로 내지 않는다');
  globalThis.localStorage = real;
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
