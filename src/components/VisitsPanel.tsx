/**
 * 접속 집계창 — 「하루에 몇 명이 봤나, 누가 봤나」 (2026-09-05 사용자 지시).
 *
 * ★**오너 한 사람만 읽는다.** 그 판정은 화면이 아니라 **파이어스토어 규칙**이 한다.
 *  이 앱의 관리자 모드는 localStorage 한 줄이라 누구나 될 수 있으므로, 버튼을 숨기는
 *  것은 예의일 뿐 보안이 아니다. 규칙이 막으면 여기서는 `permission-denied` 가 오고,
 *  그걸 "로그인이 필요합니다" 로 바꿔 보여준다.
 *
 * ★**직원 명단은 문지기가 아니라 눈이다** (2026-09-05 사용자 결정). 명단 밖 이름을
 *  「명단 밖」으로 표시할 뿐, 아무도 막지 않는다 — 막으면 신입이 앱을 못 쓰고 오너는
 *  그 사실을 모른다. 신입이면 그 자리에서 탭 한 번으로 명단에 넣는다.
 *  ★명단 읽기가 막혀도(규칙 배포 전 등) **집계는 그대로 뜬다.** 곁다리 때문에 본체가
 *  안 뜨는 것이 더 나쁘다 — 이 레포의 fail-open 원칙과 같다.
 *
 * ★홈화면 앱(standalone)에서는 구글 **팝업 로그인이 막힌다.** 그래서 팝업이 실패하면
 *  리다이렉트로 물러난다 — 둘 중 하나는 통한다. 실패를 조용히 삼키지 않는다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  GoogleAuthProvider, getRedirectResult, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, type User,
} from 'firebase/auth';
import { X, RefreshCw, Plus, UserRoundPlus } from 'lucide-react';
import { auth } from '../firebase';
import { fetchVisitStats, type VisitStats } from '../lib/visits';
import { addStaff, addStaffBulk, fetchStaff, parseNames, removeStaff } from '../lib/staff';

type State =
  | { k: 'loading' }
  | { k: 'need-login'; why?: string; signedIn?: boolean }
  | { k: 'ready'; stats: VisitStats; staff: string[] | null }
  | { k: 'error'; msg: string };

export default function VisitsPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>({ k: 'loading' });
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  // 리다이렉트로 돌아온 경우를 먼저 받는다. 안 받으면 로그인하고 왔는데도 그대로 로그아웃으로 보인다.
  useEffect(() => { getRedirectResult(auth).catch(() => { /* 리다이렉트로 온 게 아니면 조용히 넘어간다 */ }); }, []);

  // ★`auth.currentUser` 를 바로 읽으면 안 된다. 콜드스타트 직후에는 **항상 null** 이고
  //  (저장된 세션 복원이 비동기다) 그러면 로그인한 사람도 로그아웃으로 보인다.
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const load = useCallback(async () => {
    setState({ k: 'loading' });
    try {
      const stats = await fetchVisitStats(14);
      // ★명단은 **곁다리다.** 못 읽어도(규칙이 아직 배포 안 됐다든지) 집계는 띄운다.
      //  곁다리 때문에 본체가 안 뜨는 것이 더 나쁘다.
      let staff: string[] | null = null;
      try { staff = await fetchStaff(); } catch { staff = null; }
      setState({ k: 'ready', stats, staff });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? '';
      // ★「로그인 안 함」과 「로그인은 했는데 주인이 아님」을 **갈라야 한다.**
      //  안 가르면 다른 관리자가 자기 계정으로 로그인 → 또 「로그인」 버튼 → 무한 반복이 되고,
      //  본인은 왜 안 보이는지 영영 모른다. 막는 것은 규칙이 하고, **설명은 화면이 한다.**
      if (code === 'permission-denied') setState({ k: 'need-login', signedIn: !!auth.currentUser });
      else setState({ k: 'error', msg: `${code || e}` });
    }
  }, []);

  useEffect(() => { load(); }, [load, user]);

  const signIn = async () => {
    setBusy(true);
    const provider = new GoogleAuthProvider();
    // 이미 다른 계정으로 들어와 있을 수 있다. 계정 고르는 화면을 강제한다.
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e: unknown) {
      // 홈화면 앱·인앱브라우저에서는 팝업이 막힌다. 리다이렉트로 물러난다.
      try {
        await signInWithRedirect(auth, provider);
        return;                       // 페이지가 떠난다
      } catch (e2: unknown) {
        setState({ k: 'need-login', why: `로그인 실패: ${(e2 as { code?: string })?.code ?? (e as { code?: string })?.code ?? e2}` });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 text-[13px]">
      <div className="flex items-center gap-2">
        <h4 className="shrink-0 font-bold text-gray-800 text-sm">접속 집계</h4>
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
          {user?.email ? user.email : '오너만 볼 수 있습니다'}
        </span>
        {state.k === 'ready' && (
          <button onClick={load} aria-label="새로고침" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
            <RefreshCw size={15} />
          </button>
        )}
        <button onClick={onClose} aria-label="닫기" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <X size={16} />
        </button>
      </div>

      {state.k === 'loading' && <div className="text-gray-400">불러오는 중…</div>}

      {state.k === 'need-login' && (
        <div className="flex flex-col gap-2">
          {state.signedIn ? (
            <p className="text-gray-600 leading-relaxed">
              <b className="break-all">{user?.email ?? '이 계정'}</b> 으로는 접속기록을 볼 수 없습니다.
              이 화면은 <b>주인 계정 한 사람</b>만 열 수 있고, 그 판정은 화면이 아니라
              <b> 서버</b>가 합니다 — 관리자 모드로 들어와도 마찬가지입니다.
            </p>
          ) : (
            <p className="text-gray-600 leading-relaxed">
              접속기록은 <b>주인 계정으로 로그인해야</b> 볼 수 있습니다.
              서버가 막고 있어서 이 화면을 열어도 남은 못 봅니다.
            </p>
          )}
          {state.why && <p className="text-[11px] text-red-600 break-all">{state.why}</p>}
          <button
            onClick={signIn}
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors"
          >
            {busy ? '여는 중…' : state.signedIn ? '다른 계정으로 로그인' : '구글 계정으로 로그인'}
          </button>
        </div>
      )}

      {state.k === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="text-red-600 break-all">불러오지 못했습니다 — {state.msg}</p>
          <button onClick={load} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2 rounded-lg">
            다시 시도
          </button>
        </div>
      )}

      {state.k === 'ready' && (
        <Stats
          stats={state.stats}
          staff={state.staff}
          onStaffChange={async () => {
            try {
              const next = await fetchStaff();       // ★먼저 받고 나서 넣는다 — updater 안에서는 await 를 못 쓴다
              setState(p => (p.k === 'ready' ? { ...p, staff: next } : p));
            } catch { /* 못 읽으면 그대로 둔다 */ }
          }}
        />
      )}
    </div>
  );
}

function Stats({ stats, staff, onStaffChange }: {
  stats: VisitStats;
  staff: string[] | null;
  onStaffChange: () => Promise<void>;
}) {
  const { today, days, totalPeople, truncated } = stats;
  const max = Math.max(1, ...days.map(d => d.people));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const known = staff ? new Set(staff) : null;

  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  /** 명단 밖 이름 하나를 명단에 넣는다. 신입이 이 길로 들어온다. */
  const add = async (name: string) => { await addStaff(name); await onStaffChange(); };

  /** 붙여넣은 덩어리를 한 번에 넣는다. 처음 명단을 채울 때 쓴다. */
  const bulk = async () => {
    const names = parseNames(paste);
    if (names.length === 0) { setMsg('이름을 못 찾았습니다. 줄바꿈이나 쉼표로 구분해 주십시오.'); return; }
    setSaving(true);
    try {
      const { added, failed } = await addStaffBulk(names);
      // ★실패를 삼키지 않는다. "넣었는데 왜 안 뜨지" 가 이 레포가 반복해서 당한 모양이다.
      setMsg(failed.length ? `${added}명 넣었습니다. 실패 ${failed.length}명: ${failed.join(', ')}`
                           : `${added}명 넣었습니다.`);
      setPaste('');
      await onStaffChange();
    } catch (e: unknown) {
      setMsg(`넣지 못했습니다 — ${(e as { code?: string })?.code ?? e}`);
    } finally { setSaving(false); }
  };

  /** 이름 한 덩어리. 명단 밖이면 배지와 「+」를 단다. */
  const Name = ({ n }: { n: string }) => {
    if (!known || known.has(n)) return <span className="font-medium">{n}</span>;
    return (
      <span className="inline-flex items-center gap-0.5 align-middle">
        <span className="font-medium text-amber-700">{n}</span>
        <button
          onClick={() => add(n)}
          title={`${n} 을(를) 명단에 추가`}
          className="inline-flex items-center rounded bg-amber-100 px-1 py-px text-[10px] font-bold text-amber-800 hover:bg-amber-200"
        >
          <Plus size={10} /> 명단
        </button>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 오늘 — 이 화면의 주인공이라 크게 */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-bold text-blue-700">오늘</span>
          <span className="text-2xl font-black tabular-nums text-blue-800">{today.people}</span>
          <span className="text-[11px] text-blue-700">명</span>
        </div>
        <div className="mt-1 text-[12px] text-gray-700 leading-relaxed">
          {today.names.map((n, i) => (
            <span key={n}>{i > 0 && <span className="text-gray-400"> · </span>}<Name n={n} /></span>
          ))}
          {today.names.length > 0 && today.anon > 0 && <span className="text-gray-400"> · </span>}
          {today.anon > 0 && <span className="text-gray-500">이름 미등록 {today.anon}명</span>}
          {today.people === 0 && <span className="text-gray-400">아직 아무도 안 열었습니다</span>}
        </div>
      </div>

      {/* 최근 14일 */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 mb-1">최근 14일 · 하루 접속자 수</div>
        <div className="flex flex-col gap-0.5 max-h-[30vh] overflow-y-auto overscroll-contain">
          {days.length === 0 && <div className="text-gray-400">기록이 없습니다</div>}
          {days.map(d => {
            const [, m, dd] = d.day.split('-');
            const wd = DOW[new Date(`${d.day}T00:00:00Z`).getUTCDay()];
            return (
              <div key={d.day} className="flex items-center gap-1.5">
                <span className="shrink-0 w-14 text-[11px] tabular-nums text-gray-500">
                  {Number(m)}/{Number(dd)}({wd})
                </span>
                <span className="shrink-0 w-6 text-right text-[12px] font-bold tabular-nums text-gray-800">
                  {d.people}
                </span>
                <span className="min-w-0 flex-1" aria-hidden>
                  <span
                    className="block h-2.5 rounded-sm bg-blue-500"
                    style={{ width: `${Math.max(4, (d.people / max) * 100)}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 이름별 — "누가" 에 답하는 칸 */}
      <div>
        <div className="text-[11px] font-bold text-gray-500 mb-1">날짜별 접속자</div>
        <div className="flex flex-col gap-1 max-h-[24vh] overflow-y-auto overscroll-contain">
          {days.filter(d => d.names.length > 0 || d.anon > 0).map(d => {
            const [, m, dd] = d.day.split('-');
            return (
              <div key={d.day} className="flex gap-1.5 leading-relaxed">
                <span className="shrink-0 w-11 text-[11px] tabular-nums text-gray-500">
                  {Number(m)}/{Number(dd)}
                </span>
                <span className="min-w-0 flex-1 text-[12px] text-gray-700">
                  {d.names.map((n, i) => (
                    <span key={n}>{i > 0 && <span className="text-gray-400"> · </span>}<Name n={n} /></span>
                  ))}
                  {d.names.length > 0 && d.anon > 0 && <span className="text-gray-400"> · </span>}
                  {d.anon > 0 && <span className="text-gray-400">이름 미등록 {d.anon}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 직원 명단 — ★문지기가 아니라 눈이다. 아무도 막지 않는다. */}
      {staff !== null && (
        <details className="rounded-lg border border-gray-200 bg-gray-50/70">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold text-gray-600">
            직원 명단 {staff.length}명
            <span className="ml-1 font-normal text-gray-400">— 명단 밖 이름을 알아보려고 둡니다. 아무도 막지 않습니다.</span>
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3">
            <div className="flex flex-wrap gap-1">
              {staff.map(n => (
                <span key={n} className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white py-0.5 pl-2 pr-1 text-[12px] text-gray-700">
                  {n}
                  <button
                    onClick={async () => { await removeStaff(n); await onStaffChange(); }}
                    aria-label={`${n} 명단에서 빼기`}
                    className="text-gray-300 hover:text-red-500"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {staff.length === 0 && (
                <span className="text-[12px] text-gray-400">아직 비어 있습니다 — 아래에 명단을 붙여넣으십시오.</span>
              )}
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              rows={3}
              placeholder="이름을 줄바꿈이나 쉼표로 구분해 붙여넣으십시오"
              className="w-full resize-y rounded-lg border-2 border-gray-200 px-2 py-1.5 text-[13px] text-gray-800 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={bulk}
              disabled={saving || !paste.trim()}
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-gray-800 py-2 text-[13px] font-bold text-white disabled:opacity-40 hover:bg-gray-900"
            >
              <UserRoundPlus size={14} /> {saving ? '넣는 중…' : '명단에 넣기'}
            </button>
            {msg && <p className="text-[11px] text-gray-600 break-all">{msg}</p>}
            <p className="text-[11px] text-gray-400 leading-relaxed">
              이름은 <b>파이어스토어에만</b> 저장되고 사장님만 읽습니다 — 앱에도 코드에도 들어가지 않습니다.
              연락처·사번·생년월일은 넣지 마십시오. 필요한 것은 이름뿐입니다.
            </p>
          </div>
        </details>
      )}

      <p className="text-[11px] text-gray-400 leading-relaxed">
        기간 전체 {totalPeople}대 · 하루에 한 번만 셉니다(새로고침은 안 셉니다).
        이름은 각자 적은 것이라 <b>서버가 진위를 확인하지 못합니다</b>.
        {truncated && <span className="text-red-600"> ⚠ 기록이 많아 과거가 잘렸습니다 — 숫자를 믿지 마십시오.</span>}
      </p>
    </div>
  );
}
