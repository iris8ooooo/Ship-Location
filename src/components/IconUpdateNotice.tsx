import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

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

  const done = () => {
    try { if (ver) localStorage.setItem(KEY, ver); } catch { /* 비공개 모드 */ }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-3 top-20 z-[60] mx-auto max-w-sm rounded-2xl bg-white/95 backdrop-blur px-4 py-3 shadow-xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-sm font-bold text-gray-800">앱 아이콘이 새로 바뀌었습니다</h4>
          <p className="m-0 mt-1 text-xs leading-snug text-gray-600">
            {isIOS()
              ? '아이폰은 홈 화면 아이콘을 자동으로 갱신하지 못합니다. 이 아이콘을 길게 눌러 「북마크 제거」한 뒤, Safari 로 다시 열어 공유 → 「홈 화면에 추가」 하시면 새 아이콘이 나옵니다.'
              : '바탕화면 바로가기는 만든 날 아이콘이 굳습니다. 옛 바로가기를 지우고 다시 설치하시면 새 아이콘이 나옵니다.'}
          </p>
        </div>
        <button
          onClick={done}
          aria-label="닫기"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 active:bg-gray-100"
        >
          <X size={18} />
        </button>
      </div>
      <button
        onClick={done}
        className="mt-2 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm font-bold text-white active:bg-gray-700"
      >
        알겠습니다
      </button>
    </div>
  );
}
