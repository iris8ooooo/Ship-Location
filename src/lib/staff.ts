/**
 * 직원 명단 — 「누가 봤나」에서 **명단 밖 이름을 알아보기 위한 참고표**다. 문지기가 아니다.
 *
 * ★★**아무도 막지 않는다** (2026-09-05 사용자 결정). 이름 카드는 이 명단을 보지 않는다.
 *  막는 쪽으로 갔다면 **신입이 앱을 못 쓰고, 그 사실을 오너는 모른다** — 신입은 그냥
 *  안 쓰게 되고 끝이다. 실측: 두 명단(2026.04 → 08.20) 사이 4개월에 6명이 들어오고
 *  4명이 빠졌다(월 1.5명꼴). 대신 집계창이 「명단 밖」으로 표시하고 오너가 탭 한 번으로
 *  넣는다 — **앱이 새 사람을 먼저 알려주는 구조**라 명단을 미리 챙길 필요가 없다.
 *
 * ★**이름은 코드에 박지 않는다.** 이 레포도 앱 번들도 공개다. 명단을 박으면 회사 인원
 *  명부를 인터넷에 공개하는 것이 된다. 이름은 파이어스토어에만 살고 **오너만** 읽는다
 *  (규칙 `isOwner()`). 연락처·사번·생년월일은 아예 넣지 않는다 — 필요한 건 이름뿐이다.
 */
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { NAME_MAX } from './visitor-name';

/** 한 번에 넣을 수 있는 이름 수. 명단 하나가 이 아래인지 보고 정했다(현재 34명). */
export const BULK_MAX = 200;

/** 문서 id 로 쓸 수 있는 이름인가. 파이어스토어 id 는 `/` 를 못 쓰고 `.`·`..` 도 안 된다. */
export function isUsableName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= NAME_MAX && !n.includes('/') && n !== '.' && n !== '..';
}

/** 붙여넣은 덩어리에서 이름만 뽑는다. 줄바꿈·쉼표·가운뎃점 아무거나 받는다. */
export function parseNames(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,·\t;]+/)) {
    const n = raw.trim();
    if (isUsableName(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 명단 전체. ★오너가 아니면 `permission-denied` 가 난다 — 그게 정상 동작이다. */
export async function fetchStaff(): Promise<string[]> {
  const snap = await getDocs(collection(db, 'staff'));
  return snap.docs.map(d => d.id).sort((a, b) => a.localeCompare(b, 'ko'));
}

export async function addStaff(name: string): Promise<void> {
  if (!isUsableName(name)) return;
  await setDoc(doc(db, 'staff', name.trim()), { addedAt: serverTimestamp() });
}

export async function removeStaff(name: string): Promise<void> {
  await deleteDoc(doc(db, 'staff', name));
}

/**
 * 여러 명을 한 번에 넣는다. 실패한 이름은 그대로 돌려준다 —
 * ★조용히 넘어가면 "넣었는데 왜 안 뜨지" 가 된다.
 */
export async function addStaffBulk(names: string[]): Promise<{ added: number; failed: string[] }> {
  const failed: string[] = [];
  let added = 0;
  for (const n of names.slice(0, BULK_MAX)) {
    try { await addStaff(n); added++; } catch { failed.push(n); }
  }
  return { added, failed };
}
