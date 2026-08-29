import React, { useCallback, useEffect, useRef, useState, PointerEvent as ReactPointerEvent } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, query, orderBy, limit } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from './firebase';
import YardMap, { YARD_REGIONS, YARD_HOME, YARD_W, YARD_H, type YardRegion } from './components/YardMap';

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
import { RotateCcw, X, MessageSquare, Plus, Waves, Info, ChevronUp, ChevronDown, Droplets, ArrowUpCircle, ArrowDownCircle, Lock, Unlock } from 'lucide-react';

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

export default function App() {
  const [ships, setShips] = useState<Record<string, ShipData>>({});
  const [zones, setZones] = useState<Record<string, ZoneData>>({});
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [newShipName, setNewShipName] = useState('');
  const [newShipColor, setNewShipColor] = useState('yellow');
  const [zoom, setZoom] = useState(1);
  const [isPinching, setIsPinching] = useState(false);
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
        const z1 = Math.min(3, Math.max(0.2, zoomRef.current + e.deltaY * -0.001));
        applyZoomAtRef.current?.(z1, e.clientX - rect.left, e.clientY - rect.top);
      };
      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length !== 2 || !pinchRef.current) return;
        e.preventDefault();                       // 핀치 중 기본 스크롤/줌 차단
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        const z1 = Math.min(3, Math.max(0.2, pinchRef.current.zoom * (dist / pinchRef.current.dist)));
        const rect = node.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        applyZoomAtRef.current?.(z1, mx, my);
      };
      const onPointerDown = () => { userMovedRef.current = true; };
      node.addEventListener('wheel', onWheel, { passive: false });
      node.addEventListener('touchmove', onTouchMove, { passive: false });
      node.addEventListener('pointerdown', onPointerDown, { passive: true });
      nativeCleanup.current = () => {
        node.removeEventListener('wheel', onWheel);
        node.removeEventListener('touchmove', onTouchMove);
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
      // 야드 전체가 가로로 들어오게 맞춘다. 폭이 좁을수록 배율이 낮아지지만,
      // 어느 호선이 어디 있는지 한눈에 보는 게 먼저고 자세히는 지역 버튼으로 간다.
      // 하한 0.24 는 가장 좁은 기기(폴드 커버 344px)에서도 야드가 다 들어오는 값.
      // 지도가 화면보다 짧아 남는 여백은 뷰포트 배경(바다색)이 그대로 이어받는다.
      const H = YARD_HOME;
      const z = Math.min(0.9, Math.max(0.24, Math.min(vw / (H.w * 1.05), vh / (H.h * 1.05))));
      setZoom(z);
      zoomRef.current = z;
      homeZoomRef.current = z;
      // flyTo 와 같은 순서다: 래퍼 크기를 먼저 키워야 스크롤 목표가 옛 범위로
      // 잘리지 않는다. React 의 리렌더를 기다리면 한 프레임 늦어 0 으로 남는다.
      const wrap = node.firstElementChild as HTMLElement | null;
      const inner = wrap?.firstElementChild as HTMLElement | null;
      if (wrap && inner) {
        wrap.style.width = `${YARD_W * z}px`;
        wrap.style.height = `${YARD_H * z}px`;
        inner.style.transform = `scale(${z})`;
      }
      node.scrollLeft = Math.max(0, (H.x + H.w / 2) * z - vw / 2);
      node.scrollTop  = Math.max(0, (H.y + H.h / 2) * z - vh / 2);
    };
    requestAnimationFrame(apply);
  }, []);
  const pinchRef = useRef<{ dist: number, zoom: number } | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 애니메이션 중에는 현재 배율을 ref 로 읽는다(클로저가 옛 값을 잡지 않도록).
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const flyingRef = useRef(false);
  const applyZoomAtRef = useRef<((z: number, ax: number, ay: number) => void) | null>(null);

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
    const lx = (node.scrollLeft + ax) / z0;   // 고정하려는 지점의 논리 좌표
    const ly = (node.scrollTop + ay) / z0;
    wrap.style.width = `${YARD_W * z1}px`;
    wrap.style.height = `${YARD_H * z1}px`;
    inner.style.transform = `scale(${z1})`;
    node.scrollLeft = Math.max(0, lx * z1 - ax);
    node.scrollTop  = Math.max(0, ly * z1 - ay);
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
  const flyTo = useCallback((r: YardRegion) => {
    const node = viewportRef.current;
    const inner = containerRef.current;
    const wrap = inner?.parentElement as HTMLElement | null;
    if (!node || !inner || !wrap || flyingRef.current) return;

    const vw = node.clientWidth, vh = node.clientHeight;
    const PAD = 1.18;                                  // 구역 가장자리 여유
    // 구역마다 적당한 배율이 다르다. 도크·돌핀은 꽉 채우면 답답하고,
    // 안벽은 가로로 길어 여유를 두면 전체보기와 구분이 안 된다. (YardMap 의 fit)
    const FIT = r.fit ?? 0.8;
    let z1 = Math.max(0.3, Math.min(2.2, Math.min(vw / (r.w * PAD), vh / (r.h * PAD)) * FIT));
    // 안벽은 가로 700 이라 폰에서는 화면보다 넓다. 그대로 맞추면 '확대' 버튼을
    // 눌렀는데 오히려 축소돼 버린다. '전체' 말고는 첫 화면보다 축소하지 않는다.
    if (r.id !== 'all') z1 = Math.max(z1, homeZoomRef.current);
    const z0 = zoomRef.current;
    const sl0 = node.scrollLeft, st0 = node.scrollTop;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;

    flyingRef.current = true;
    userMovedRef.current = true;   // 지역 버튼으로 옮겼으면 첫 화면으로 되돌리지 않는다
    const prevTransition = inner.style.transition;
    inner.style.transition = 'none';                   // CSS 전환과 겹치지 않게

    const DUR = 620;
    const t0 = performance.now();
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      const e = easeInOutCubic(p);
      const z = z0 + (z1 - z0) * e;

      // 크기를 먼저 넓힌 뒤 스크롤해야 목표가 잘리지 않는다.
      wrap.style.width = `${YARD_W * z}px`;
      wrap.style.height = `${YARD_H * z}px`;
      inner.style.transform = `scale(${z})`;
      node.scrollLeft = Math.max(0, cx * z - vw / 2);
      node.scrollTop  = Math.max(0, cy * z - vh / 2);

      if (p < 1) { requestAnimationFrame(step); return; }
      inner.style.transition = prevTransition;
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
      setIsAdminUrl(true);
      setAppMode('admin');
      const savedName = localStorage.getItem('adminName');
      if (savedName) {
        setAdminName(savedName);
      } else {
        setShowNamePrompt(true);
      }
    }
  }, []);

  useEffect(() => {
    const historyRef = query(collection(db, 'history'), orderBy('timestamp', 'desc'), limit(10));
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(logs);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'history'));
    return () => unsubscribe();
  }, []);

  const handleTitleTap = async () => {
    setTapCount(prev => {
      const newCount = prev + 1;
      if (newCount >= 5) {
        if (!user) {
          signInWithPopup(auth, new GoogleAuthProvider()).then(() => {
            localStorage.setItem('isAdmin', 'true');
            setIsAdminUrl(true);
            setAppMode('admin');
            const savedName = localStorage.getItem('adminName');
            if (savedName) {
              setAdminName(savedName);
            } else {
              setShowNamePrompt(true);
            }
          }).catch((error) => {
            console.error("Login failed", error);
          });
        } else {
          localStorage.setItem('isAdmin', 'true');
          setIsAdminUrl(true);
          setAppMode('admin');
          const savedName = localStorage.getItem('adminName');
          if (savedName) {
            setAdminName(savedName);
          } else {
            setShowNamePrompt(true);
          }
        }
        return 0;
      }
      return newCount;
    });

    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = setTimeout(() => setTapCount(0), 1000);
  };

  const draggingRef = useRef<{ type: 'ship' | 'zone', id: string, startX: number, startY: number, initialX: number, initialY: number, currentX: number, currentY: number, isMoved: boolean } | null>(null);
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

  const handleAddShip = async () => {
    const name = newShipName.trim();
    if (name) {
      try {
        await setDoc(doc(db, 'ships', name), { x: 1000, y: 750, r: 0, color: newShipColor });
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

  const onPointerDown = (e: ReactPointerEvent, id: string, type: 'ship' | 'zone') => {
    if ((e.target as HTMLElement).closest('button')) return;
    
    // Set pointer capture to track outside container
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    
    const initialX = type === 'ship' ? ships[id].x : zones[id].x;
    const initialY = type === 'ship' ? ships[id].y : zones[id].y;

    draggingRef.current = {
      type,
      id,
      startX: e.clientX,
      startY: e.clientY,
      initialX,
      initialY,
      currentX: initialX,
      currentY: initialY,
      isMoved: false
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    
    const { type, id } = draggingRef.current;
    if (type === 'zone' && zones[id]?.isLocked) return;

    const dx = (e.clientX - draggingRef.current.startX) / zoom;
    const dy = (e.clientY - draggingRef.current.startY) / zoom;
    
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
    if (!draggingRef.current) return;
    
    const { type, id, isMoved, currentX, currentY } = draggingRef.current;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
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
    if (e.touches.length === 2) {
      setIsPinching(true);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchRef.current = { dist, zoom: zoomRef.current };
    }
  };


  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setIsPinching(false);
      pinchRef.current = null;
    }
  };


  const handleBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (!(e.target as HTMLElement).closest('.ship') && !(e.target as HTMLElement).closest('.zone')) {
      setSelectedShipId(null);
      setSelectedZoneId(null);
    }
  };

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
              if (e.key === 'Enter' && adminName.trim()) {
                localStorage.setItem('adminName', adminName.trim());
                setShowNamePrompt(false);
              }
            }}
          />
          <button 
            onClick={() => {
              if (adminName.trim()) {
                localStorage.setItem('adminName', adminName.trim());
                setShowNamePrompt(false);
              }
            }}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors"
          >
            시작하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-[100dvh] bg-[#2c3e50] font-sans overflow-hidden flex flex-col">
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
              <span>HD현대삼호 SHIP LOCATION</span>
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
                onClick={() => setAppMode(prev => prev === 'admin' ? 'viewer' : 'admin')}
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
          className="h-12 flex items-center justify-between px-4 cursor-pointer border-b border-gray-200"
          onClick={() => setIsHistoryOpen(!isHistoryOpen)}
        >
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-sm text-gray-800">최근 업데이트</h4>
            {!isHistoryOpen && history.length > 0 && (
              <span className="text-xs text-gray-600 truncate max-w-[200px] sm:max-w-xs">
                <span className="font-bold text-blue-600">{history[0].author}</span>님이 <span className="font-semibold">{history[0].shipId}</span>호 {history[0].action}
              </span>
            )}
          </div>
          <div className="text-gray-500">
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
        className={`fixed z-40 flex flex-col gap-2 transition-all duration-300 ease-out
          left-2 right-2 bottom-[calc(6.5rem+env(safe-area-inset-bottom))]
          md:left-auto md:right-20 md:top-24 md:bottom-auto md:w-[340px]
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
          <select 
            value={newShipColor} 
            onChange={e => setNewShipColor(e.target.value)}
            className="p-2 text-sm border border-gray-300 rounded bg-white text-gray-800 w-full min-w-0 lg:w-auto"
          >
            <option value="yellow">노란색</option>
            <option value="green">초록색</option>
          </select>
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
        </div>
      )}
      </div>

      {/* 오른쪽 FAB 열. 확대/축소 버튼은 없앴다 — 확대는 아래 지역 버튼과
          두 손가락 핀치(데스크톱은 휠)로 한다. */}
      <div className="fixed right-3 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3">
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
        style={{ bottom: 'calc(3rem + env(safe-area-inset-bottom))' }}
        className="fixed left-0 right-0 z-40 px-2 overflow-x-auto"
      >
        <div className="grid grid-rows-2 grid-flow-col gap-1 w-max mx-auto pb-0.5">
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

      {isAddingZone && appMode === 'admin' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full font-bold shadow-lg z-50 animate-pulse pointer-events-none">
          원하는 위치를 탭하여 마그네틱 영역을 생성하세요
        </div>
      )}



      {/* Viewport */}
      <div 
        ref={attachViewport}
        className="flex-1 overflow-auto relative touch-pan-x touch-pan-y bg-[#dbe9f4]"
        onPointerDown={handleBackgroundPointerDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          className={isPinching ? '' : 'transition-all duration-200 ease-out'}
          style={{ width: YARD_W * zoom, height: YARD_H * zoom }}
        >
          <div 
            ref={containerRef}
            style={{ width: YARD_W, height: YARD_H, transform: `scale(${zoom})` }}
            className={`relative origin-top-left ${isPinching ? '' : 'transition-transform duration-300 ease-out'}`}
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
            const isGreen = ship.color === 'green';
            
            return (
              <div
                id={`ship-${id}`}
                key={id}
                className={`absolute w-[26px] h-[130px] select-none touch-none transition-transform duration-300
                  ${appMode === 'admin' ? 'cursor-grab active:cursor-grabbing active:z-[999]' : 'cursor-default'}
                  ${isSelected && appMode === 'admin' ? 'z-[100]' : 'z-10'}
                `}
                style={{
                  left: ship.x,
                  top: ship.y,
                  transform: `translate(-50%, -50%) rotate(${ship.r}deg)`
                }}
                onPointerDown={appMode === 'admin' ? (e) => onPointerDown(e, id, 'ship') : undefined}
                onPointerMove={appMode === 'admin' ? onPointerMove : undefined}
                onPointerUp={appMode === 'admin' ? onPointerUp : undefined}
                onPointerCancel={appMode === 'admin' ? onPointerUp : undefined}
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

                {/* 호선번호. 세로로 선 배는 글자를 한 자씩 쌓지 않고 라벨 자체를
                    90도 눕혀 선체 방향으로 한 줄에 읽히게 한다 (세이프티원과 동일한 방식). */}
                <div 
                  className={`z-10 text-[26px] font-black drop-shadow-md ${isGreen ? 'text-white' : 'text-gray-900'}`}
                  style={{ transform: `rotate(${ship.r % 180 === 0 ? -ship.r - 90 : -ship.r}deg)` }}
                >
                  <div className="tracking-wider whitespace-nowrap">{id}</div>
                </div>

                {/* Memo Display */}
                {ship.memo && (
                  <div 
                    className="absolute z-50 pointer-events-none w-0 h-0"
                    style={{
                      top: '50%',
                      left: '50%',
                      transform: `translate(-50%, -50%) rotate(${-ship.r}deg)`,
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
