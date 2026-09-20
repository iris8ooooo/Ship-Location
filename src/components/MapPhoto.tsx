import { useEffect, useRef, type RefObject } from 'react';
import { YARD_W, YARD_H, screenDeltaToMap, type YardRot } from './YardMap';

/**
 * 관리자가 올린 **사진 지도**를 우리 지도 위에 반투명으로 깔아 준다.
 *
 * ★왜 사진인가 — 붙여넣던 **글자 리스트는 위치를 말해 주지 않는다**
 *  (2026-09-20 사용자 지적: 「3중점검 리스트보기는 위치 보기가 아니야」).
 *  리스트가 주는 것은 `2안벽` 같은 **구간 이름**뿐이라, 그걸로 옮기면 배가 그 선석의
 *  **미리 정해 둔 슬롯**에 들어갈 뿐 실제로 붙어 있는 자리로 가지 않는다.
 *  사진은 자리를 그대로 보여준다 — 그래서 **깔아 놓고 그 위에 배를 맞추면** 된다.
 *
 * ★사진을 **해석하지는 않는다.** 사진에서 호선번호를 읽어 자동으로 놓으려면
 *  ① 글자 인식(OCR)과 ② 사진↔지도 정합 둘 다 필요한데, 둘 다 틀려도 에러가 아니라
 *  **그럴듯한 오답**으로 나온다 — 이 레포가 반복해서 당한 그 모양이다.
 *  좌표를 정확히 가져오는 길은 이미 있다(수집: 세이프티원 실좌표 → 아핀 변환).
 *  사진은 **눈으로 맞추는 자**이고, 맞추는 손은 사람이다.
 *
 * ★사진은 **이 기기 밖으로 나가지 않는다.** 파이어스토어에도 서버에도 쓰지 않고
 *  `URL.createObjectURL` 로만 산다. ships 컬렉션은 **공개 읽기**이므로 사내 화면
 *  캡처가 거기 들어가면 그 순간 인터넷에 공개된다. 새로고침하면 사라지는 것이
 *  버그가 아니라 **설계**다.
 *
 * ★GPU 힌트를 쓰지 않는다 — `will-change`·`translate3d`·`backface-visibility` 금지.
 *  이 층 위에 호선번호가 놓이므로 승격되면 그 글자가 흐려진다(CLAUDE.md 최상위 규칙).
 */
export type Photo = { url: string; w: number; h: number };

/** 사진이 놓인 자리. 지도 좌표계(1380x840) 위의 **중심**·배율·각도. */
type Place = { x: number; y: number; s: number; deg: number };

/** 사진이 야드 상자 안에 통째로 들어오는 크기. 처음 놓는 자리는 여기서 나온다. */
function baseSize(p: Photo) {
  const k = Math.min(YARD_W / p.w, YARD_H / p.h);
  return { w: p.w * k, h: p.h * k };
}

/** 두 손가락(또는 한 손가락)의 중심·간격·각도. 맞추기 계산의 기준값. */
function stat(pts: Map<number, { x: number; y: number }>) {
  const a = [...pts.values()];
  if (!a.length) return null;
  const cx = a.reduce((s, p) => s + p.x, 0) / a.length;
  const cy = a.reduce((s, p) => s + p.y, 0) / a.length;
  if (a.length < 2) return { cx, cy, dist: 0, ang: 0 };
  const dx = a[1].x - a[0].x, dy = a[1].y - a[0].y;
  return { cx, cy, dist: Math.hypot(dx, dy), ang: (Math.atan2(dy, dx) * 180) / Math.PI };
}

export default function MapPhoto({ photo, imgRef, viewport, zoom, rot, align }: {
  photo: Photo;
  /** 투명도 슬라이더가 이 노드에 **직접** 쓴다 — 슬라이더 한 칸마다 앱을 다시 그리지 않으려고. */
  imgRef: RefObject<HTMLImageElement | null>;
  viewport: HTMLDivElement | null;
  zoom: number;
  rot: YardRot;
  /** 켜면 끌기·핀치가 **지도가 아니라 사진**을 움직인다. */
  align: boolean;
}) {
  const base = baseSize(photo);
  /** 지금 놓인 자리. ★React 상태로 두지 않는다 — 맞추는 동안 매 프레임 리렌더가 나면
   *  이 레포는 손가락 밑 노드가 갈려 제스처가 한 프레임 만에 죽은 적이 있다. */
  const pl = useRef<Place>({ x: YARD_W / 2, y: YARD_H / 2, s: 1, deg: 0 });

  useEffect(() => {
    // 사진이 바뀌면 자리도 처음으로 되돌린다.
    pl.current = { x: YARD_W / 2, y: YARD_H / 2, s: 1, deg: 0 };
    const img = imgRef.current;
    if (img) { img.style.left = `${pl.current.x}px`; img.style.top = `${pl.current.y}px`; img.style.transform = 'translate(-50%, -50%)'; }
  }, [photo.url, imgRef]);

  useEffect(() => {
    const node = viewport, img = imgRef.current;
    if (!align || !node || !img) return;

    const pts = new Map<number, { x: number; y: number }>();
    let from: { place: Place; cx: number; cy: number; dist: number; ang: number } | null = null;

    const write = () => {
      const p = pl.current;
      img.style.left = `${p.x}px`;
      img.style.top = `${p.y}px`;
      img.style.transform = `translate(-50%, -50%) rotate(${p.deg}deg) scale(${p.s})`;
    };
    /** 손가락이 늘거나 줄 때마다 기준을 다시 잡는다 — 안 잡으면 그 순간 사진이 튄다. */
    const rebase = () => {
      const s = stat(pts);
      from = s ? { place: { ...pl.current }, ...s } : null;
    };

    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // 손가락이 뷰포트 밖으로 나가도 계속 받는다. 합성 이벤트에는 붙일 수 없으므로
      // (검사용 PointerEvent 는 실제 포인터가 아니다) 실패해도 그냥 넘어간다.
      try { node.setPointerCapture(e.pointerId); } catch { /* 실제 포인터가 아니다 */ }
      rebase();
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = stat(pts);
      if (!s || !from) return;
      e.preventDefault();
      // 화면에서 민 거리 → 지도에서 민 거리. 지도를 세워 둬도(90/270) 그대로 맞는다.
      const d = screenDeltaToMap(s.cx - from.cx, s.cy - from.cy, zoom, rot);
      const next: Place = { ...from.place, x: from.place.x + d.dx, y: from.place.y + d.dy };
      if (from.dist > 8 && s.dist > 8) {
        next.s = Math.min(8, Math.max(0.05, from.place.s * (s.dist / from.dist)));
        // 각도는 프레임이 돌아가도 그대로다(회전은 상대각을 보존한다).
        let dd = ((s.ang - from.ang + 540) % 360) - 180;
        next.deg = from.place.deg + dd;
        // 캡처 화면은 반듯하다. 살짝 돌아간 건 손 떨림이므로 0 에 붙인다.
        if (Math.abs(((next.deg + 180) % 360) - 180) < 3) next.deg = 0;
      }
      pl.current = next;
      write();
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); rebase(); };
    /** 데스크톱 휠은 크기 조절. 지도 줌은 맞추는 동안 쉰다. */
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      pl.current.s = Math.min(8, Math.max(0.05, pl.current.s * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
      write();
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move, { passive: false });
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel);
    };
  }, [align, viewport, zoom, rot, imgRef]);

  return (
    <img
      ref={imgRef}
      src={photo.url}
      alt=""
      draggable={false}
      /* ★언제나 `pointer-events-none`. 사진이 배를 **덮되 막지는 않게** 한다 —
         「덮는다」와 「막는다」는 다른 문제라는 것을 이름 카드에서 이미 배웠다. */
      className="absolute z-0 pointer-events-none select-none max-w-none"
      style={{ left: YARD_W / 2, top: YARD_H / 2, width: base.w, height: base.h,
               transform: 'translate(-50%, -50%)', opacity: 0.55 }}
    />
  );
}
