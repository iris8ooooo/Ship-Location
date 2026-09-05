/**
 * 접속 집계 — 「하루에 몇 명이 앱을 열었나, 누가 열었나」 (2026-09-05 사용자 지시).
 *
 * ★읽기는 오너 한 사람만이다. 그 판정은 **파이어스토어 규칙**이 한다(`isOwner()`).
 *  화면에서 버튼을 숨기는 것은 예의일 뿐 보안이 아니다 — 이 앱의 관리자 모드는
 *  localStorage 한 줄이라 누구나 될 수 있다.
 *
 * ★하루에 **한 번만** 기록한다. 사용자가 물은 것이 "하루 접속자 수" 이기 때문이고,
 *  새로고침을 셀 이유가 없다. 「몇 번 열렸나」는 Cloud Run 요청 로그(Access stats
 *  액션)가 이미 답한다 — 두 곳이 같은 질문에 다르게 답하지 않게 역할을 갈라 둔다.
 *
 * ★기기 id 는 브라우저가 만든다(익명 인증 아님). 파이어베이스 콘솔에서 익명 로그인을
 *  켜야 하는 한 클릭 때문에 기능 전체가 멈추는 것을 피하려는 것이다.
 *  **위조 가능**하다 — 즉 마음먹으면 접속 수를 부풀릴 수 있다(남의 기록을 읽거나
 *  지우지는 못한다. 그건 규칙이 막는다). 사내 도구에서 감수할 만한 위험이다.
 *
 * ★이름은 **자기 신고**다. 서버가 진위를 확인할 방법이 없다(사내 SSO 가 없다).
 *  그래서 이름에 아무 권한도 붙이지 않는다 — 사칭해서 얻는 게 0이면 사칭할 이유도 0이다.
 *  「김은호」라고 적힌 줄을 근거로 사람을 추궁하면 안 된다.
 */
import {
  addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

const DEVICE_KEY = 'visitorDevice';
const NAME_KEY = 'visitorName';
const LAST_DAY_KEY = 'visitDay';

/** 이름 길이 상한. **규칙에도 같은 값이 박혀 있다** — 넘기면 쓰기가 거부된다. */
export const NAME_MAX = 20;

/** 로컬(한국시간) 기준 YYYY-MM-DD. `toISOString` 은 UTC 라 아침에 어제가 나온다. */
function kstDay(d: Date): string {
  const t = new Date(d.getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** 이 기기의 id. 없으면 만든다. 사람이 아니라 **브라우저 하나**를 가리킨다. */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // crypto.randomUUID 는 안전한 컨텍스트(https)에서만 있다. 폴백을 둔다.
      id = (globalThis.crypto?.randomUUID?.() ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';   // 저장소가 막힌 브라우저 — 기록을 포기한다(앱은 그대로 돈다)
  }
}

export function getVisitorName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

export function setVisitorName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.trim().slice(0, NAME_MAX)); } catch { /* 저장 못 해도 앱은 돈다 */ }
}

/** 이름을 물어본 적이 있는가(입력했든 「나중에」를 눌렀든). */
export function nameAsked(): boolean {
  try { return localStorage.getItem(NAME_KEY) !== null; } catch { return true; }
}

/**
 * 오늘 접속을 한 번 기록한다. 이미 오늘 기록했으면 아무것도 안 한다.
 *
 * ★실패해도 조용히 넘어간다 — **지도가 먼저다.** 집계 때문에 앱이 안 뜨면 본말전도다.
 *  (단, 실패를 삼키는 대신 콘솔에는 남긴다.)
 */
export async function recordVisit(): Promise<void> {
  const device = deviceId();
  if (!device) return;
  const today = kstDay(new Date());
  try {
    if (localStorage.getItem(LAST_DAY_KEY) === today) return;
  } catch { /* 저장소가 막혔으면 그냥 쓴다 — 중복은 집계에서 걸러진다 */ }

  try {
    await addDoc(collection(db, 'visits'), {
      device,
      name: getVisitorName().slice(0, NAME_MAX),
      at: serverTimestamp(),        // ★서버가 찍는다. 규칙이 request.time 과 대조한다.
    });
    try { localStorage.setItem(LAST_DAY_KEY, today); } catch { /* 상관없다 */ }
  } catch (e) {
    console.warn('접속 기록 실패(무시하고 진행):', e);
  }
}

export interface DayStat {
  /** YYYY-MM-DD (KST) */
  day: string;
  /** 그날 접속한 **기기 수** */
  people: number;
  /** 그날 이름을 밝힌 사람들 (중복 없음, 가나다순) */
  names: string[];
  /** 그날 이름 없이 들어온 기기 수 */
  anon: number;
}

export interface VisitStats {
  days: DayStat[];          // 최근 → 과거
  today: DayStat;
  /** 기간 전체의 기기 수 */
  totalPeople: number;
  /** 상한에 닿아 과거가 잘렸는가. 잘렸으면 숫자를 믿으면 안 된다. */
  truncated: boolean;
}

const READ_LIMIT = 3000;

/**
 * 최근 `days` 일치를 읽어 날짜별로 묶는다.
 *
 * ★규칙이 오너가 아니면 여기서 `permission-denied` 를 던진다. 그게 **정상 동작**이다 —
 *  화면은 그 오류를 "로그인이 필요합니다" 로 바꿔 보여준다.
 */
export async function fetchVisitStats(days = 14): Promise<VisitStats> {
  const since = new Date(Date.now() - days * 86400 * 1000);
  const snap = await getDocs(query(
    collection(db, 'visits'),
    where('at', '>=', Timestamp.fromDate(since)),
    orderBy('at', 'desc'),
    limit(READ_LIMIT),
  ));

  const byDay = new Map<string, { devices: Set<string>; names: Set<string>; anon: Set<string> }>();
  const allDevices = new Set<string>();

  snap.forEach(d => {
    const v = d.data() as { device?: string; name?: string; at?: Timestamp };
    const ts = v.at?.toDate?.();
    if (!ts || !v.device) return;                 // 서버 시각이 아직 안 박힌 문서는 건너뛴다
    const day = kstDay(ts);
    const g = byDay.get(day) ?? { devices: new Set(), names: new Set(), anon: new Set() };
    g.devices.add(v.device);
    const nm = (v.name ?? '').trim();
    if (nm) g.names.add(nm); else g.anon.add(v.device);
    byDay.set(day, g);
    allDevices.add(v.device);
  });

  const list: DayStat[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))       // 최근이 위
    .map(([day, g]) => ({
      day,
      people: g.devices.size,
      names: [...g.names].sort((a, b) => a.localeCompare(b, 'ko')),
      anon: g.anon.size,
    }));

  const today = kstDay(new Date());
  return {
    days: list,
    today: list.find(d => d.day === today) ?? { day: today, people: 0, names: [], anon: 0 },
    totalPeople: allDevices.size,
    truncated: snap.size >= READ_LIMIT,
  };
}
