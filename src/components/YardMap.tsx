import { useEffect, useRef } from 'react';
import mapSvg from './yard-map.svg?raw';

/**
 * HD현대삼호 야드 배치도.
 *
 * 도형은 클로드디자인이 세이프티원 3중점검 도면을 트레이싱해 만든 SVG 그대로다
 * (yard-map.svg). 받은 파일에 두 가지를 덧붙였다.
 *   1. 라벨 그룹에 paint-order="stroke" — 원본 파일엔 빠져 있어서 3px 밝은
 *      외곽선이 글자를 통째로 덮고 있었다(글자가 안 보였다).
 *   2. data-tier / berth-* id — 줌 배율에 따라 라벨을 켜고 끄고, 지역 버튼이
 *      선석 좌표를 SVG 에서 읽어가기 위한 것.
 *
 * 좌표계는 1380 x 840. 클로드디자인이 원본 도면 콘텐츠 범위(1378x836)를
 * 1:1 로 잡은 값이고, yard-map-geometry.json 의 좌표와 같은 계다.
 */
export const YARD_W = 1380;
export const YARD_H = 840;

/** 지도 왼쪽에 덧대는 바다색 여백(지도 좌표 단위).
 *  야드 서쪽 끝은 해안이 아니라 도면이 잘린 자리라 블록이 화면 끝에 딱 붙는다.
 *  오른쪽은 바다로 열려 있는데 왼쪽만 잘려 있어 축소하면 한쪽으로 쏠려 보인다.
 *  ★viewBox 로 넓히면 안 된다 — 좌표계가 바뀌어 저장된 호선 위치가 전부 어긋난다.
 *  지도는 그대로 두고 앱이 스크롤 영역만 이만큼 왼쪽으로 넓힌다. */
export const YARD_PAD_L = 100;

/**
 * 첫 화면이 맞추는 범위 — 배가 실제로 놓이는 띠.
 *
 * 야드 전체(1380x840)를 폰 가로에 맞추면 0.25 밖에 안 돼 지도가 화면 위쪽
 * 얇은 띠로만 나오고 호선번호가 뭉갠 점이 된다. 첫 화면의 용건은 "8283 어디
 * 있냐" 이므로 배가 있는 구간에 맞춰 폰에서 0.43 근처로 뜬다.
 * 위쪽 육지(y<215)와 동쪽 끝(1BERTH·플로팅)은 화면 밖으로 나가지만,
 * 밀거나 지역 버튼으로 간다. 회전(90/270)하면 그때는 전체가 다 들어온다.
 */
export const YARD_HOME = { x: 0, y: 215, w: 860, h: 590 };

/** 회전 각도 — 세 방향만 쓴다. 0 은 도면 그대로, 90/270 은 세로로 세운 것. */
export type YardRot = 0 | 90 | 270;
export const YARD_ROTS: YardRot[] = [0, 90, 270];

/** 스크롤 콘텐츠 크기(px). 90/270 으로 세우면 가로세로가 바뀐다. */
export function contentSize(z: number, rot: YardRot) {
  const w = (YARD_W + YARD_PAD_L) * z, h = YARD_H * z;
  return rot === 0 ? { w, h } : { w: h, h: w };
}

/**
 * 컨테이너에 걸 transform. 오른쪽부터 적용된다 —
 * 왼쪽 여백만큼 밀고 → 확대하고 → 돌리고 → 음수로 나간 만큼 되민다.
 * marginLeft 로 여백을 주면 안 된다: 그건 회전 전 레이아웃이라 세웠을 때 어긋난다.
 */
export function mapTransform(z: number, rot: YardRot) {
  const W = (YARD_W + YARD_PAD_L) * z, H = YARD_H * z;
  const t = rot === 90 ? `translate(${H}px, 0px) `
          : rot === 270 ? `translate(0px, ${W}px) ` : '';
  return `${t}rotate(${rot}deg) scale(${z}) translate(${YARD_PAD_L}px, 0px)`;
}

/** 지도 좌표 → 스크롤 콘텐츠 좌표(px). 스크롤 목표를 잡을 때 쓴다. */
export function mapToContent(x: number, y: number, z: number, rot: YardRot) {
  const u = (x + YARD_PAD_L) * z, v = y * z;
  const W = (YARD_W + YARD_PAD_L) * z, H = YARD_H * z;
  if (rot === 90) return { x: H - v, y: u };
  if (rot === 270) return { x: v, y: W - u };
  return { x: u, y: v };
}

/** 스크롤 콘텐츠 좌표 → 지도 좌표. 핀치 기준점을 붙잡을 때 쓴다. */
export function contentToMap(cx: number, cy: number, z: number, rot: YardRot) {
  let u: number, v: number;
  if (rot === 90) { v = YARD_H * z - cx; u = cy; }
  else if (rot === 270) { v = cx; u = (YARD_W + YARD_PAD_L) * z - cy; }
  else { u = cx; v = cy; }
  return { x: u / z - YARD_PAD_L, y: v / z };
}

/** 화면에서 움직인 거리 → 지도에서 움직인 거리. 배를 끌 때 쓴다. */
export function screenDeltaToMap(dx: number, dy: number, z: number, rot: YardRot) {
  if (rot === 90) return { dx: dy / z, dy: -dx / z };
  if (rot === 270) return { dx: -dy / z, dy: dx / z };
  return { dx: dx / z, dy: dy / z };
}

/** 지도 전체(+왼쪽 여백)가 화면에 들어오는 배율. '전체' 버튼과 축소 하한이 쓴다. */
export function fullFit(vw: number, vh: number, rot: YardRot) {
  const { w, h } = contentSize(1, rot);
  return Math.min(0.9, Math.max(0.14, Math.min(vw / (w * 1.04), vh / (h * 1.04))));
}

/** 첫 화면 배율 — 배가 있는 띠에 맞춘다. 축소 하한(fullFit)보다 내려가지 않는다. */
export function homeFit(vw: number, vh: number, rot: YardRot) {
  const H = YARD_HOME;
  const [w, h] = rot === 0 ? [H.w, H.h] : [H.h, H.w];
  const z = Math.min(vw / (w * 1.05), vh / (h * 1.05));
  return Math.min(0.9, Math.max(fullFit(vw, vh, rot), z));
}

export interface YardRegion {
  id: string; label: string;
  x: number; y: number; w: number; h: number;
  /** 착지 배율 배수. 클수록 더 확대된다. 없으면 0.8. */
  fit?: number;
}

/**
 * 지역 버튼이 날아갈 범위. 도크·1BERTH·플로팅·돌핀은 yard-map-geometry.json 의
 * 확정 좌표에서 왔고, 안벽 두 구간은 안벽선(y540→566)을 좌우로 가른 것이다.
 * 세이프티원 도면에는 '안벽' 이라고만 적혀 있어 1/2 구분은 사내 명칭을 따랐다.
 */
export const YARD_REGIONS: YardRegion[] = [
  { id: 'dock2',    label: '2도크',  x: 325, y: 225, w: 95,  h: 335, fit: 0.68 },
  { id: 'dock1',    label: '1도크',  x: 405, y: 255, w: 90,  h: 305, fit: 0.68 },
  // 안벽은 각각 돌핀을 사이에 두고 선석이 둘이다(A 가 동쪽).
  //   2안벽 B x5~150 · 2돌핀 x157 · 2안벽 A x178~320
  //   1안벽 B x475~600 · 1돌핀 x648 · 1안벽 A x710~845
  // 예전 상자는 1안벽을 x640~1290 으로 잡아 1BERTH 동쪽 빈 바다를 절반이나
  // 담고 정작 B선석을 놓쳤다. 배가 실제로 붙는 구간만 담는다.
  { id: 'quay2',    label: '2안벽',  x: 0,   y: 515, w: 340, h: 130, fit: 1 },
  { id: 'quay1',    label: '1안벽',  x: 460, y: 520, w: 400, h: 130, fit: 1 },
  { id: 'dolphin2', label: '2돌핀',  x: 80,  y: 530, w: 165, h: 250, fit: 0.68 },
  { id: 'dolphin1', label: '1돌핀',  x: 570, y: 535, w: 165, h: 250, fit: 0.68 },
  { id: 'floating', label: '플로팅', x: 890, y: 550, w: 150, h: 180 },
  { id: 'berth1',   label: '1BERTH', x: 890, y: 295, w: 150, h: 260 },
  { id: 'all',      label: '전체',   x: 0,   y: 0,   w: 1380, h: 840 },
];

/**
 * 줌 배율별로 보일 라벨 단계. 축소했을 때 글자를 줄이면 못 읽으니 줄이지 않고 숨긴다.
 * 폰 첫 화면이 약 0.55 라 그때 구역코드까지 보이고 주변 지명(R90x·지명)만 빠진다.
 */
function tiersFor(zoom: number): Set<string> {
  const t = new Set(['major']);
  if (zoom >= 0.45) t.add('zone');
  if (zoom >= 0.8) t.add('minor');
  return t;
}

export default function YardMap({ zoom = 1 }: { zoom?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = tiersFor(zoom);
    host.current?.querySelectorAll<SVGElement>('[data-tier]').forEach(g => {
      g.style.display = on.has(g.dataset.tier ?? '') ? '' : 'none';
    });
  }, [zoom]);

  return (
    <div
      ref={host}
      className="absolute inset-0 w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
      aria-label="HD현대삼호 야드 배치도"
      dangerouslySetInnerHTML={{ __html: mapSvg }}
    />
  );
}
