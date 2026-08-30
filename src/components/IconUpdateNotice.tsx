import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';

/**
 * 아이콘이 바뀌었을 때 **설치본 사용자에게 한 번만** 알린다.
 *
 * ★왜 이게 필요한가
 *  아이콘을 바꿔 배포해도 이미 홈화면·바탕화면에 만들어 둔 것은 저절로 안 바뀐다.
 *    - 브라우저 탭        → 자동으로 바뀐다(파일명에 해시가 박혀 URL 이 달라진다)
 *    - 안드로이드 크롬     → 대체로 자동(아이콘 URL·비트맵 해시를 비교, 24시간 주기)
 *    - PC 크롬 설치본      → `icons` 가 보안 민감 필드라 사용자가 승인해야 반영
 *    - **아이폰 홈화면**   → 갱신 경로가 **아예 없다.** 지우고 다시 추가하는 수밖에 없다
 *  마지막 하나 때문에 앱이 직접 말해 주는 것 말고는 방법이 없다.
 *
 * ★2026-08-30 사용자 지적으로 다시 만들었다 — 첫 판은 구조가 틀렸다.
 *  이 카드는 **설치본 안**에서 뜬다. 거기엔 주소창도 공유 버튼도 없다. 그런데 첫 판은
 *  "Safari 로 다시 열어 공유 → 홈 화면에 추가" 라고만 적어 놓았다 — **주소를 꺼낼
 *  방법을 주지 않고 주소가 필요한 일을 시킨 것이다.** 그래서 실제로 따라 할 수 없었다.
 *  게다가 「북마크 제거」 같은 메뉴 이름은 iOS 버전마다 달라 단정하면 안 된다.
 *  → 이제 **주소를 직접 건네준다**(Safari 로 열기 · 주소 복사 · 눈에 보이는 주소).
 *
 * ★"아이콘을 꾹 눌러 바탕화면으로 끌어다 놓으면 바로 추가" 는 **아이폰에서 불가능하다.**
 *  홈 화면은 URL 을 받는 드롭 대상이 아니다. 웹클립을 만드는 경로는 공유 →
 *  「홈 화면에 추가」, 또는 단축어 앱의 "Make App from Web URL" 둘뿐이다(후자는 오히려
 *  단계가 늘어난다). 데스크톱은 링크를 바탕화면으로 끌 수 있지만 그건 **북마크
 *  바로가기**라 manifest 를 안 읽어 제목·아이콘이 그 순간 값으로 굳는다 — 더 나쁘다.
 *
 * ★버전은 따로 관리하지 않는다.
 *  `apple-touch-icon` 의 href 에 이미 그림 해시가 박혀 있다(`icon-180.<hash>.png`).
 *  그걸 런타임에 읽는다 — 새 상수를 두면 아이콘을 바꿀 때 같이 올리는 걸 잊는다.
 */

const KEY = 'iconSeen';

/** `icon-180.92540826.png` 에서 `92540826` 을 꺼낸다. 못 읽으면 null. */
function currentIconVersion(): string | null {
  const el = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  return el?.getAttribute('href')?.match(/\.([0-9a-f]{8})\.png/)?.[1] ?? null;
}

/** 홈화면·바탕화면에서 연 것인가. 브라우저 탭이면 파비콘이 이미 자동으로 바뀌었다. */
function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export function IconUpdateNotice() {
  const [show, setShow] = useState(false);
  const [ver, setVer] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ★`location.href` 가 아니라 origin + '/' 를 준다. 지금 주소에 `?admin=true` 가
  //  붙어 있을 수 있는데, 그대로 복사하면 관리자 권한이 딸려 나간다.
  const url = `${window.location.origin}/`;

  useEffect(() => {
    const v = currentIconVersion();
    if (!v) return;                       // 해시를 못 읽으면 아무 말도 안 한다
    setVer(v);

    let seen: string | null;
    let otherKeys = 0;
    try {
      seen = localStorage.getItem(KEY);
      otherKeys = localStorage.length - (seen === null ? 0 : 1);
    } catch {
      return;                             // 사파리 비공개 모드 — 조용히 넘어간다
    }
    if (seen === v) return;               // 이미 확인했다

    const save = () => { try { localStorage.setItem(KEY, v); } catch { /* 비공개 모드 */ } };

    // 탭에서 보는 중이면 파비콘이 이미 새것이다. 알릴 것이 없으니 기록만 하고 끝.
    if (!isInstalled()) { save(); return; }

    // ★첫 설치인지 예전 설치인지 가르는 확실한 신호가 없다. 다른 키가 하나도 없으면
    //  이 기기에서 앱을 쓴 적이 없는 것으로 보고 **조용히 기록만** 한다.
    //  트레이드오프: 예전에 설치했지만 아무 설정도 건드린 적 없는 사람은 이 안내를
    //  놓친다. 반대로 하면 방금 추가한 사람에게 "지우고 다시 추가하라"고 말하게 되는데,
    //  그건 멀쩡한 아이콘을 지우게 만드는 더 나쁜 오답이다.
    if (seen === null && otherKeys === 0) { save(); return; }

    setShow(true);
  }, []);

  if (!show) return null;

  /** 다시 안 뜨게 기록하고 닫는다. */
  const done = () => {
    try { if (ver) localStorage.setItem(KEY, ver); } catch { /* 비공개 모드 */ }
    setShow(false);
  };
  /** ★X 는 기록하지 않는다 — 실수로 닫았을 때 영영 못 보게 되면 안 된다. */
  const later = () => setShow(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // 클립보드가 막히면(비보안 컨텍스트·권한 거부) 아래 주소를 직접 길게 눌러 복사한다.
      setCopied(false);
    }
  };

  const steps = isIOS()
    ? ['아래 「Safari에서 열기」를 누른다 (안 되면 「주소 복사」 후 Safari 주소창에 붙여넣기)',
       'Safari 에서 공유 → 「홈 화면에 추가」',
       '새 아이콘이 생기면 옛 아이콘을 길게 눌러 삭제']
    : ['아래 「주소 복사」 후 크롬 주소창에 붙여넣기',
       '주소창 오른쪽 설치 아이콘으로 다시 설치',
       '옛 바로가기를 삭제'];

  return (
    <div className="fixed inset-x-3 top-20 z-[60] mx-auto max-w-sm rounded-2xl bg-white/95 backdrop-blur px-4 py-3 shadow-xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-sm font-bold text-gray-800">앱 아이콘이 새로 바뀌었습니다</h4>
          <p className="m-0 mt-1 text-xs leading-snug text-gray-600">
            {isIOS()
              ? '아이폰은 홈 화면 아이콘을 자동으로 바꾸지 못합니다. 새 아이콘으로 바꾸시려면:'
              : '바탕화면 바로가기는 만든 날 아이콘이 굳습니다. 새 아이콘으로 바꾸시려면:'}
          </p>
          <ol className="m-0 mt-1 list-decimal pl-4 text-xs leading-snug text-gray-600">
            {steps.map((s) => <li key={s} className="mt-0.5">{s}</li>)}
          </ol>
        </div>
        <button
          onClick={later}
          aria-label="닫기"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 active:bg-gray-100"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        {isIOS() && (
          // 설치본에서 target=_blank 는 Safari 로 나간다. 확실치 않은 기기가 있어
          // 「주소 복사」를 나란히 둔다 — 둘 중 하나는 반드시 통한다.
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white active:bg-blue-700"
          >
            <ExternalLink size={15} /> Safari에서 열기
          </a>
        )}
        <button
          onClick={copy}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-bold ${
            copied ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-white active:bg-gray-700'
          }`}
        >
          {copied ? <><Check size={15} /> 복사됨</> : <><Copy size={15} /> 주소 복사</>}
        </button>
      </div>

      {/* 복사가 막혀도 손으로 집을 수 있게 주소를 그대로 보여 준다. */}
      <p className="m-0 mt-2 select-all break-all text-[11px] leading-tight text-gray-500">{url}</p>

      <button
        onClick={done}
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-600 active:bg-gray-100"
      >
        다 했습니다 · 다시 보지 않기
      </button>
    </div>
  );
}
