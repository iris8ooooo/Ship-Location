/**
 * 접속 집계 보안 규칙 테스트 — **「나만 볼 수 있다」를 실제로 증명한다.**
 *
 * 이 파일이 없으면 "오너만 읽는다" 는 주석에 적힌 희망사항일 뿐이다.
 * 규칙은 조용히 틀린다 — 조건 하나를 빠뜨려도 에러가 아니라 **그냥 통과**한다.
 *
 * 돌리는 법: 파이어스토어 에뮬레이터를 띄운 뒤 `node scripts/test-visits-rules.mjs`.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';

const OWNER = 'iris8ooooo@gmail.com';
const PROJECT = 'ship-location-rules-test';

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (!c) fail++; };
const t = async (label, fn) => {
  try { await fn(); ok(true, label); } catch (e) { ok(false, `${label}  — ${e?.message ?? e}`); }
};

// 누가 누구인가
const anon      = env.unauthenticatedContext();
const owner     = env.authenticatedContext('owner',   { email: OWNER,               email_verified: true });
const ownerUnv  = env.authenticatedContext('unv',     { email: OWNER,               email_verified: false });
const other     = env.authenticatedContext('other',   { email: 'someone@gmail.com',  email_verified: true });

const good = () => ({ device: 'dev-abcdefgh1234', name: '홍길동', at: serverTimestamp() });

console.log('[1] 쓰기 — 인증 없이도 기록은 남는다 (익명 로그인을 켜지 않아도 돌아야 한다)');
await t('인증 없는 사람이 정상 모양으로 쓰면 통과',
  () => assertSucceeds(addDoc(collection(anon.firestore(), 'visits'), good())));

console.log('\n[2] 쓰기 봉인 — 모양이 조금이라도 다르면 거부한다');
await t('필드를 하나라도 더 붙이면 거부 (IP·UA 가 슬쩍 새는 것을 서버가 막는다)',
  () => assertFails(addDoc(collection(anon.firestore(), 'visits'), { ...good(), ip: '1.2.3.4' })));
await t('이름이 20자를 넘으면 거부',
  () => assertFails(addDoc(collection(anon.firestore(), 'visits'), { ...good(), name: '가'.repeat(21) })));
await t('시각을 클라이언트가 지어내면 거부 (서버 시각만 받는다)',
  () => assertFails(addDoc(collection(anon.firestore(), 'visits'), { ...good(), at: new Date(2000, 0, 1) })));
await t('기기 id 가 너무 짧으면 거부',
  () => assertFails(addDoc(collection(anon.firestore(), 'visits'), { ...good(), device: 'short' })));
await t('기기 id 가 숫자면 거부',
  () => assertFails(addDoc(collection(anon.firestore(), 'visits'), { ...good(), device: 12345678 })));

console.log('\n[3] ★읽기 — 오너 한 사람만. 이 프로젝트가 요구한 바로 그것');
await t('인증 없는 사람은 못 읽는다',
  () => assertFails(getDocs(collection(anon.firestore(), 'visits'))));
await t('다른 구글 계정은 못 읽는다',
  () => assertFails(getDocs(collection(other.firestore(), 'visits'))));
await t('같은 이메일이어도 email_verified 가 아니면 못 읽는다',
  () => assertFails(getDocs(collection(ownerUnv.firestore(), 'visits'))));
await t('오너는 읽는다',
  () => assertSucceeds(getDocs(collection(owner.firestore(), 'visits'))));

console.log('\n[4] 기록은 기록이어야 한다 — 아무도 못 고치고 못 지운다');
let id;
await env.withSecurityRulesDisabled(async ctx => {
  const r = await addDoc(collection(ctx.firestore(), 'visits'), { device: 'dev-abcdefgh1234', name: '아무개', at: new Date() });
  id = r.id;
});
await t('오너도 수정 못 한다',
  () => assertFails(setDoc(doc(owner.firestore(), 'visits', id), { device: 'dev-abcdefgh1234', name: '바뀜', at: serverTimestamp() })));
await t('오너도 삭제 못 한다',
  () => assertFails(deleteDoc(doc(owner.firestore(), 'visits', id))));
await t('남도 삭제 못 한다',
  () => assertFails(deleteDoc(doc(anon.firestore(), 'visits', id))));

console.log('\n[5] 기존 컬렉션은 그대로여야 한다 — 수집(sync)이 인증 없이 쓴다');
await t('인증 없이 ships 쓰기 — 그대로 통과 (여기가 막히면 자동수집이 죽는다)',
  () => assertSucceeds(setDoc(doc(anon.firestore(), 'ships', '8206'), { x: 1, y: 2, r: 0, color: 'yellow' })));
await t('인증 없이 ships 읽기 — 그대로 통과',
  () => assertSucceeds(getDocs(collection(anon.firestore(), 'ships'))));
await t('인증 없이 history 쓰기 — 그대로 통과',
  () => assertSucceeds(addDoc(collection(anon.firestore(), 'history'),
    { action: '이동', shipId: '8206', author: '자동수집', timestamp: Date.now() })));

await env.cleanup();
console.log(fail === 0 ? '\n전부 통과' : `\n${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
