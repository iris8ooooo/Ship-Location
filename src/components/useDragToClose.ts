/**
 * 아이폰 시트처럼 **위쪽을 아래로 끌어 닫는다** (2026-09-05 사용자 지시).
 *
 * ★조석·바람 시트와 호선 카드가 **같은 것을 쓴다.** 두 벌로 두면 반드시 갈라진다 —
 *  이 레포가 아이콘 해시·앱 이름·탱크 표기에서 반복해서 당한 함정이다.
 *
 * ★**React 상태로 두면 안 된다.** 끌 때마다 리렌더가 나면 손가락 밑의 노드가 갈리고,
 *  이 레포는 정확히 그것 때문에 핀치가 한 프레임 만에 죽는 것을 겪었다
 *  (`dangerouslySetInnerHTML` 사건). 배 끌기의 빨간 테두리를 DOM 에 직접 그린 것과 같은
 *  이유로, 끄는 동안에는 `style.transform` 을 **DOM 에 직접** 쓰고 놓을 때만 결정한다.
 * ★`translate3d`·`will-change` 를 쓰지 않는다 — GPU 레이어로 승격되면 그 위 글자가 흐려진다.
 */
import { useRef } from 'react';

/** 이만큼 내리면 닫는다. 짧으면 살짝 스치기만 해도 닫히고, 길면 「안 닫히네」가 된다. */
export const CLOSE_PX = 64;

export function useDragToClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);

  const paint = (dy: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = dy ? `translateY(${dy}px)` : '';
    el.style.opacity = dy ? String(Math.max(0.4, 1 - dy / 300)) : '';
  };
  const dyOf = (e: React.PointerEvent) => Math.max(0, e.clientY - (from.current ?? e.clientY));

  return {
    ref,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        from.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => { if (from.current !== null) paint(dyOf(e)); },
      onPointerUp: (e: React.PointerEvent) => {
        if (from.current === null) return;
        const dy = dyOf(e);
        from.current = null;
        paint(0);
        if (dy > CLOSE_PX) onClose();
      },
      onPointerCancel: () => { from.current = null; paint(0); },
    },
  };
}
