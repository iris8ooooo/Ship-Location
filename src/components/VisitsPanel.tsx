/**
 * 접속 집계창 — 「하루에 몇 명이 봤나, 누가 봤나」 (2026-09-05 사용자 지시).
 *
 * ★**오너 한 사람만 읽는다.** 그 판정은 화면이 아니라 **파이어스토어 규칙**이 한다.
 *  이 앱의 관리자 모드는 localStorage 한 줄이라 누구나 될 수 있으므로, 버튼을 숨기는
 *  것은 예의일 뿐 보안이 아니다. 규칙이 막으면 여기서는 `permission-denied` 가 오고,
 *  그걸 "로그인이 필요합니다" 로 바꿔 보여준다.
 *
 * ★홈화면 앱(standalone)에서는 구글 **팝업 로그인이 막힌다.** 그래서 팝업이 실패하면
 *  리다이렉트로 물러난다 — 둘 중 하나는 통한다. 실패를 조용히 삼키지 않는다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  GoogleAuthProvider, getRedirectResult, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, type User,
} from 'firebase/auth';
import { X, RefreshCw } from 'lucide-react';
import { auth } from '../firebase';
import { fetchVisitStats, type VisitStats } from '../lib/visits';

type State =
  | { k: 'loading' }
  | { k: 'need-login'; why?: string; signedIn?: boolean }
  | { k: 'ready'; stats: VisitStats }
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
      setState({ k: 'ready', stats: await fetchVisitStats(14) });
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

      {state.k === 'ready' && <Stats stats={state.stats} />}
    </div>
  );
}

function Stats({ stats }: { stats: VisitStats }) {
  const { today, days, totalPeople, truncated } = stats;
  const max = Math.max(1, ...days.map(d => d.people));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

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
          {today.names.length > 0 && <span className="font-bold">{today.names.join(' · ')}</span>}
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
                  {d.names.join(' · ')}
                  {d.names.length > 0 && d.anon > 0 && <span className="text-gray-400"> · </span>}
                  {d.anon > 0 && <span className="text-gray-400">이름 미등록 {d.anon}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        기간 전체 {totalPeople}대 · 하루에 한 번만 셉니다(새로고침은 안 셉니다).
        이름은 각자 적은 것이라 <b>서버가 진위를 확인하지 못합니다</b>.
        {truncated && <span className="text-red-600"> ⚠ 기록이 많아 과거가 잘렸습니다 — 숫자를 믿지 마십시오.</span>}
      </p>
    </div>
  );
}
