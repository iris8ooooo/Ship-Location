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

/** 첫 화면이 맞추는 범위 — 배가 실제로 놓이는 띠(도크·안벽·돌핀) */
export const YARD_HOME = { x: 0, y: 230, w: 1060, h: 550 };

export interface YardRegion {
  id: string; label: string;
  x: number; y: number; w: number; h: number;
}

/**
 * 지역 버튼이 날아갈 범위. 도크·1BERTH·플로팅·돌핀은 yard-map-geometry.json 의
 * 확정 좌표에서 왔고, 안벽 두 구간은 안벽선(y540→566)을 좌우로 가른 것이다.
 * 세이프티원 도면에는 '안벽' 이라고만 적혀 있어 1/2 구분은 사내 명칭을 따랐다.
 */
export const YARD_REGIONS: YardRegion[] = [
  { id: 'dock2',    label: '2도크',  x: 325, y: 225, w: 95,  h: 315 },
  { id: 'dock1',    label: '1도크',  x: 405, y: 255, w: 90,  h: 290 },
  { id: 'quay2',    label: '2안벽',  x: 20,  y: 470, w: 620, h: 150 },
  { id: 'quay1',    label: '1안벽',  x: 640, y: 490, w: 650, h: 150 },
  { id: 'dolphin2', label: '2돌핀',  x: 80,  y: 530, w: 165, h: 250 },
  { id: 'dolphin1', label: '1돌핀',  x: 570, y: 535, w: 165, h: 250 },
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
