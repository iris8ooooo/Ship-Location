import React, { useCallback, useEffect, useRef, useState, PointerEvent as ReactPointerEvent } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, query, orderBy, limit } from 'firebase/firestore';
import { parseListText, planMoves, BERTH_LABEL } from './lib/safetyone-match.mjs';
import { fetchVesselPlan, dateLabel, ddayLabel, type VesselPlan } from './lib/vessel-plan';
import { fetchRoster, specIsDF, OPEN_ROSTER, type Roster } from './lib/vessel-roster';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from './firebase';
import YardMap, { YARD_REGIONS, YARD_W, YARD_H, YARD_ROTS,
  contentSize, mapTransform, mapToContent, contentToMap, screenDeltaToMap,
  fullFit, type YardRegion, type YardRot } from './components/YardMap';
import { IconUpdateNotice } from './components/IconUpdateNotice';
import { InstallGuide } from './components/InstallGuide';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
import { RotateCcw, RotateCw, X, MessageSquare, Plus, Waves, Info, ChevronUp, ChevronDown, Droplets, ArrowUpCircle, ArrowDownCircle, Lock, Unlock, ArrowLeftRight } from 'lucide-react';

interface ShipData {
  x: number;
  y: number;
  r: number;
  color: string;
  memo?: string;
}

interface ZoneData {
  x: number;
  y: number;
  r: number;
  isLocked?: boolean;
}

interface TideInfo {
  dateStr: string;
  lunarStr: string;
  tides: { type: 'High' | 'Low'; time: string; height: number }[];
  status: string;
}

/** 터치로 배를 끌기 전에 눌러야 하는 시간(ms).
 *  두 손가락으로 줌아웃할 때 한 손가락이 배에 닿으면 배가 딸려가던 문제 때문에 넣었다.
 *  1초는 배를 여러 척 옮길 때 답답하고, 300ms 대는 핀치가 시작되는 구간과 겹친다.
 *  600ms 면 실수로 눌릴 일은 없으면서 "꾹" 한 번으로 잡힌다. */
/**
 * 호선번호 라벨을 어떻게 놓을지 정한다 (선체 기준 회전각 + 한 자씩 쌓을지).
 *
 * 선체는 26px 폭에 130px 길이다. 화면에서 선체가 가로로 누우면 글자도 눕혀
 * 한 줄로 쓰면 되지만, 선체가 세로로 서면 한 줄짜리 글자가 26px 폭을 뚫고 나간다.
 *
 * ★세로일 때는 글자를 눕히지 않는다 (2026-08-29 사용자 지시).
 *   한 자씩 **똑바로 세워 위에서 아래로 쌓는다** — 8300 이면 8 / 3 / 0 / 0.
 *   앞서 rotate(90deg) 로 글자를 눕혀 세로로 읽게 한 것은 잘못 이해한 것이었다.
 *   쌓을 때 라벨의 화면각은 0 이어야 글자가 똑바로 선다 → 선체 각도를 그대로 되돌린다.
 *
 * 배·구역 회전은 전부 90도 단위라(handleRotate) 화면각은 0/90/180/270 중 하나다.
 */
function hullLabel(shipR: number, rot: number): { rot: number; stack: boolean } {
  const a = ((Math.round((shipR + rot) / 90) * 90) % 360 + 360) % 360;   // 선체의 화면각
  if (a === 90) return { rot: -90, stack: false };    // 선체가 가로 — 글자도 눕힌다
  if (a === 270) return { rot: 90, stack: false };
  return { rot: -a, stack: true };                    // 선체가 세로 — 한 자씩 쌓는다
}

/**
 * 화면 아래에 쌓이는 것(지역 버튼 줄·조석 패널)의 **실제 높이**를 CSS 변수로 내려보낸다.
 *
 * 높이를 `6.5rem` 처럼 손으로 박아두면 브레이크포인트마다 어긋난다. 실제로 어긋났다:
 * 지역 버튼 줄은 작은 화면 70px / sm 이상 78px 인데 조석 패널이 104px 에 고정돼 있어
 * 폰 전 기종에서 14px, 아이패드 미니에서 22px 을 파고들었다(2026-08-29 실측).
 * 그래서 **한 곳에서 재서 나눠 준다** — 임계값을 여러 군데 흩뿌리지 않는다.
 *
 * md 이상에서 패널이 화면 위쪽으로 붙을 때는 0 을 준다 — 아래에 쌓이지 않으므로
 * 아무것도 밀어 올리면 안 된다. 이때 `getComputedStyle().bottom` 은 쓸 수 없다:
 * 위치가 잡힌 요소의 top/bottom 은 `auto` 라도 **계산된 px 값**으로 나온다
 * (실측: bottom:auto 인 데스크톱에서 "744px"). 그래서 위아래 중 어느 쪽에
 * 더 붙어 있는지로 가른다 — 브레이크포인트를 JS 에 또 적지 않아도 된다.
 */
function usePublishedHeight(name: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => {
      const r = el.getBoundingClientRect();
      const stacked = window.innerHeight - r.bottom < r.top;   // 아래에 더 붙어 있나
      document.documentElement.style.setProperty(name, `${stacked ? el.offsetHeight : 0}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    window.addEventListener('resize', publish);
    return () => { ro.disconnect(); window.removeEventListener('resize', publish); };
  }, [name]);
  return ref;
}

const DRAG_HOLD_MS = 600;
/** 꾹 누르는 동안 이만큼(px) 움직이면 끌기가 아니라 지도 이동·핀치로 본다. */
const DRAG_HOLD_SLOP = 8;

/**
 * 수집 주기(시간). `.github/workflows/sync-safetyone.yml` 의 크론과 같은 값이어야 한다.
 * 여기를 고치면 아래 STALE 도 같이 따라간다 — 임계값을 두 군데 적지 않는다.
 */
const SYNC_PERIOD_H = 6;
/**
 * 심장박동이 이만큼(분) 없으면 빨갛게. 지켜야 하는 건 "몇 시간째 그대로" 와
 * "수집이 죽음" 을 가르는 것이므로, 주기의 1.5배 = 한 번은 확실히 걸렀을 때만 빨갛다.
 * 주기와 똑같이 잡으면 깃허브 크론이 몇 분만 밀려도 멀쩡한 수집이 빨갛게 뜬다.
 */
const SYNC_STALE_MIN = SYNC_PERIOD_H * 90;

export default function App() {
  const [ships, setShips] = useState<Record<string, ShipData>>({});
  const [zones, setZones] = useState<Record<string, ZoneData>>({});
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [newShipName, setNewShipName] = useState('');
  /** 지도 붙여넣기(세이프티원 3중점검 리스트) 반영. 계획을 먼저 보여주고 확인 후에만 쓴다. */
  const [syncText, setSyncText] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncPlan, setSyncPlan] = useState<import('./lib/safetyone-match.mjs').SyncPlan | null>(null);
  /** 마지막 수집 심장박동(meta/safetyone). 룰 배포 전이면 null 로 남아 숨는다. */
  const [lastSync, setLastSync] = useState<number | null>(null);
  /** 뷰어 카드에 보여줄 "그 호선의 오늘"(공정관리 Supabase). 'loading'/'error' 구분. */
  const [vesselPlan, setVesselPlan] = useState<VesselPlan | 'loading' | 'error' | null>(null);
  /** 공정관리에서 읽은 호선 명부 — 작업 호선(진하게) · DF 호선(초록).
   *  조회 실패 시 OPEN_ROSTER 라 아무것도 흐려지지 않는다(fail open). */
  const [roster, setRoster] = useState<Roster>(OPEN_ROSTER);
  const [zoom, setZoom] = useState(1);
  const [appMode, setAppMode] = useState<'admin' | 'viewer'>('viewer');
  const [isAdminUrl, setIsAdminUrl] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [memoModalShipId, setMemoModalShipId] = useState<string | null>(null);
  const [memoInput, setMemoInput] = useState('');
  const [deleteModalShipId, setDeleteModalShipId] = useState<string | null>(null);
  const [deleteModalZoneId, setDeleteModalZoneId] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // 세로 공간이 좁은 화면(폰 가로 등)에서는 패널이 지도를 통째로 덮으므로
  // 처음부터 접어둔다. 넉넉한 화면에서는 펼친 채로 시작한다.
  // 패널은 한 번에 하나만 연다. 기본은 닫힘 — 지도가 주인공이다.
  const [openPanel, setOpenPanel] = useState<null | 'info' | 'add'>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<'tide' | 'wind'>('tide');
  const [windData, setWindData] = useState<{speed: number, direction: string, degrees: number, time: string, hourly: { speeds: number[] }} | null>(null);
  const [tideData, setTideData] = useState<TideInfo | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  /** 아래에 쌓이는 것들의 실측 높이. 서로를 밀어 올리는 기준이 된다. */
  const dockRef = usePublishedHeight('--dock-h');
  const sheetRef = usePublishedHeight('--sheet-h');
  /** 지도 회전. 0 은 도면 그대로(가로로 김), 90/270 은 세워서 세로 화면을 채운다.
   *  좌표계는 건드리지 않는다 — 컨테이너 transform 만 돌리므로 저장된 호선 좌표는 그대로다. */
  const [rot, setRot] = useState<YardRot>(() => {
    // ★raw 를 먼저 본다. Number(null) 은 0 이라 저장값이 없어도 "0도가 저장돼 있다" 로
    //  읽히고, 아래 기본값에 영영 닿지 못한다.
    const raw = localStorage.getItem('yardRot');
    const saved = Number(raw);
    if (raw !== null && (YARD_ROTS as number[]).includes(saved)) return saved as YardRot;
    // ★처음 열 때는 **더 크게 보이는 방향**으로 시작한다 (2026-08-29 사용자 지시).
    //  야드는 가로로 길어(1480x840) 세로 폰에 눕힌 채로 전체를 맞추면 배율이
    //  0.28 밖에 안 되고 지도가 화면의 30% 만 채운다 — 나머지는 빈 바다다
    //  (실측 iPhone14 33% · 갤S20 32% · 폴드커버 27%). 90도 세우면 0.49 로 꽉 찬다.
    //  ★"폭 640 미만이면 세운다" 같은 임계값을 두지 않는다. 그건 아이패드 미니
    //   (744 세로)를 놓친다 — 거기도 눕히면 39% 뿐이다. 두 방향을 실제로 재서
    //   배율이 큰 쪽을 고르면 기기 목록을 관리할 필요가 없다.
    //  회전 버튼은 그대로 있으니 언제든 되돌릴 수 있고, 고른 방향은 저장돼 다음부터 그대로다.
    if (typeof window === 'undefined') return 0;
    const w = window.innerWidth, h = window.innerHeight;
    return fullFit(w, h, 90) > fullFit(w, h, 0) ? 90 : 0;
  });
  const rotRef = useRef<YardRot>(rot);
  // 첫 화면을 이미 맞춘 노드. 불리언 한 개로 두면 안 된다 — 로그인 직후 React 가
  // 이 div 를 한 번 교체하는데, 그때 새 노드는 스크롤이 0 인 채로 남는다.
  const initedNode = useRef<HTMLDivElement | null>(null);
  /** 첫 화면의 배율. 지역 버튼이 이보다 더 축소되지 않도록 바닥으로 쓴다. */
  const homeZoomRef = useRef(0.4);
  /** 사용자가 지도를 한 번이라도 건드렸는가. 건드렸으면 첫 화면으로 되돌리지 않는다. */
  const userMovedRef = useRef(false);

  // 지도는 2000x1400 이지만 야드는 위쪽 600 뿐이고 아래는 전부 바다다.
  // 스크롤 0,0 에서 시작하면 왼쪽 귀퉁이와 바다만 보이므로, 지도가 화면에
  // 붙는 순간 야드 높이에 맞춰 배율을 잡고 가로 중앙으로 보낸다.
  // useEffect 가 아니라 콜백 ref 인 이유: 이름 입력 화면이 떠 있는 동안에는
  // 이 div 자체가 없어서 마운트 시점의 ref 는 항상 null 이다.
  const nativeCleanup = useRef<(() => void) | null>(null);

  const attachViewport = useCallback((node: HTMLDivElement | null) => {
    nativeCleanup.current?.();
    nativeCleanup.current = null;
    viewportRef.current = node;

    if (node) {
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();                       // 기본 스크롤이 얹히지 않게
        userMovedRef.current = true;
        const rect = node.getBoundingClientRect();
        const z1 = Math.min(3, Math.max(0.15, zoomRef.current + e.deltaY * -0.001));
        applyZoomAtRef.current?.(z1, e.clientX - rect.left, e.clientY - rect.top);
      };
      // ── 지도는 브라우저가 아니라 앱이 민다 ───────────────────────────
      // 뷰포트에 touch-action: none 이 걸려 있다(아래 JSX). pan-x pan-y 로 두면
      // 두 손가락이 닿는 순간 브라우저가 몇 번의 touchmove 뒤에 touchcancel 을
      // 던져 핀치가 뚝뚝 끊긴다(Firefox bug 964750, Chrome 도 같은 계열).
      // 대신 한 손가락 밀기를 여기서 직접 처리한다.
      let pan: { x: number, y: number } | null = null;

      /** 배를 잡고 있거나 잡으려는 중이면 지도는 가만히 둔다(마커 쪽에서 처리). */
      const shipBusy = () => !!(holdRef.current || draggingRef.current || panRef.current);

      const onTouchStartNative = (e: TouchEvent) => {
        if (e.touches.length === 1 && !shipBusy()) {
          pan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
          pan = null;
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length >= 2) {
          e.preventDefault();                     // 핀치 중 기본 스크롤/줌 차단
          pan = null;
          const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          );
          // ★기준을 여기서도 잡는다. 두 번째 손가락의 touchstart 가 항상 두 개짜리
          //  이벤트로 오지는 않는다(실측: 손가락 두 개가 거의 동시에 닿으면 touches=1
          //  짜리 하나만 온다). touchstart 에만 기대면 그때 핀치가 통째로 죽는다.
          if (!pinchRef.current) {
            cancelFly(containerRef.current);
            pinchRef.current = { dist, zoom: zoomRef.current };
            pinchingRef.current = true;
            cancelHoldRef.current?.();
            panRef.current = null;
            draggingRef.current = null;
            showArmedRef.current?.(null);
            return;
          }
          const z1 = Math.min(3, Math.max(0.15, pinchRef.current.zoom * (dist / pinchRef.current.dist)));
          const rect = node.getBoundingClientRect();
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
          applyZoomAtRef.current?.(z1, mx, my);
          return;
        }
        if (e.touches.length === 1 && pan && !shipBusy()) {
          e.preventDefault();
          const t = e.touches[0];
          node.scrollLeft -= t.clientX - pan.x;
          node.scrollTop  -= t.clientY - pan.y;
          pan.x = t.clientX; pan.y = t.clientY;
          userMovedRef.current = true;
        }
      };
      const onTouchEndNative = (e: TouchEvent) => {
        // ★기준 버리기를 React 의 onTouchEnd 에만 맡기면 안 된다. 그건 touchcancel 을
        //  안 받는다 — 취소로 끝난 핀치의 기준이 남아 다음 핀치가 옛 기준으로 튄다.
        if (e.touches.length < 2) { pinchRef.current = null; pinchingRef.current = false; }
        pan = e.touches.length === 1 && !shipBusy()
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }   // 핀치 뒤 남은 손가락
          : null;
      };
      const onPointerDown = () => { userMovedRef.current = true; };
      node.addEventListener('wheel', onWheel, { passive: false });
      node.addEventListener('touchstart', onTouchStartNative, { passive: true });
      node.addEventListener('touchmove', onTouchMove, { passive: false });
      node.addEventListener('touchend', onTouchEndNative, { passive: true });
      node.addEventListener('touchcancel', onTouchEndNative, { passive: true });
      node.addEventListener('pointerdown', onPointerDown, { passive: true });
      nativeCleanup.current = () => {
        node.removeEventListener('wheel', onWheel);
        node.removeEventListener('touchstart', onTouchStartNative);
        node.removeEventListener('touchmove', onTouchMove);
        node.removeEventListener('touchend', onTouchEndNative);
        node.removeEventListener('touchcancel', onTouchEndNative);
        node.removeEventListener('pointerdown', onPointerDown);
      };
    }

    if (!node || node === initedNode.current || userMovedRef.current) return;

    let tries = 0;

    // ref 가 붙는 순간에는 flex 레이아웃이 아직 안 잡혀 높이가 0 일 수 있다.
    // 크기가 나올 때까지 몇 프레임 기다린다.
    const apply = () => {
      const vw = node.clientWidth, vh = node.clientHeight;
      // 높이가 아직 화면의 절반도 안 되면 레이아웃이 덜 잡힌 것이다.
      // 이때 배율을 굳히면 지도가 화면보다 작아져 아래에 빈 띠가 생긴다.
      const settled = vw > 0 && vh > 0 && vh >= window.innerHeight * 0.6;
      if (!settled) {
        if (tries++ < 60) requestAnimationFrame(apply);
        return;
      }
      initedNode.current = node;
      // ★첫 화면은 '전체' 다 (2026-08-29 사용자 지시). 예전에는 배가 놓이는 띠에
      //  맞췄는데, 화면이 넓으면 그 계산이 상한(0.9)에 그대로 붙어 2안벽 하나만
      //  꽉 찬 채로 시작했다. 어디를 보고 있는지 알 수 없는 화면이었다.
      //  '전체' 버튼과 정확히 같은 배율·같은 중심으로 진입한다.
      const r = rotRef.current;
      const z = fullFit(vw, vh, r);
      setZoom(z);
      zoomRef.current = z;
      homeZoomRef.current = z;
      // flyTo 와 같은 순서다: 래퍼 크기를 먼저 키워야 스크롤 목표가 옛 범위로
      // 잘리지 않는다. React 의 리렌더를 기다리면 한 프레임 늦어 0 으로 남는다.
      const wrap = node.firstElementChild as HTMLElement | null;
      const inner = wrap?.firstElementChild as HTMLElement | null;
      const cs = contentSize(z, r);
      if (wrap && inner) {
        wrap.style.width = `${cs.w}px`;
        wrap.style.height = `${cs.h}px`;
        inner.style.marginLeft = '';
        inner.style.transform = mapTransform(z, r);
      }
      const c = mapToContent(YARD_W / 2, YARD_H / 2, z, r);
      node.scrollLeft = Math.max(0, Math.min(cs.w - vw, c.x - vw / 2));
      node.scrollTop  = Math.max(0, Math.min(cs.h - vh, c.y - vh / 2));
    };
    requestAnimationFrame(apply);
  }, []);
  const pinchRef = useRef<{ dist: number, zoom: number } | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 애니메이션 중에는 현재 배율을 ref 로 읽는다(클로저가 옛 값을 잡지 않도록).
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const flyingRef = useRef(false);
  /** 진행 중인 이동에 붙는 번호. 새 이동이 시작되면 값이 바뀌고, 이전 프레임 루프는
   *  다음 프레임에 스스로 물러난다. ★예전에는 이동 중이면 새 요청을 **버렸다** —
   *  620ms 안에 다른 버튼을 누르면 그 누름이 통째로 사라져 "가끔 전체가 안 먹힌다" 가 됐다
   *  (실측: 1안벽 누르고 500ms 뒤 전체 → 전체 무시. 700ms 뒤면 정상).
   *  사용자가 "다른 버튼 눌렀다 다시 전체" 로 풀던 것도 그 사이에 620ms 가 지나서였다. */
  const flySeqRef = useRef(0);
  /** 이동을 이어받을 때 원래 transition 을 잃지 않도록 따로 둔다. */
  const flyRestoreRef = useRef('');
  /** 돌고 있는 이동을 물린다. 손으로 확대하거나 지도를 세울 때 부른다. */
  const cancelFly = (inner: HTMLElement | null) => {
    if (!flyingRef.current) return;
    flySeqRef.current++;
    flyingRef.current = false;
    if (inner) inner.style.transition = flyRestoreRef.current;
    // ★멈춘 자리의 배율을 React 에도 알린다. 이동 중에는 DOM 에만 직접 쓰므로 상태는
    //  아직 이동 전 값이다 — 그대로 두면 다음 리렌더가 옛 배율로 transform 을 다시 써서
    //  지도가 뒤로 튄다.
    setZoom(zoomRef.current);
  };
  const applyZoomAtRef = useRef<((z: number, ax: number, ay: number) => void) | null>(null);
  const cancelHoldRef = useRef<(() => void) | null>(null);
  const showArmedRef = useRef<((el: HTMLElement | null) => void) | null>(null);

  /** 화면상의 한 점(ax, ay)을 고정한 채 배율만 바꾼다.
   *
   *  지도는 origin-top-left 로 확대되므로 스크롤을 함께 보정하지 않으면
   *  항상 지도 왼쪽 위를 기준으로 커진다. 그래서 어딘가로 이동한 뒤 핀치하면
   *  손가락 아래가 아니라 엉뚱한 곳이 확대돼 화면이 튄다.
   *  DOM 을 먼저 넓힌 뒤 스크롤해야 목표가 잘리지 않는다. */
  const applyZoomAt = useCallback((z1: number, ax: number, ay: number) => {
    const node = viewportRef.current;
    const inner = containerRef.current;
    const wrap = inner?.parentElement as HTMLElement | null;
    if (!node || !inner || !wrap) return;
    const z0 = zoomRef.current;
    if (!z0) return;
    // 손으로 확대하기 시작했으면 돌고 있던 이동은 물러난다. 안 그러면 매 프레임 서로 덮어쓴다.
    cancelFly(inner);
    const r = rotRef.current;
    // 손가락 아래에 있던 지도 좌표. 회전이 걸려 있으면 되돌려서 읽어야 한다.
    const m = contentToMap(node.scrollLeft + ax, node.scrollTop + ay, z0, r);
    const cs = contentSize(z1, r);
    wrap.style.width = `${cs.w}px`;
    wrap.style.height = `${cs.h}px`;
    inner.style.transform = mapTransform(z1, r);
    const c = mapToContent(m.x, m.y, z1, r);
    node.scrollLeft = Math.max(0, c.x - ax);
    node.scrollTop  = Math.max(0, c.y - ay);
    zoomRef.current = z1;
    setZoom(z1);
  }, []);
  applyZoomAtRef.current = applyZoomAt;

  /** 지역 버튼 → 그 구역이 화면에 꽉 차도록 배율과 위치를 동시에 움직인다.
   *
   *  setZoom 을 부르고 곧바로 scrollTo 를 걸면 안 된다. 그 시점의 스크롤 범위는
   *  아직 이전 배율 기준이라 목표가 잘린다(실측: 목표 946 → 410에서 멈춤).
   *  그래서 애니메이션 동안에는 React 를 거치지 않고 DOM 을 직접 만지고,
   *  끝난 뒤에 최종 배율만 상태로 반영한다. */
  useEffect(() => { rotRef.current = rot; }, [rot]);

  /** 지도를 90도씩 세운다(0 → 90 → 270 → 0).
   *  배율과 화면 한가운데 지도 좌표는 그대로 두고 방향만 바꾼다. 가로로 긴 야드가
   *  세로로 서면서 세로 화면을 채우는 게 목적이라, 배율까지 건드리면 오히려 어긋난다. */
  const rotateMap = useCallback(() => {
    const node = viewportRef.current;
    const inner = containerRef.current;
    const wrap = inner?.parentElement as HTMLElement | null;
    if (!node || !inner || !wrap) return;
    cancelFly(inner);                       // 이동 중이어도 버리지 않는다 — 물리고 돌린다
    const z = zoomRef.current;
    const r0 = rotRef.current;
    const vw = node.clientWidth, vh = node.clientHeight;
    const m = contentToMap(node.scrollLeft + vw / 2, node.scrollTop + vh / 2, z, r0);

    const r1 = YARD_ROTS[(YARD_ROTS.indexOf(r0) + 1) % YARD_ROTS.length];
    rotRef.current = r1;
    setRot(r1);
    try { localStorage.setItem('yardRot', String(r1)); } catch { /* 사파리 비공개 모드 */ }
    userMovedRef.current = true;

    const cs = contentSize(z, r1);
    wrap.style.width = `${cs.w}px`;
    wrap.style.height = `${cs.h}px`;
    inner.style.transform = mapTransform(z, r1);
    const c = mapToContent(m.x, m.y, z, r1);
    node.scrollLeft = Math.max(0, Math.min(cs.w - vw, c.x - vw / 2));
    node.scrollTop  = Math.max(0, Math.min(cs.h - vh, c.y - vh / 2));
  }, []);

  const flyTo = useCallback((r: YardRegion) => {
    const node = viewportRef.current;
    const inner = containerRef.current;
    const wrap = inner?.parentElement as HTMLElement | null;
    if (!node || !inner || !wrap) return;

    const vw = node.clientWidth, vh = node.clientHeight;
    const rr = rotRef.current;
    const PAD = 1.18;                                  // 구역 가장자리 여유
    let z1: number;
    if (r.id === 'all') {
      // '전체' 는 지도 전체(+왼쪽 여백)가 딱 들어오는 배율이다. 여기에 별도
      // 하한을 두면 첫 화면보다 확대돼 오히려 왼쪽 끝이 잘린다.
      z1 = fullFit(vw, vh, rr);
    } else {
      // 구역마다 적당한 배율이 다르다. 도크·돌핀은 꽉 채우면 답답하고,
      // 안벽은 가로로 길어 여유를 두면 전체보기와 구분이 안 된다. (YardMap 의 fit)
      const FIT = r.fit ?? 0.8;
      // 세워 놓으면 구역의 가로세로가 화면 기준으로 뒤바뀐다.
      const [rw, rh] = rr === 0 ? [r.w, r.h] : [r.h, r.w];
      z1 = Math.min(2.2, Math.min(vw / (rw * PAD), vh / (rh * PAD)) * FIT);
      // 안벽은 가로로 길어 폰에서는 화면보다 넓다. 그대로 맞추면 '확대' 버튼을
      // 눌렀는데 오히려 축소돼 버린다. 첫 화면보다 축소하지 않는다.
      z1 = Math.max(z1, homeZoomRef.current);
    }
    const z0 = zoomRef.current;
    const sl0 = node.scrollLeft, st0 = node.scrollTop;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;

    // 돌고 있던 이동이 있으면 그 루프를 물리고 여기서 이어받는다. 원래 transition 은
    // 처음 시작할 때 한 번만 붙잡는다 — 이어받을 때 다시 읽으면 'none' 을 원본으로 오해한다.
    if (!flyingRef.current) flyRestoreRef.current = inner.style.transition;
    const seq = ++flySeqRef.current;
    flyingRef.current = true;
    userMovedRef.current = true;   // 지역 버튼으로 옮겼으면 첫 화면으로 되돌리지 않는다
    inner.style.transition = 'none';                   // CSS 전환과 겹치지 않게

    const DUR = 620;
    const t0 = performance.now();
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now: number) => {
      if (flySeqRef.current !== seq) return;           // 새 목적지가 생겼다 — 이 루프는 물러난다
      const p = Math.min(1, (now - t0) / DUR);
      const e = easeInOutCubic(p);
      const z = z0 + (z1 - z0) * e;
      // ★배율 ref 를 매 프레임 최신으로 둔다. 예전에는 끝날 때 한 번만 반영해서,
      //  이동 도중에 핀치하거나 다른 버튼을 누르면 **이동 전 배율**을 기준으로 삼아 튀었다.
      zoomRef.current = z;

      // 크기를 먼저 넓힌 뒤 스크롤해야 목표가 잘리지 않는다.
      const cs = contentSize(z, rr);
      wrap.style.width = `${cs.w}px`;
      wrap.style.height = `${cs.h}px`;
      inner.style.transform = mapTransform(z, rr);
      const c = mapToContent(cx, cy, z, rr);
      node.scrollLeft = Math.max(0, Math.min(cs.w - vw, c.x - vw / 2));
      node.scrollTop  = Math.max(0, Math.min(cs.h - vh, c.y - vh / 2));

      if (p < 1) { requestAnimationFrame(step); return; }
      inner.style.transition = flyRestoreRef.current;
      flyingRef.current = false;
      setZoom(z1);                                     // 최종 상태만 React 에 반영
    };
    requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchWindData = async () => {
      try {
        // Coordinates for Samho-eup, Yeongam-gun (approx 34.78, 126.46)
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=34.78&longitude=126.46&current_weather=true&hourly=windspeed_10m&timezone=Asia%2FSeoul&windspeed_unit=ms');
        const data = await res.json();
        if (data.current_weather && data.hourly) {
          const { windspeed, winddirection, time } = data.current_weather;
          const dirs = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
          const dirStr = dirs[Math.round(winddirection / 22.5) % 16];
          
          // Get today's 24 hours of wind speeds
          const todaySpeeds = data.hourly.windspeed_10m.slice(0, 24);
          
          setWindData({
            speed: windspeed,
            direction: dirStr,
            degrees: winddirection,
            time: `${new Date(time).getMonth() + 1}월 ${new Date(time).getDate()}일 ${new Date(time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
            hourly: { speeds: todaySpeeds }
          });
        }
      } catch (error) {
        console.error('Failed to fetch wind data:', error);
        // Fallback data in case of network error (e.g., ad blocker, offline)
        setWindData({
          speed: 4.2,
          direction: '북서',
          degrees: 315,
          time: `${new Date().getMonth() + 1}월 ${new Date().getDate()}일 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
          hourly: { speeds: [3.2, 3.5, 4.1, 4.5, 5.0, 5.2, 4.8, 4.2, 3.8, 3.5, 3.2, 3.0, 2.8, 2.5, 2.2, 2.0, 1.8, 1.5, 1.2, 1.0, 0.8, 0.5, 0.3, 0.1] }
        });
      }
    };

    fetchWindData();
    const interval = setInterval(fetchWindData, 30 * 60 * 1000); // 30 minutes
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const generateTideData = (): TideInfo => {
      const now = new Date();
      const baseDate = new Date('2024-01-11T00:00:00Z'); // Approx new moon
      const daysSince = Math.floor((now.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));
      const lunarAge = daysSince % 29.53;
      const lunarDay = Math.floor(lunarAge) + 1;
      
      const shiftMinutes = Math.floor(lunarAge * 50);
      
      const formatTime = (baseMin: number) => {
        const totalMin = (baseMin + shiftMinutes) % (24 * 60);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      const high1 = 2 * 60;
      const low1 = 8 * 60 + 12;
      const high2 = 14 * 60 + 24;
      const low2 = 20 * 60 + 36;

      const tideNames = ["사리", "1물", "2물", "3물", "4물", "5물", "6물", "7물", "조금", "무시", "1물", "2물", "3물", "4물", "5물", "6물", "7물", "8물", "9물", "10물", "11물", "12물", "13물", "14물", "사리", "1물", "2물", "3물", "4물", "5물"];
      const tideName = tideNames[lunarDay % 30] || "사리";

      const heightVariation = Math.cos((lunarAge / 29.53) * Math.PI * 2) * 100;

      let tides = [
        { type: 'High' as const, time: formatTime(high1), height: Math.floor(380 + heightVariation) },
        { type: 'Low' as const, time: formatTime(low1), height: Math.floor(120 - heightVariation / 2) },
        { type: 'High' as const, time: formatTime(high2), height: Math.floor(390 + heightVariation) },
        { type: 'Low' as const, time: formatTime(low2), height: Math.floor(110 - heightVariation / 2) },
      ].sort((a, b) => a.time.localeCompare(b.time));

      const currentMin = now.getHours() * 60 + now.getMinutes();
      let status = "밀물 진행중";
      for (let i = 0; i < tides.length; i++) {
        const [h, m] = tides[i].time.split(':').map(Number);
        const tideMin = h * 60 + m;
        if (currentMin < tideMin) {
          status = tides[i].type === 'High' ? "밀물 진행중" : "썰물 진행중";
          break;
        }
      }

      return {
        dateStr: `${now.getMonth() + 1}월 ${now.getDate()}일`,
        lunarStr: `음력 ${lunarDay}일 ${tideName}`,
        tides,
        status
      };
    };

    setTideData(generateTideData());
    const interval = setInterval(() => {
      setTideData(generateTideData());
    }, 60 * 1000); // Update every minute to keep status fresh
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Check URL for admin mode or if in dev studio
    const params = new URLSearchParams(window.location.search);
    const isDev = window.location.hostname.includes('ais-dev') || window.location.hostname.includes('localhost');
    
    const hasAdminParam = params.get('admin') === 'true' || window.location.hash.includes('admin=true');
    const isSavedAdmin = localStorage.getItem('isAdmin') === 'true';

    // Save admin status to localStorage so it persists when opened from home screen
    if (hasAdminParam) {
      localStorage.setItem('isAdmin', 'true');
    }

    if (hasAdminParam || isSavedAdmin || isDev) {
      // ★열 때는 **권한만** 준다. 모드는 언제나 뷰어로 시작한다 (2026-08-30 사용자 지시).
      //  예전에는 여기서 바로 관리자로 들어갔는데, 한 번 관리자였던 기기는 새로고침을
      //  하든 앱을 죽였다 켜든 계속 관리자로 들어왔다 — 지도를 보려다 배를 옮기게 된다.
      //  관리자로 들어가려면 정보(ⓘ) 배너의 「관리자로 전환」을 한 번 누른다.
      //  ★이름 입력도 여기서 띄우지 않는다. 뷰어로 볼 사람에게 이름부터 물을 이유가 없다.
      setIsAdminUrl(true);
      const savedName = localStorage.getItem('adminName');
      if (savedName) setAdminName(savedName);
    }
  }, []);

  // 수집 심장박동. 문서가 없거나 룰이 아직 안 열렸으면 조용히 숨긴다.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'meta', 'safetyone'),
      snap => setLastSync(snap.exists() ? ((snap.data() as any).lastSuccess ?? null) : null),
      () => setLastSync(null));
    return () => unsub();
  }, []);

  // ?hull=8300 딥링크 — 공정관리비서 앱에서 배지를 누르면 이 주소로 들어온다.
  // 배 데이터가 도착한 뒤 한 번만 그 배로 날아가 깜빡여 준다.
  // ★ships 변화에만 기대면 안 된다 — 이름 입력 화면이 떠 있는 동안 데이터가
  //  먼저 다 도착하면, 뷰포트가 나중에 생겨도 다시 깨울 이벤트가 없다(실측).
  //  그래서 준비될 때까지 짧게 재시도한다.
  const deepLinkRef = useRef<string | null>(new URLSearchParams(window.location.search).get('hull'));
  const shipsRef = useRef(ships);
  useEffect(() => { shipsRef.current = ships; }, [ships]);
  useEffect(() => {
    if (!deepLinkRef.current) return;
    let stop = false, tries = 0;
    const attempt = () => {
      if (stop) return;
      const hull = deepLinkRef.current;
      if (!hull) return;
      const ship = (shipsRef.current as Record<string, ShipData>)[hull];
      if (!ship || !viewportRef.current) {
        if (tries++ < 50) setTimeout(attempt, 400);   // 최대 20초 — 없는 호선이면 포기
        return;
      }
      deepLinkRef.current = null;
      go(hull, ship);
    };
    const go = (hull: string, ship: ShipData) => {
      flyTo({ id: 'deeplink', label: hull, x: ship.x - 110, y: ship.y - 110, w: 220, h: 220, fit: 0.9 });
      setTimeout(() => {
        const el = document.getElementById(`ship-${hull}`)?.querySelector('.ship') as HTMLElement | null;
        if (!el) return;
        el.style.outline = '4px solid #2563eb';
        el.style.outlineOffset = '3px';
        el.style.transition = 'outline-color 0.35s';
        let n = 0;
        const iv = setInterval(() => {
          el.style.outlineColor = n % 2 ? '#2563eb' : 'transparent';
          if (++n > 6) { clearInterval(iv); el.style.outline = ''; el.style.outlineOffset = ''; el.style.transition = ''; }
        }, 350);
      }, 750);
    };
    attempt();
    return () => { stop = true; };
  }, [flyTo]);

  // 호선 명부(작업 호선 · DF)를 한 번 읽어 둔다. 실패하면 OPEN_ROSTER 그대로 —
  // 전부 진하게 보이는, 지금까지와 똑같은 화면이 된다.
  useEffect(() => {
    let alive = true;
    fetchRoster().then(r => { if (alive && r) setRoster(r); });
    return () => { alive = false; };
  }, []);

  // 뷰어 카드용 공정·할일 조회. 탭할 때마다가 아니라 선택이 바뀔 때 한 번(모듈에 5분 캐시).
  useEffect(() => {
    if (appMode === 'admin' || !selectedShipId) { setVesselPlan(null); return; }
    let alive = true;
    setVesselPlan('loading');
    fetchVesselPlan(selectedShipId).then(p => { if (alive) setVesselPlan(p ?? 'error'); });
    return () => { alive = false; };
  }, [selectedShipId, appMode]);

  useEffect(() => {
    const historyRef = query(collection(db, 'history'), orderBy('timestamp', 'desc'), limit(10));
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(logs);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'history'));
    return () => unsubscribe();
  }, []);

  /** 관리자로 들어간다. ★앱을 **열 때가 아니라 누를 때만** 부른다.
   *  이름이 없으면 먼저 받는다 — 작업 이력에 남길 사람이 누구인지가 있어야 한다. */
  const enterAdmin = () => {
    const savedName = localStorage.getItem('adminName');
    if (!savedName) { setShowNamePrompt(true); return; }
    setAdminName(savedName);
    setAppMode('admin');
  };

  const handleTitleTap = async () => {
    setTapCount(prev => {
      const newCount = prev + 1;
      if (newCount >= 5) {
        // 제목 5번 탭은 **지금 이 자리에서 관리자가 되겠다는 뜻**이라 그대로 들어간다.
        const grant = () => {
          localStorage.setItem('isAdmin', 'true');   // 다음에 열 때 전환 버튼이 보이게
          setIsAdminUrl(true);
          enterAdmin();
        };
        if (!user) {
          signInWithPopup(auth, new GoogleAuthProvider())
            .then(grant)
            .catch((error) => { console.error("Login failed", error); });
        } else {
          grant();
        }
        return 0;
      }
      return newCount;
    });

    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = setTimeout(() => setTapCount(0), 1000);
  };

  const draggingRef = useRef<{ type: 'ship' | 'zone', id: string, startX: number, startY: number, initialX: number, initialY: number, currentX: number, currentY: number, isMoved: boolean } | null>(null);
  /** 꾹 누르는 중인 대상. 시간을 채우기 전에는 draggingRef 가 비어 있어 아무것도 안 움직인다. */
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout>, pointerId: number, type: 'ship' | 'zone', id: string, startX: number, startY: number } | null>(null);
  /** 끌 준비가 된 마커. 상태로 두면 리렌더가 끌던 좌표를 되돌려 배가 튄다 —
   *  그래서 React 를 거치지 않고 DOM 에 직접 테두리를 그린다. */
  const armedElRef = useRef<HTMLElement | null>(null);
  /** 두 손가락이 화면에 있는가. isPinching 은 리렌더용이고 이건 즉시 읽으려고 둔다. */
  const pinchingRef = useRef(false);
  /** 배 위에서 시작했지만 끌기가 아니라 지도를 미는 손짓으로 판정된 포인터.
   *  마커에 touch-none 이 걸려 있어 브라우저가 대신 밀어주지 않는다. */
  const panRef = useRef<{ pointerId: number, x: number, y: number } | null>(null);

  const cancelHold = useCallback(() => {
    if (!holdRef.current) return;
    clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  }, []);
  cancelHoldRef.current = cancelHold;

  const dragThrottleTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const zonesRef = collection(db, 'zones');
    const unsubscribeZones = onSnapshot(zonesRef, (snapshot) => {
      const data: Record<string, ZoneData> = {};
      snapshot.forEach(doc => { data[doc.id] = doc.data() as ZoneData; });
      setZones(prev => {
        const next = { ...data };
        if (draggingRef.current && draggingRef.current.type === 'zone') {
          const draggingId = draggingRef.current.id;
          if (next[draggingId]) {
            next[draggingId].x = draggingRef.current.currentX;
            next[draggingId].y = draggingRef.current.currentY;
          }
        }
        return next;
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'zones'));
    return () => unsubscribeZones();
  }, []);

  useEffect(() => {
    const shipsRef = collection(db, 'ships');
    const unsubscribe = onSnapshot(shipsRef, (snapshot) => {
      const data: Record<string, ShipData> = {};
      snapshot.forEach(doc => { data[doc.id] = doc.data() as ShipData; });
      setShips(prev => {
        const next = { ...data };
        if (draggingRef.current && draggingRef.current.type === 'ship') {
          const draggingId = draggingRef.current.id;
          if (next[draggingId]) {
            next[draggingId].x = draggingRef.current.currentX;
            next[draggingId].y = draggingRef.current.currentY;
          }
        }
        return next;
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'ships'));
    return () => unsubscribe();
  }, []);

  const isShipDocked = (ship: ShipData) => {
    return Object.values(zones).some((zone: any) => 
      Math.abs(ship.x - zone.x) < 1 && Math.abs(ship.y - zone.y) < 1
    );
  };

  const logAction = async (action: string, shipId: string) => {
    if (!adminName) return;
    try {
      await addDoc(collection(db, 'history'), {
        action,
        shipId,
        author: adminName,
        timestamp: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'history');
    }
  };

  /** 붙여넣은 텍스트 → 이동 계획. 화면에 보여만 주고 아직 아무것도 안 쓴다. */
  const previewSync = () => {
    const { rows } = parseListText(syncText);
    if (!rows.length) { setSyncPlan(null); return; }
    setSyncPlan(planMoves(rows, new Map(Object.entries(ships))));
  };

  /** 계획 적용. 선석이 바뀐 배만 옮기고 history 에 남긴다. */
  const applySync = async () => {
    if (!syncPlan) return;
    const now = Date.now();
    try {
      for (const item of [...syncPlan.moves, ...syncPlan.creates]) {
        const cur = (ships as Record<string, any>)[item.hull];
        const pos = { x: item.to.x, y: item.to.y, r: item.to.r };
        // berth·loc·syncedAt 는 공정관리비서 연동용. 룰이 추가 필드를 막으면
        // 거부되므로, 그때는 좌표만이라도 쓴다. 기존 배는 부분 갱신 — 문서를
        // 통째로 갈아끼우면 좌표 밖 필드까지 건드려 룰에 걸리고 데이터도 잃는다.
        const extra = { berth: BERTH_LABEL[item.berth], loc: item.loc, syncedAt: now };
        if (cur) {
          try { await updateDoc(doc(db, 'ships', item.hull), { ...pos, ...extra }); }
          catch { await updateDoc(doc(db, 'ships', item.hull), pos); }
        } else {
          try { await setDoc(doc(db, 'ships', item.hull), { ...pos, color: 'yellow', memo: '', ...extra }); }
          catch { await setDoc(doc(db, 'ships', item.hull), { ...pos, color: 'yellow', memo: '' }); }
        }
        logAction(`${BERTH_LABEL[item.berth]}(으)로 이동 — 지도 붙여넣기`, item.hull);
      }
      // 수집 심장박동 — 룰의 meta 항목이 배포되기 전이면 조용히 실패한다.
      setDoc(doc(db, 'meta', 'safetyone'), {
        lastSuccess: now, rows: syncPlan.moves.length + syncPlan.creates.length + syncPlan.skips.length,
        moved: syncPlan.moves.length, created: syncPlan.creates.length, unknown: syncPlan.unknown.length,
      }).catch(() => {});
      setSyncText(''); setSyncPlan(null); setSyncOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'ships');
    }
  };

  const handleAddShip = async () => {
    const name = newShipName.trim();
    if (name) {
      try {
        // 색은 고르지 않는다 — DF 여부를 공정관리 명부가 정한다. yellow 는 저장용 기본값.
        await setDoc(doc(db, 'ships', name), { x: 1000, y: 750, r: 0, color: 'yellow' });
        logAction('배치', name);
        setNewShipName('');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'ships');
      }
    }
  };

  const handleRemoveShip = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setDeleteModalShipId(id);
  };

  const confirmRemoveShip = async () => {
    if (deleteModalShipId) {
      try {
        await deleteDoc(doc(db, 'ships', deleteModalShipId));
        logAction('삭제', deleteModalShipId);
        if (selectedShipId === deleteModalShipId) setSelectedShipId(null);
        setDeleteModalShipId(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'ships');
      }
    }
  };

  /**
   * 뱃머리 뒤집기(180°). 선수·선미는 **세이프티원에 없는 정보**라 사람만 정할 수 있다
   * (배 레이어 angle 은 0/±90 두 값 = 축뿐, 원본 도면도 배를 대칭으로 그린다).
   * 90° 회전과 따로 두는 이유: 축은 수집이 세이프티원 값으로 되돌리므로 90° 는
   * 다음 수집에 사라지고, 앞뒤만 남는다. 여기가 사람의 몫이다.
   */
  const handleFlipShip = async (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const ship = ships[id];
    if (!ship) return;
    const newR = (ship.r + 180) % 360;
    try {
      await updateDoc(doc(db, 'ships', id), { r: newR });
      logAction('뱃머리 뒤집기', id);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'ships');
    }
  };

  const handleRotateShip = async (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const ship = ships[id];
    if (ship) {
      const newR = (ship.r - 90 + 360) % 360;
      try {
        await updateDoc(doc(db, 'ships', id), { r: newR });
        logAction('회전', id);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'ships');
      }
    }
  };

  const handleRotateZone = async (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const zone = zones[id];
    if (zone && !zone.isLocked) {
      try {
        await updateDoc(doc(db, 'zones', id), { r: (zone.r - 90 + 360) % 360 });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'zones');
      }
    }
  };

  const handleToggleLockZone = async (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const zone = zones[id];
    if (zone) {
      try {
        await updateDoc(doc(db, 'zones', id), { isLocked: !zone.isLocked });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'zones');
      }
    }
  };

  const handleRemoveZone = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setDeleteModalZoneId(id);
  };

  const confirmRemoveZone = async () => {
    if (deleteModalZoneId) {
      try {
        await deleteDoc(doc(db, 'zones', deleteModalZoneId));
        if (selectedZoneId === deleteModalZoneId) setSelectedZoneId(null);
        setDeleteModalZoneId(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'zones');
      }
    }
  };

  const openMemoModal = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setMemoInput(ships[id]?.memo || '');
    setMemoModalShipId(id);
  };

  const saveMemo = async () => {
    if (memoModalShipId) {
      try {
        await updateDoc(doc(db, 'ships', memoModalShipId), { memo: memoInput.trim() });
        setMemoModalShipId(null);
        setMemoInput('');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'ships');
      }
    }
  };

  const handleMapClick = async (e: React.MouseEvent) => {
    if (appMode === 'admin' && isAddingZone) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = (e.clientX - rect.left) / zoom;
        const y = (e.clientY - rect.top) / zoom;
        const newZoneId = 'zone_' + Date.now();
        try {
          await setDoc(doc(db, 'zones', newZoneId), { x, y, r: 0 });
          setIsAddingZone(false);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'zones');
        }
      }
    }
  };

  /** 잡혔다는 표시 — 빨간 테두리. 인자가 null 이면 지운다. */
  const showArmed = (el: HTMLElement | null) => {
    const prev = armedElRef.current;
    if (prev) { prev.style.outline = ''; prev.style.outlineOffset = ''; prev.style.boxShadow = ''; }
    armedElRef.current = el;
    if (el) {
      el.style.outline = '3px solid #ef4444';
      el.style.outlineOffset = '2px';
      el.style.boxShadow = '0 0 22px rgba(239,68,68,0.7)';
    }
  };
  showArmedRef.current = showArmed;

  /** 끌기를 실제로 켠다. 마우스는 누르는 즉시, 터치는 DRAG_HOLD_MS 를 채운 뒤. */
  const armDrag = (type: 'ship' | 'zone', id: string, clientX: number, clientY: number) => {
    const src: any = type === 'ship' ? ships[id] : zones[id];
    if (!src) return;
    draggingRef.current = {
      type,
      id,
      startX: clientX,
      startY: clientY,
      initialX: src.x,
      initialY: src.y,
      currentX: src.x,
      currentY: src.y,
      isMoved: false
    };
    const host = document.getElementById(`${type}-${id}`);
    showArmed((host?.querySelector('.ship') as HTMLElement) ?? host);
  };

  const onPointerDown = (e: ReactPointerEvent, id: string, type: 'ship' | 'zone') => {
    if ((e.target as HTMLElement).closest('button')) return;
    cancelHold();
    // 이미 두 손가락이면 줌 중이다. 배를 잡지 않는다.
    if (pinchingRef.current) return;

    // 손가락이 벗어나도 move/up 을 계속 받아야 흔들림(슬롭)을 판정할 수 있다.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 이미 놓친 포인터 */ }

    if (e.pointerType !== 'touch') {          // 마우스·펜은 예전 그대로 바로 끈다
      armDrag(type, id, e.clientX, e.clientY);
      return;
    }

    // 터치는 꾹 눌러야 끌린다. 줌아웃하다 손가락이 배에 닿아 배가 딸려가던 걸 막는다.
    const { pointerId, clientX, clientY } = e;
    holdRef.current = {
      pointerId,
      type,
      id,
      startX: clientX,
      startY: clientY,
      timer: setTimeout(() => {
        holdRef.current = null;
        if (pinchingRef.current) return;
        armDrag(type, id, clientX, clientY);
        navigator.vibrate?.(15);              // 잡혔다는 신호(안드로이드만 동작)
      }, DRAG_HOLD_MS)
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    // 아직 꾹 누르는 중이다. 이만큼 흔들렸으면 끌기가 아니라 지도 조작이다.
    const hold = holdRef.current;
    if (hold && e.pointerId === hold.pointerId) {
      if (Math.abs(e.clientX - hold.startX) > DRAG_HOLD_SLOP ||
          Math.abs(e.clientY - hold.startY) > DRAG_HOLD_SLOP) {
        cancelHold();                                   // 끌기가 아니라 지도를 미는 손짓
        panRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      }
      return;
    }
    // 배 위에서 시작한 지도 밀기 — 여기서 직접 스크롤한다.
    const pan = panRef.current;
    if (pan && e.pointerId === pan.pointerId) {
      const node = viewportRef.current;
      if (node) {
        node.scrollLeft -= e.clientX - pan.x;
        node.scrollTop  -= e.clientY - pan.y;
      }
      pan.x = e.clientX; pan.y = e.clientY;
      userMovedRef.current = true;
      return;
    }
    if (!draggingRef.current) return;
    
    const { type, id } = draggingRef.current;
    if (type === 'zone' && zones[id]?.isLocked) return;

    // 지도를 세워 놨으면 화면에서 오른쪽으로 민 것이 지도에서는 아래쪽이다.
    const d = screenDeltaToMap(
      e.clientX - draggingRef.current.startX,
      e.clientY - draggingRef.current.startY,
      zoom, rotRef.current);
    const dx = d.dx, dy = d.dy;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      draggingRef.current.isMoved = true;
    } else if (!draggingRef.current.isMoved) {
      return;
    }

    let newX = Math.max(0, Math.min(YARD_W, draggingRef.current.initialX + dx));
    let newY = Math.max(0, Math.min(YARD_H, draggingRef.current.initialY + dy));

    if (type === 'ship') {
      const SNAP_DIST = 60;
      let isSnapped = false;
      let snapR = ships[id].r;
      
      for (const [zId, zone] of Object.entries(zones) as [string, any][]) {
        if (Math.hypot(newX - zone.x, newY - zone.y) < SNAP_DIST) {
          let isOccupied = false;
          for (const [sId, s] of Object.entries(ships) as [string, any][]) {
            if (sId !== id && Math.hypot(s.x - zone.x, s.y - zone.y) < SNAP_DIST) {
              isOccupied = true;
              break;
            }
          }
          if (!isOccupied) {
            newX = zone.x;
            newY = zone.y;
            snapR = zone.r;
            isSnapped = true;
            break;
          }
        }
      }

      draggingRef.current.currentX = newX;
      draggingRef.current.currentY = newY;

      const shipElement = document.getElementById(`ship-${id}`);
      if (shipElement) {
        shipElement.style.left = `${newX}px`;
        shipElement.style.top = `${newY}px`;
        shipElement.style.transform = `translate(-50%, -50%) rotate(${isSnapped ? snapR : ships[id].r}deg)`;
      }

      if (!dragThrottleTimer.current) {
        dragThrottleTimer.current = setTimeout(() => {
          updateDoc(doc(db, 'ships', id), { x: newX, y: newY, r: isSnapped ? snapR : ships[id].r }).catch(error => handleFirestoreError(error, OperationType.UPDATE, 'ships'));
          dragThrottleTimer.current = null;
        }, 100);
      }
    } else if (type === 'zone') {
      draggingRef.current.currentX = newX;
      draggingRef.current.currentY = newY;

      const zoneElement = document.getElementById(`zone-${id}`);
      if (zoneElement) {
        zoneElement.style.left = `${newX}px`;
        zoneElement.style.top = `${newY}px`;
      }

      if (!dragThrottleTimer.current) {
        dragThrottleTimer.current = setTimeout(() => {
          updateDoc(doc(db, 'zones', id), { x: newX, y: newY }).catch(error => handleFirestoreError(error, OperationType.UPDATE, 'zones'));
          dragThrottleTimer.current = null;
        }, 100);
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const releaseCapture = () => {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* 이미 놓았다 */ }
    };

    if (panRef.current?.pointerId === e.pointerId) {   // 지도만 밀었다
      panRef.current = null;
      releaseCapture();
      return;
    }

    // 꾹 누르기를 채우기 전에 뗐다 — 예전처럼 선택만 한다.
    const hold = holdRef.current;
    if (hold && e.pointerId === hold.pointerId) {
      cancelHold();
      releaseCapture();
      if (hold.type === 'ship') { setSelectedShipId(hold.id); setSelectedZoneId(null); }
      else { setSelectedZoneId(hold.id); setSelectedShipId(null); }
      return;
    }

    if (!draggingRef.current) { releaseCapture(); showArmed(null); return; }
    showArmed(null);

    const { type, id, isMoved, currentX, currentY } = draggingRef.current;
    releaseCapture();
    
    if (!isMoved) {
      if (type === 'ship') {
        setSelectedShipId(id);
        setSelectedZoneId(null);
      } else {
        setSelectedZoneId(id);
        setSelectedShipId(null);
      }
    } else {
      if (type === 'ship') {
        const SNAP_DIST = 60;
        let finalR = ships[id].r;
        let finalX = currentX;
        let finalY = currentY;
        for (const [zId, zone] of Object.entries(zones) as [string, any][]) {
          if (Math.hypot(currentX - zone.x, currentY - zone.y) < SNAP_DIST) {
            let isOccupied = false;
            for (const [sId, s] of Object.entries(ships) as [string, any][]) {
              if (sId !== id && Math.hypot(s.x - zone.x, s.y - zone.y) < SNAP_DIST) {
                isOccupied = true;
                break;
              }
            }
            if (!isOccupied) {
              finalX = zone.x;
              finalY = zone.y;
              finalR = zone.r;
              break;
            }
          }
        }
        updateDoc(doc(db, 'ships', id), { x: finalX, y: finalY, r: finalR }).catch(error => handleFirestoreError(error, OperationType.UPDATE, 'ships'));
        logAction('이동', id);
        
        const shipElement = document.getElementById(`ship-${id}`);
        if (shipElement) {
          shipElement.style.transform = `translate(-50%, -50%) rotate(${finalR}deg)`;
        }
      } else if (type === 'zone') {
        updateDoc(doc(db, 'zones', id), { x: currentX, y: currentY }).catch(error => handleFirestoreError(error, OperationType.UPDATE, 'zones'));
      }
    }
    
    draggingRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      // 두 손가락이면 줌이다. 잡고 있던 배는 놓는다 — 줌아웃하다 배가 딸려가던 원인.
      cancelHold();
      panRef.current = null;
      draggingRef.current = null;
      showArmed(null);
      // 손가락 아래에서 지도가 계속 날아가면 안 된다. 기준 배율도 지금 이 자리 값으로 잡힌다.
      cancelFly(containerRef.current);
      pinchingRef.current = true;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchRef.current = { dist, zoom: zoomRef.current };
    }
  };


  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchingRef.current = false;
      pinchRef.current = null;
    }
  };


  const handleBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (!(e.target as HTMLElement).closest('.ship') && !(e.target as HTMLElement).closest('.zone')) {
      setSelectedShipId(null);
      setSelectedZoneId(null);
    }
  };

  /** 이름을 받고 관리자로 들어간다. 이름을 받으려던 이유가 그것이다. */
  const confirmName = () => {
    const nm = adminName.trim();
    if (!nm) return;
    localStorage.setItem('adminName', nm);
    setShowNamePrompt(false);
    setAppMode('admin');
  };

  /** 뷰어에서 호선 카드가 떠 있는가. 오른쪽 FAB 열이 이걸 보고 위로 비킨다. */
  const shipCardOpen = appMode !== 'admin' && !!selectedShipId && !!ships[selectedShipId];

  if (showNamePrompt) {
    return (
      <div className="w-screen h-[100dvh] bg-[#2c3e50] flex flex-col items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-xl shadow-2xl flex flex-col items-center w-80">
          <h2 className="text-2xl font-bold mb-2 text-gray-800">관리자 접속</h2>
          <p className="text-sm text-gray-600 mb-6 text-center">작업 이력에 남길<br/>성함을 입력해주세요.</p>
          <input 
            type="text" 
            value={adminName} 
            onChange={e => setAdminName(e.target.value)}
            className="border-2 border-gray-300 p-3 rounded-lg w-full mb-4 text-center text-lg font-bold text-gray-800 focus:border-blue-500 focus:outline-none"
            placeholder="예: 홍길동"
            onKeyDown={e => {
              if (e.key === 'Enter') confirmName();
            }}
          />
          <button 
            onClick={confirmName}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors"
          >
            시작하기
          </button>
          {/* ★물러날 길. 이 화면은 앱을 열 때의 관문이 아니라 '관리자로 전환' 도중이라,
              마음이 바뀌면 돌아갈 수 있어야 한다 — 없으면 새로고침 말고는 길이 없다. */}
          <button
            onClick={() => { setShowNamePrompt(false); setAdminName(localStorage.getItem('adminName') ?? ''); }}
            className="mt-2 w-full px-3 py-2 text-gray-500 font-bold text-sm"
          >
            취소하고 뷰어로 보기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-[100dvh] bg-[#2c3e50] font-sans overflow-hidden flex flex-col">
      {/* 아이콘이 바뀌었을 때 설치본 사용자에게 한 번만. 평소엔 아무것도 안 그린다. */}
      <IconUpdateNotice />
      {/* 홈 화면에 추가하는 길 안내. ?install=1 또는 카톡 등 인앱브라우저일 때만. */}
      <InstallGuide />
      {/* 좌상단: 배너 대신 동그란 버튼. 누르면 배너가 펼쳐진다.
          모드 전환(뷰어/관리자)도 이 안에 넣었다 — 따로 떠 있던 배지를 없애면서
          관리자 모드에서 빠져나올 길이 사라지지 않도록. */}
      <div className="fixed top-3 left-3 z-50 flex flex-col items-start gap-2">
        <button
          onClick={() => setBannerOpen(o => !o)}
          aria-label="정보"
          className={`w-12 h-12 shadow-xl rounded-full flex items-center justify-center border transition-all active:scale-95 ${bannerOpen ? 'bg-blue-600 text-white border-blue-700' : 'bg-white/95 backdrop-blur text-blue-600 border-gray-200'}`}
        >
          <Info size={24} />
        </button>

        {bannerOpen && (
          <div className="bg-white/95 backdrop-blur px-4 py-3 rounded-2xl shadow-xl max-w-[80vw]">
            {/* 제목 5번 탭 = 관리자 잠금 해제. 배너 안으로 들어왔다. */}
            <h3
              className="m-0 text-base font-bold text-gray-800 flex items-center gap-2 cursor-pointer select-none flex-wrap"
              onClick={handleTitleTap}
            >
              <span>아따 요 배 아닌갑다잉</span>
              {isAdminUrl && (
                <span className={`text-xs px-2 py-0.5 rounded text-white whitespace-nowrap ${appMode === 'admin' ? 'bg-blue-600' : 'bg-emerald-600'}`}>
                  {appMode === 'admin' ? '관리자' : '뷰어'}
                </span>
              )}
            </h3>
            {appMode === 'admin' && (
              <p className="m-0 mt-1 text-xs text-gray-600 leading-tight">배를 탭(클릭)하면 메뉴가 나옵니다.</p>
            )}
            {isAdminUrl && (
              <button
                onClick={() => appMode === 'admin' ? setAppMode('viewer') : enterAdmin()}
                className="mt-2 w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-bold text-sm"
              >
                {appMode === 'admin' ? '👀 뷰어로 보기' : '🛠️ 관리자로 전환'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* History Bottom Drawer */}
      <div 
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        className={`fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50 transition-transform duration-300 ease-in-out ${isHistoryOpen ? 'translate-y-0' : 'translate-y-[calc(100%-48px)]'}`}
      >
        <div 
          className="h-12 flex items-center justify-between gap-2 px-4 cursor-pointer border-b border-gray-200"
          onClick={() => setIsHistoryOpen(!isHistoryOpen)}
        >
          {/* ★이 줄은 넷이 자리를 다툰다: 제목 · 수집 칩 · 최근 이력 요약 · 화살표.
              좁아질 때 줄어들 것은 **이력 요약 하나**다 — 제목과 칩은 shrink-0 로 굳힌다.
              (칩에 shrink-0 이 없어서 「3중점검 25분 전」의 뒷부분이 잘렸다 — 사용자 보고) */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h4 className="shrink-0 font-bold text-sm text-gray-800">최근 업데이트</h4>
            {lastSync !== null && (() => {
              // "몇 시간째 그대로" 와 "수집이 죽음" 이 구분돼야 한다.
              // 기준은 SYNC_STALE_MIN 한 곳에서만 정한다.
              // ★글귀는 `위치 확인` 이다 (2026-08-30 사용자 지시). `3중점검` 은 세이프티원의
              //  화면 이름이지 이 칩이 말하는 것이 아니다. `위치 갱신` 도 아니다 — 배가
              //  안 움직여도 이 시각은 찍히므로 "갱신됐다" 는 사실이 아니다. 확인한 것이다.
              const mins = Math.floor((Date.now() - lastSync) / 60000);
              const label = mins < 60 ? `${mins}분 전` : `${Math.floor(mins / 60)}시간 전`;
              return (
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${mins > SYNC_STALE_MIN ? 'bg-red-100 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
                  위치 확인 {label}
                </span>
              );
            })()}
            {!isHistoryOpen && history.length > 0 && (
              <span className="min-w-0 flex-1 truncate text-xs text-gray-600">
                <span className="font-bold text-blue-600">{history[0].author}</span>님이 <span className="font-semibold">{history[0].shipId}</span>호 {history[0].action}
              </span>
            )}
          </div>
          <div className="shrink-0 text-gray-500">
            {isHistoryOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </div>
        </div>
        
        <div className="p-4 max-h-60 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">기록이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {history.map((log, idx) => (
                <li key={idx} className="text-sm text-gray-700 flex justify-between items-center border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                  <span className="truncate pr-2">
                    <span className="font-bold text-blue-600">{log.author}</span>님이 <span className="font-semibold">{log.shipId}</span>호 {log.action}
                  </span>
                  <span className="text-gray-400 text-xs whitespace-nowrap">
                    {new Date(log.timestamp).getMonth() + 1}월 {new Date(log.timestamp).getDate()}일 {new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>



      {/* 열린 패널 하나만 시트로 띄운다.
          폰: 아래에서 올라오는 시트. md 이상: 오른쪽 FAB 옆에 붙는 패널.
          닫혀 있으면 렌더 자체를 안 해서 지도를 조금도 가리지 않는다. */}
      <div
        ref={sheetRef}
        style={{ bottom: 'calc(3rem + var(--dock-h, 4.5rem) + 0.5rem + env(safe-area-inset-bottom))' }}
        className={`fixed z-40 flex flex-col gap-2 transition-all duration-300 ease-out
          left-2 right-2
          md:left-auto md:right-20 md:top-24 md:bottom-auto! md:w-[340px]
          ${openPanel ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-4'}`}
      >
      {/* Info Panel (Tide / Wind) */}
      {openPanel === 'info' && (
      <div className="bg-white/95 backdrop-blur p-3 rounded-2xl shadow-xl flex flex-col gap-1.5 w-auto">
        <div className="flex justify-between items-center border-b border-gray-200 pb-1">
          <div className="flex gap-3">
            <button 
              onClick={() => setInfoTab('wind')}
              className={`font-bold text-sm pb-1 ${infoTab === 'wind' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}
            >
              💨 바람
            </button>
            <button 
              onClick={() => setInfoTab('tide')}
              className={`font-bold text-sm pb-1 ${infoTab === 'tide' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}
            >
              🌊 조석표
            </button>
          </div>
          {infoTab === 'tide' ? null : (
            <span className="text-[10px] text-gray-500">{windData ? `${windData.time} 기준` : '업데이트 중...'}</span>
          )}
        </div>

        {/* Tide Tab (Compact Design) */}
        {infoTab === 'tide' && tideData && (
          <div className="mt-1 flex flex-col gap-1">
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] font-bold text-gray-700 flex items-center gap-1">
                <Droplets className="w-3 h-3 text-blue-500" />
                {tideData.dateStr} 물때 ({tideData.lunarStr})
              </span>
              <div className="flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                </span>
                <span className="text-[9px] font-bold text-blue-600">{tideData.status}</span>
              </div>
            </div>
            
            <div className="flex justify-between gap-1">
              {tideData.tides.map((tide, idx) => (
                <div key={idx} className={`flex-1 ${tide.type === 'High' ? 'bg-red-50/50 border-red-100' : 'bg-blue-50/50 border-blue-100'} rounded p-1 flex flex-col items-center border`}>
                  <div className={`flex items-center gap-0.5 ${tide.type === 'High' ? 'text-red-500' : 'text-blue-500'}`}>
                    {tide.type === 'High' ? <ArrowUpCircle className="w-2.5 h-2.5" /> : <ArrowDownCircle className="w-2.5 h-2.5" />}
                    <span className="text-[9px] font-bold">{tide.type === 'High' ? '만조' : '간조'}</span>
                  </div>
                  <span className="text-xs font-bold text-gray-800 leading-tight">{tide.time}</span>
                  <span className="text-[8px] text-gray-500 leading-tight">{tide.height}cm</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Wind Tab */}
        {infoTab === 'wind' && (
          <>
            {!windData ? (
              <div className="mt-1 flex items-center justify-center h-24 w-full bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-sm text-gray-400">데이터를 불러오는 중...</span>
              </div>
            ) : (
              <div className="mt-1 flex flex-col w-full bg-gradient-to-b from-cyan-50 to-white rounded-lg p-2 border border-cyan-100 shadow-sm">
                <span className="text-[10px] font-bold text-cyan-800 mb-1 px-1">일일 풍속 추이 (m/s)</span>
                <div className="relative w-full">
                  <svg viewBox="0 0 240 60" className="w-full h-auto overflow-visible">
                    <polygon 
                      points={`0,45 ${windData.hourly.speeds.map((s, i) => `${i * (240/23)},${45 - (s/Math.max(...windData.hourly.speeds, 5))*35}`).join(' ')} 240,45`} 
                      fill="#cffafe" opacity="0.8" 
                    />
                    <polyline 
                      points={windData.hourly.speeds.map((s, i) => `${i * (240/23)},${45 - (s/Math.max(...windData.hourly.speeds, 5))*35}`).join(' ')} 
                      fill="none" stroke="#06b6d4" strokeWidth="1.5" 
                    />
                    {[3, 9, 15, 21].map(i => {
                      const x = i * (240/23);
                      const y = 45 - (windData.hourly.speeds[i]/Math.max(...windData.hourly.speeds, 5))*35;
                      return (
                        <g key={i}>
                          <circle cx={x} cy={y} r="2.5" fill="#0891b2" />
                          <text x={x} y={y - 4} fontSize="8" fill="#164e63" textAnchor="middle" fontWeight="bold">{Math.round(windData.hourly.speeds[i] * 10) / 10}</text>
                          <text x={x} y="55" fontSize="8" fill="#64748b" textAnchor="middle">{i}시</text>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* Add Ship Panel */}
      {appMode === 'admin' && openPanel === 'add' && (
        <div className="bg-white/95 backdrop-blur p-3 rounded-2xl shadow-xl grid grid-cols-2 md:grid-cols-1 gap-2 items-center">
          {/* 색 선택 없앴다(2026-08-29) — DF 초록/LNGC 노랑은 공정관리 명부가 정한다. */}
          <input 
            type="text" 
            value={newShipName}
            onChange={e => setNewShipName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddShip()}
            placeholder="호선 번호" 
            className="p-2 text-base w-full min-w-0 lg:w-28 border border-gray-300 rounded text-gray-800"
          />
          <button 
            onClick={handleAddShip}
            className="px-3 sm:px-4 py-2 text-sm sm:text-base bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-bold rounded transition-colors whitespace-nowrap shrink-0"
          >
            배 추가
          </button>
          <button 
            onClick={() => setIsAddingZone(!isAddingZone)}
            className={`px-3 sm:px-4 py-2 text-sm sm:text-base font-bold rounded transition-colors whitespace-nowrap shrink-0 ${isAddingZone ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'}`}
          >
            {isAddingZone ? '영역 추가 취소' : '마그네틱 영역 추가'}
          </button>

          {/* 지도 붙여넣기. 계획을 보여주고 확인해야만 쓴다 —
              선석이 바뀐 배만 옮기고 같은 선석이면 손대지 않는다. */}
          <button
            onClick={() => { setSyncOpen(o => !o); setSyncPlan(null); }}
            className={`col-span-2 md:col-span-1 px-3 py-2 text-sm sm:text-base font-bold rounded transition-colors ${syncOpen ? 'bg-gray-400 text-white' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}
          >
            {syncOpen ? '지도 붙여넣기 닫기' : '지도 붙여넣기'}
          </button>
          {syncOpen && (
            <div className="col-span-2 md:col-span-1 flex flex-col gap-2">
              <textarea
                value={syncText}
                onChange={e => { setSyncText(e.target.value); setSyncPlan(null); }}
                rows={5}
                placeholder={'세이프티원 3중점검 리스트 보기를 복사해 그대로 붙여넣기\n(호선번호와 위치가 든 줄이면 표 전체여도 된다)'}
                className="p-2 text-sm border border-gray-300 rounded w-full text-gray-800 font-mono"
              />
              {syncPlan && (
                <div className="text-xs text-gray-700 max-h-36 overflow-y-auto border border-gray-200 rounded p-2 bg-gray-50 space-y-0.5">
                  {syncPlan.moves.map(m => (
                    <div key={m.hull}>이동 <b>{m.hull}</b> → {BERTH_LABEL[m.berth]}</div>
                  ))}
                  {syncPlan.creates.map(m => (
                    <div key={m.hull}>추가 <b>{m.hull}</b> → {BERTH_LABEL[m.berth]}</div>
                  ))}
                  {syncPlan.unknown.map(u => (
                    <div key={u.hull} className="text-red-600">해석 실패 {u.hull} "{u.loc}"</div>
                  ))}
                  <div className="text-gray-500 pt-1">
                    그대로 {syncPlan.skips.length} · 시운전/출항 {syncPlan.sea.length} · 리스트 밖(안 건드림) {syncPlan.untouched.length}
                  </div>
                </div>
              )}
              {!syncPlan ? (
                <button
                  onClick={previewSync}
                  disabled={!syncText.trim()}
                  className="px-3 py-2 text-sm font-bold rounded bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-300"
                >
                  미리보기
                </button>
              ) : (
                <button
                  onClick={applySync}
                  disabled={!syncPlan.moves.length && !syncPlan.creates.length}
                  className="px-3 py-2 text-sm font-bold rounded bg-teal-600 hover:bg-teal-700 text-white disabled:bg-gray-300"
                >
                  {syncPlan.moves.length || syncPlan.creates.length
                    ? `이동 ${syncPlan.moves.length} · 추가 ${syncPlan.creates.length} 적용`
                    : '바뀐 배 없음'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {/* 오른쪽 FAB 열. 확대/축소 버튼은 없앴다 — 확대는 아래 지역 버튼과
          두 손가락 핀치(데스크톱은 휠)로 한다.
          ★호선 카드가 떠 있으면 위로 비킨다. 이 열은 화면 세로 한가운데(실측 iPhone14
          y394~450)에 있고 카드는 아래에서 위로 자라 y266 까지 올라온다 — 그대로 두면
          버튼이 할일 글자를 덮는다. 카드를 닫으면 제자리로 돌아온다. */}
      <div className={`fixed right-3 z-50 flex flex-col gap-3 ${
        shipCardOpen ? 'top-20' : 'top-1/2 -translate-y-1/2'
      }`}>
        <button
          onClick={() => setOpenPanel(p => p === 'info' ? null : 'info')}
          aria-label="조석·바람"
          className={`w-14 h-14 shadow-xl rounded-full flex items-center justify-center border transition-all active:scale-95 ${openPanel === 'info' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white/95 backdrop-blur text-blue-600 border-gray-200'}`}
        >
          <Waves size={26} />
        </button>
        {appMode === 'admin' && (
          <button
            onClick={() => setOpenPanel(p => p === 'add' ? null : 'add')}
            aria-label="배 추가"
            className={`w-14 h-14 shadow-xl rounded-full flex items-center justify-center border transition-all active:scale-95 ${openPanel === 'add' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white/95 backdrop-blur text-blue-600 border-gray-200'}`}
          >
            <Plus size={28} />
          </button>
        )}
      </div>

      {/* 지역 바로가기. 누르면 그 구역으로 부드럽게 확대 이동한다.
          2단으로 쌓아 가로 폭을 줄이고, 최근 업데이트 바에 바짝 붙인다. */}
      <div
        ref={dockRef}
        style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom))' }}
        className="fixed left-0 right-0 z-40 px-2 overflow-x-auto"
      >
        <div className="grid grid-rows-2 grid-flow-col gap-1 w-max mx-auto pb-0.5">
          {/* 지도 세우기. 가로로 긴 야드를 세로 화면에 맞추는 용도라 지역 버튼과
              같은 줄에 둔다 — 오른쪽 원형 버튼 줄에 넣었더니 지도를 덮었다. */}
          <button
            onClick={rotateMap}
            aria-label="지도 회전"
            className="row-span-2 px-2.5 sm:px-3 shrink-0 rounded-full bg-blue-600 text-white font-bold shadow-lg border border-blue-700 active:scale-95 transition-all flex flex-col items-center justify-center gap-0.5"
          >
            <RotateCw size={18} />
            <span className="text-[10px] leading-none">{rot}°</span>
          </button>
          {YARD_REGIONS.map(r => (
            <button
              key={r.id}
              onClick={() => flyTo(r)}
              className="px-2.5 h-8 text-xs sm:px-4 sm:h-9 sm:text-sm shrink-0 rounded-full bg-white/95 backdrop-blur text-gray-800 font-bold shadow-lg border border-gray-200 active:scale-95 active:bg-blue-50 transition-all"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 뷰어에서 배를 탭하면 뜨는 카드 — 호선번호·3중점검 위치에 더해, 그 호선의
          당일 공정을 공정관리비서(Supabase)에서 읽어 바로 보여준다.
          공정관리 앱으로 진입하지 않는다(2026-08-29 사용자 지시). 노출 규칙은
          "공정기준 -5일": 오늘 걸친 공정 + 시작 D-5 이내 공정.
          여기에 사이드바 `할일` 탭의 `업무`·`준비` 를 D-day 순으로 같이 보여준다
          (2026-08-30 사용자 지시). ★업무 탭의 `할일/진행/완료` 칸은 올리지 않는다 —
          이름만 같고 다른 것이다(#72 에서 헷갈려 넣었다가 #73 에서 되돌렸다). */}
      {shipCardOpen && (
        <div
          style={{ bottom: 'calc(3rem + var(--dock-h, 4.5rem) + var(--sheet-h, 0px) + 1rem + env(safe-area-inset-bottom))' }}
          className="fixed left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur rounded-2xl shadow-xl border border-gray-200 px-4 py-2.5 w-[min(92vw,380px)]"
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-black text-gray-900 leading-tight">{selectedShipId}</div>
              {(ships[selectedShipId] as any).berth && (
                <div className="text-xs text-gray-600 truncate">
                  {(ships[selectedShipId] as any).loc ?? (ships[selectedShipId] as any).berth}
                </div>
              )}
            </div>
            <button
              onClick={() => setSelectedShipId(null)}
              aria-label="닫기"
              className="shrink-0 w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center"
            >
              <X size={18} />
            </button>
          </div>
          {/* 많으면 이 안에서 스크롤한다. 45vh 는 아이폰SE(667)에서도 위 ⓘ 버튼을
              덮지 않는 최대치다 — 더 키우면 지도를 가린다(실측). */}
          <div className="mt-1.5 max-h-[45vh] overflow-y-auto overscroll-contain text-[13px] leading-snug space-y-1.5">
            {vesselPlan === 'loading' && <div className="text-gray-400">공정 일정 불러오는 중…</div>}
            {vesselPlan === 'error' && <div className="text-gray-400">공정관리 연결 실패 — 위치만 표시</div>}
            {vesselPlan && typeof vesselPlan === 'object' && (
              <>
                {vesselPlan.today.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold text-blue-700">오늘 공정</div>
                    {vesselPlan.today.map((it, i) => (
                      <div key={i} className="text-gray-800">{it.label}</div>
                    ))}
                  </div>
                )}
                {vesselPlan.upcoming.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold text-teal-700">다가오는 공정</div>
                    {vesselPlan.upcoming.map((it, i) => (
                      <div key={i} className="flex gap-1.5 text-gray-800">
                        <span className="shrink-0 font-bold tabular-nums text-teal-700">D-{it.dday}</span>
                        <span className="min-w-0 flex-1">
                          {it.label}
                          <span className="text-gray-400"> {it.date ? dateLabel(it.date) : ''}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {vesselPlan.tasks.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold text-amber-700">할일</div>
                    {vesselPlan.tasks.map((it, i) => (
                      <div key={i} className="flex gap-1.5 text-gray-800">
                        <span className={`shrink-0 font-bold tabular-nums ${
                          it.dday! < 0 ? 'text-red-600' : 'text-amber-700'
                        }`}>{ddayLabel(it.dday)}</span>
                        <span className="min-w-0 flex-1">
                          {it.label}
                          <span className="text-gray-400"> · {it.kind}{it.sub ? ` · ${it.sub}` : ''}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {vesselPlan.tasksFailed && (
                  <div className="text-gray-400">할일 불러오기 실패 — 공정만 표시</div>
                )}
                {vesselPlan.today.length + vesselPlan.upcoming.length + vesselPlan.tasks.length === 0 && (
                  <div className="text-gray-400">오늘·임박 공정 없음 · 할일 없음</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {isAddingZone && appMode === 'admin' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full font-bold shadow-lg z-50 animate-pulse pointer-events-none">
          원하는 위치를 탭하여 마그네틱 영역을 생성하세요
        </div>
      )}



      {/* Viewport */}
      <div 
        ref={attachViewport}
        className="flex-1 overflow-auto relative touch-none bg-[#dbe9f4]"
        onPointerDown={handleBackgroundPointerDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          /* 전환 없음 — 배율은 매 프레임 DOM 에 직접 쓴다. CSS 전환을 얹으면
             손가락보다 늦게 따라와 핀치가 끊겨 보인다. */
          style={{ width: contentSize(zoom, rot).w, height: contentSize(zoom, rot).h }}
        >
          <div 
            ref={containerRef}
            style={{ width: YARD_W, height: YARD_H, transform: mapTransform(zoom, rot) }}
            className="relative origin-top-left"
            onClick={handleMapClick}
          >
            <YardMap zoom={zoom} />
          {Object.keys(zones).map((id) => {
            const zone = zones[id];
            const isSelected = selectedZoneId === id;
            return (
              <div
                id={`zone-${id}`}
                key={id}
                className={`zone absolute w-[26px] h-[130px] border-2 border-dashed rounded-[50%_50%_8px_8px] flex flex-col items-center justify-center select-none touch-none transition-transform duration-300
                  ${appMode === 'admin' ? (zone.isLocked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing active:z-[999]') : 'pointer-events-none'}
                  ${isSelected && appMode === 'admin' ? 'border-red-600 bg-red-500/40 z-20 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-orange-500 bg-orange-500/30 z-0'}
                  ${zone.isLocked ? 'border-gray-500 bg-gray-500/30' : ''}
                `}
                style={{
                  left: zone.x,
                  top: zone.y,
                  transform: `translate(-50%, -50%) rotate(${zone.r}deg)`
                }}
                onPointerDown={appMode === 'admin' ? (e) => onPointerDown(e, id, 'zone') : undefined}
                onPointerMove={appMode === 'admin' ? onPointerMove : undefined}
                onPointerUp={appMode === 'admin' ? onPointerUp : undefined}
                onPointerCancel={appMode === 'admin' ? onPointerUp : undefined}
              >
                <div className="text-orange-800/70 font-bold text-xs rotate-90 whitespace-nowrap">DOCK</div>
                {zone.isLocked && <Lock className="absolute text-gray-700/50 w-4 h-4 bottom-2" />}
                {isSelected && appMode === 'admin' && (
                  <div className="absolute right-[-100px] top-[0px] flex flex-col gap-[20px] z-50">
                    <button 
                      className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                      onPointerDown={(e) => handleToggleLockZone(e, id)}
                    >
                      {zone.isLocked ? <Lock size={40} className="text-red-500" /> : <Unlock size={40} className="text-gray-500" />}
                    </button>
                    {!zone.isLocked && (
                      <button 
                        className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                        onPointerDown={(e) => handleRotateZone(e, id)}
                      >
                        <RotateCcw size={40} />
                      </button>
                    )}
                    <button 
                      className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                      onPointerDown={(e) => handleRemoveZone(e, id)}
                    >
                      <X size={40} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {Object.keys(ships).map((id) => {
            const ship = ships[id];
            const isSelected = selectedShipId === id;
            // DF 호선은 초록. 공정관리 명부가 정하고, 명부에 없으면 세이프티원이
            // 같이 적어 준 선종("15500 CNTR(LNG DF)")으로 보조 판정한다.
            const isGreen = roster.df.has(id) || specIsDF((ship as any).spec);
            // 공정일정에 없는 배 = 우리가 안 붙는 배. 물러나게 한다.
            // 명부를 못 읽었으면 working 이 비어 있고, 그때는 아무도 안 흐려진다.
            const isDim = roster.working.size > 0 && !roster.working.has(id);
            const label = hullLabel(ship.r, rot);
            
            return (
              <div
                id={`ship-${id}`}
                key={id}
                className={`absolute w-[26px] h-[130px] select-none touch-none transition-transform duration-300
                  ${appMode === 'admin' ? 'cursor-grab active:cursor-grabbing active:z-[999]' : 'cursor-pointer'}
                  ${isSelected && appMode === 'admin' ? 'z-[100]' : isDim ? 'z-[5]' : 'z-10'}
                `}
                style={{
                  left: ship.x,
                  top: ship.y,
                  // 흐린 배는 우리 호선 아래로 깔린다(z-5) — 겹칠 때 우리 배가 위.
                  opacity: isDim && !isSelected ? 0.28 : 1,
                  transform: `translate(-50%, -50%) rotate(${ship.r}deg)`
                }}
                onPointerDown={appMode === 'admin' ? (e) => onPointerDown(e, id, 'ship') : undefined}
                onPointerMove={appMode === 'admin' ? onPointerMove : undefined}
                onPointerUp={appMode === 'admin' ? onPointerUp : undefined}
                onPointerCancel={appMode === 'admin' ? onPointerUp : undefined}
                onClick={appMode !== 'admin' ? () => setSelectedShipId(prev => prev === id ? null : id) : undefined}
              >
                <div
                  className={`ship relative w-full h-full border-[2px] border-gray-800 rounded-[50%_50%_8px_8px] flex flex-col items-center justify-center transition-all duration-300
                    ${appMode === 'admin' ? 'active:scale-105 active:shadow-[10px_10px_25px_rgba(0,0,0,0.7)]' : ''}
                    ${isGreen ? 'bg-green-500' : 'bg-yellow-400'}
                    ${isSelected && appMode === 'admin' ? 'ring-4 ring-blue-500 ring-offset-2 shadow-[0_0_20px_rgba(59,130,246,0.6)]' : 'shadow-[5px_5px_15px_rgba(0,0,0,0.5)]'}
                  `}
                >
                  {/* Ship Details - Deck / Cargo Area */}
                <div className="absolute inset-x-1 top-8 bottom-8 border-x-2 border-black/10 rounded-sm pointer-events-none"></div>
                
                {/* Ship Details - Bridge (Cabin) */}
                <div className="absolute bottom-2 w-[20px] h-[18px] bg-black/20 border-t-2 border-b-4 border-black/30 rounded-sm pointer-events-none flex items-center justify-center">
                  <div className="w-[12px] h-[3px] bg-black/20 rounded-full"></div>
                </div>

                {/* Ship Details - Bow mark */}
                <div className="absolute top-1 w-[7px] h-[7px] border-t-2 border-black/20 rounded-full pointer-events-none"></div>

                {/* 배 모션은 전부 뺐다. 3중점검에서 가져온 자리에 정박해 있는
                    것이지 움직이는 중이 아니고, 25척이 각자 60fps 로 애니메이션을
                    돌리면 계속 리페인트가 일어나 폰이 뜨거워진다. */}

                {/* 호선번호. 선체가 좁아(26px) 가로 한 줄로는 안 들어간다.
                    선체가 누웠으면 글자도 눕히고, 섰으면 한 자씩 똑바로 쌓는다. */}
                <div
                  className={`z-10 text-[26px] font-black drop-shadow-md ${isGreen ? 'text-white' : 'text-gray-900'}`}
                  style={{ transform: `rotate(${label.rot}deg)` }}
                >
                  {label.stack ? (
                    <div className="flex flex-col items-center leading-[0.85]">
                      {[...id].map((ch, i) => <span key={i}>{ch}</span>)}
                    </div>
                  ) : (
                    <div className="tracking-wider whitespace-nowrap">{id}</div>
                  )}
                </div>

                {/* Memo Display */}
                {ship.memo && (
                  <div 
                    className="absolute z-50 pointer-events-none w-0 h-0"
                    style={{
                      top: '50%',
                      left: '50%',
                      transform: `translate(-50%, -50%) rotate(${-ship.r - rot}deg)`,
                    }}
                  >
                    <div 
                      className="absolute left-1/2 -translate-x-1/2 bg-gradient-to-br from-amber-50 to-yellow-100 border border-amber-300/60 text-amber-950 px-4 py-3 rounded-2xl shadow-xl shadow-amber-900/10 text-[18px] font-memo max-w-[200px] w-max whitespace-normal break-words text-center leading-relaxed backdrop-blur-sm flex items-center justify-center transition-all duration-300"
                      style={{ bottom: ship.r % 180 === 0 ? '90px' : '35px' }}
                    >
                      {/* Inner highlight */}
                      <div className="absolute inset-0 rounded-2xl ring-1 ring-white/60 pointer-events-none"></div>
                      
                      {/* Pointer triangle */}
                      <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 border-solid border-t-amber-300/60 border-t-[10px] border-x-transparent border-x-[10px] border-b-0"></div>
                      <div className="absolute -bottom-[9px] left-1/2 -translate-x-1/2 border-solid border-t-yellow-100 border-t-[9px] border-x-transparent border-x-[9px] border-b-0"></div>
                      
                      {/* Memo content */}
                      <div className="relative z-10 font-bold tracking-wide">
                        {ship.memo}
                      </div>
                    </div>
                  </div>
                )}

                {isSelected && appMode === 'admin' && (
                  <div className="absolute right-[-100px] top-[-40px] flex flex-col gap-[20px] z-50">
                    <button
                      aria-label="뱃머리 뒤집기"
                      className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                      onPointerDown={(e) => handleFlipShip(e, id)}
                    >
                      <ArrowLeftRight size={40} />
                    </button>
                    <button 
                      aria-label="90도 회전"
                      className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                      onPointerDown={(e) => handleRotateShip(e, id)}
                    >
                      <RotateCcw size={40} />
                    </button>
                    <button 
                      className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                      onPointerDown={(e) => openMemoModal(e, id)}
                    >
                      <MessageSquare size={40} />
                    </button>
                    <button 
                      className="w-[80px] h-[80px] bg-white border-[3px] border-gray-800 rounded-full text-black flex items-center justify-center shadow-xl hover:bg-gray-100 active:bg-gray-200 pointer-events-auto"
                      onPointerDown={(e) => handleRemoveShip(e, id)}
                    >
                      <X size={40} />
                    </button>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* Memo Modal */}
      {memoModalShipId && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold mb-4 text-gray-800">메모 작성 ({memoModalShipId})</h3>
            <textarea
              value={memoInput}
              onChange={(e) => setMemoInput(e.target.value)}
              className="w-full h-32 p-3 border border-gray-300 rounded-lg mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-memo text-lg"
              placeholder="메모를 입력하세요..."
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMemoModalShipId(null)}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={saveMemo}
                className="px-4 py-2 text-white bg-blue-500 hover:bg-blue-600 rounded-lg font-medium transition-colors"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Ship Modal */}
      {deleteModalShipId && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold mb-2 text-gray-800">배 삭제</h3>
            <p className="text-gray-600 mb-6">정말 '{deleteModalShipId}' 배를 삭제하시겠습니까?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteModalShipId(null)}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmRemoveShip}
                className="px-4 py-2 text-white bg-red-500 hover:bg-red-600 rounded-lg font-medium transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Zone Modal */}
      {deleteModalZoneId && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold mb-2 text-gray-800">마그네틱 영역 삭제</h3>
            <p className="text-gray-600 mb-6">정말 이 마그네틱 영역을 삭제하시겠습니까?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteModalZoneId(null)}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmRemoveZone}
                className="px-4 py-2 text-white bg-red-500 hover:bg-red-600 rounded-lg font-medium transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
