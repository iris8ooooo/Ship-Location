import { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Share, X } from 'lucide-react';
import { appName } from '../lib/app-name';

/**
 * 홈 화면에 추가하는 길을 **그 사람의 브라우저에 맞춰** 안내한다.
 *
 * ★왜 필요한가 — 카톡으로 주소를 뿌리면 대부분 카톡 안에서 열린다.
 *  **카카오톡 인앱브라우저에는 "홈 화면에 추가" 가 아예 없다.** 안드로이드에서 홈 화면
 *  바로가기를 만들 수 있는 브라우저는 크롬·삼성인터넷뿐이고, 아이폰은 Safari 공유 시트
 *  뿐이다. 그래서 카톡 링크만 눌러서는 설치가 절대 안 뜬다 — 먼저 **진짜 브라우저로
 *  넘어가야** 한다. 이 카드가 하는 일이 그것이다.
 *
 * ★플랫폼별로 할 수 있는 것이 다르다.
 *   카톡 등 인앱브라우저 → 설치 불가. 안드로이드는 `intent://` 로 크롬을 직접 열 수 있고,
 *                          아이폰은 카톡 더보기(⋯) → 다른 브라우저로 열기 안내뿐이다.
 *   안드로이드 크롬      → `beforeinstallprompt` 를 잡아 두면 **버튼 한 번으로 설치**된다.
 *   아이폰 Safari        → 그런 API 가 **없다.** 공유 → 「홈 화면에 추가」 안내가 최선이다.
 *   데스크톱 크롬        → 주소창 오른쪽 설치 아이콘.
 *
 * ★언제 뜨나 (평소엔 아무한테도 안 뜬다)
 *   ① 주소에 `?install=1` 이 있을 때 — 공지용 링크로 쓴다.
 *   ② 인앱브라우저로 열었고 아직 설치 안 했을 때 — 링크가 파라미터 없이 전달됐을 경우.
 *  이미 설치본으로 열었으면 무조건 안 뜬다.
 */

const KEY = 'installGuideSeen';

function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** 잡아 둔 설치 프롬프트. index.html 이 아주 일찍 잡아 둔다(React 마운트보다 먼저 온다). */
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const getBip = () => (window as unknown as { __bip?: BIP | null }).__bip ?? null;

export function InstallGuide() {
  const [show, setShow] = useState(false);
  const [bip, setBip] = useState<BIP | null>(null);
  const [copied, setCopied] = useState(false);
  const [nameCopied, setNameCopied] = useState(false);
  const [installed, setInstalled] = useState(false);
  const name = appName();

  const ua = navigator.userAgent;
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua);
  const isKakao = /KAKAOTALK/i.test(ua);
  const android = /Android/i.test(ua);
  const ios = /iPad|iPhone|iPod/i.test(ua);
  // ★쿼리스트링을 떼고 준다. `?admin=true` 가 붙어 있으면 그대로 복사돼 권한이 딸려 나간다.
  const url = `${window.location.origin}/`;
  // 인앱브라우저에서 크롬을 직접 여는 안드로이드 표준 방법. scheme 을 뗀 형태로 넣는다.
  const intentUrl =
    `intent://${window.location.host}/#Intent;scheme=https;package=com.android.chrome;end`;

  useEffect(() => {
    if (isInstalled()) return;                       // 이미 설치했으면 할 말이 없다
    const forced = new URLSearchParams(window.location.search).get('install') === '1';
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch { /* 비공개 모드 */ }
    // 공지 링크(?install=1)는 매번 보여 준다. 인앱브라우저는 한 번만.
    if (forced || (inApp && !seen)) setShow(true);

    setBip(getBip());
    const onReady = () => setBip(getBip());
    const onInstalled = () => { setInstalled(true); setBip(null); };
    window.addEventListener('bip-ready', onReady);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('bip-ready', onReady);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [inApp]);

  if (!show) return null;

  const close = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* 비공개 모드 */ }
    setShow(false);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };
  const copyName = async () => {
    try { await navigator.clipboard.writeText(name); setNameCopied(true); } catch { setNameCopied(false); }
  };

  const install = async () => {
    const e = getBip();
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    (window as unknown as { __bip?: BIP | null }).__bip = null;
    setBip(null);
  };

  const copyBtn = (
    <button
      onClick={copy}
      className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-bold ${
        copied ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-white active:bg-gray-700'
      }`}
    >
      {copied ? <><Check size={15} /> 복사됨</> : <><Copy size={15} /> 주소 복사</>}
    </button>
  );

  let body;
  if (installed) {
    body = <p className="m-0 mt-1 text-xs leading-snug text-gray-600">홈 화면에 추가됐습니다. 이제 그 아이콘으로 여시면 됩니다.</p>;
  } else if (inApp) {
    // ★여기가 핵심이다. 카톡 안에서는 무슨 수를 써도 설치가 안 된다.
    body = (
      <>
        <p className="m-0 mt-1 text-xs leading-snug text-gray-600">
          {isKakao ? '카카오톡' : '이 앱'} 안에서는 홈 화면에 추가할 수 없습니다.
          {android ? ' 크롬으로 열고 나서 추가하세요.' : ' Safari 로 열고 나서 추가하세요.'}
        </p>
        <ol className="m-0 mt-1 list-decimal pl-4 text-xs leading-snug text-gray-600">
          {android
            ? <li className="mt-0.5">아래 「크롬으로 열기」 (안 되면 「주소 복사」 후 크롬 주소창에 붙여넣기)</li>
            : <li className="mt-0.5">아래 「주소 복사」 → {isKakao ? '카카오톡 더보기(⋯) → 「다른 브라우저로 열기」, 또는 ' : ''}Safari 주소창에 붙여넣기</li>}
          <li className="mt-0.5">{android ? '크롬에서 이 안내가 다시 뜨면 「홈 화면에 추가」' : 'Safari 에서 공유 버튼 → 「홈 화면에 추가」'}</li>
        </ol>
        <div className="mt-2 flex gap-2">
          {android && (
            <a
              href={intentUrl}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white active:bg-blue-700"
            >
              <ExternalLink size={15} /> 크롬으로 열기
            </a>
          )}
          {copyBtn}
        </div>
      </>
    );
  } else if (bip) {
    // 안드로이드 크롬 — 버튼 한 번으로 끝난다.
    body = (
      <>
        <p className="m-0 mt-1 text-xs leading-snug text-gray-600">
          아래 버튼을 누르면 홈 화면에 바로 추가됩니다.
        </p>
        <button
          onClick={install}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white active:bg-blue-700"
        >
          <Download size={15} /> 홈 화면에 추가
        </button>
      </>
    );
  } else if (ios) {
    // 아이폰은 설치 API 가 아예 없다. 공유 시트 안내가 최선이다.
    body = (
      <>
        <p className="m-0 mt-1 flex items-center gap-1 text-xs leading-snug text-gray-600">
          아래 공유 버튼 <Share size={13} className="inline shrink-0" /> 을 누르고
          「홈 화면에 추가」를 고르세요.
        </p>
        <p className="m-0 mt-1 text-xs leading-snug text-amber-700">
          ★이름 칸에 <b>옛 이름</b>이 뜰 수 있습니다. 아이폰이 예전에 기억해 둔 것이라
          서버를 고쳐도 안 바뀝니다 — <b>지우고 「{name}」 으로 고쳐 주세요.</b>
        </p>
        <p className="m-0 mt-1 text-xs leading-snug text-gray-500">
          공유 버튼이 안 보이면 화면을 한 번 아래로 쓸어 주소창을 띄우세요.
        </p>
      </>
    );
  } else if (android) {
    body = (
      <p className="m-0 mt-1 text-xs leading-snug text-gray-600">
        크롬 오른쪽 위 ⋮ → 「홈 화면에 추가」를 고르세요.
      </p>
    );
  } else {
    body = (
      <p className="m-0 mt-1 text-xs leading-snug text-gray-600">
        주소창 오른쪽 끝의 설치 아이콘을 누르시면 앱으로 설치됩니다.
      </p>
    );
  }

  return (
    <div className="fixed inset-x-3 top-20 z-[60] mx-auto max-w-sm rounded-2xl bg-white/95 backdrop-blur px-4 py-3 shadow-xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-sm font-bold text-gray-800">홈 화면에 추가하기</h4>
          {body}
        </div>
        <button
          onClick={close}
          aria-label="닫기"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 active:bg-gray-100"
        >
          <X size={18} />
        </button>
      </div>
      {/* 복사가 막혀도 손으로 집을 수 있게 주소를 그대로 보여 준다. */}
      <p className="m-0 mt-2 select-all break-all text-[11px] leading-tight text-gray-500">{url}</p>
      {ios && !installed && (
        // ★아이폰이 「홈 화면에 추가」 이름 칸에 **예전에 기억해 둔 이름**을 채워 넣는다.
        //  서버를 아무리 고쳐도 그 칸은 안 바뀐다 — 그래서 붙여넣을 수 있게 쥐여 준다.
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 flex-1 select-all truncate text-[11px] text-gray-600">{name}</span>
          <button
            onClick={copyName}
            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-bold ${
              nameCopied ? 'border-emerald-600 text-emerald-700' : 'border-gray-300 text-gray-600 active:bg-gray-100'
            }`}
          >
            {nameCopied ? '복사됨' : '이름 복사'}
          </button>
        </div>
      )}

    </div>
  );
}
