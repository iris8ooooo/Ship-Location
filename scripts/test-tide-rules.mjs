/**
 * meta/tide 보안 규칙 테스트 — 규칙은 조용히 틀린다. 조건 하나를 빠뜨려도 에러가 아니라 그냥 통과한다.
 *
 * 지켜야 하는 것:
 *  - 액션이 쓰는 **실제 문서 모양**(buildTideDoc + 실제 KHOA 응답)이 인증 없이 통과한다 — 여기가 막히면 수집이 죽는다.
 *  - 모양이 다르면 거부한다(필드 추가 · days 비움 · lastSuccess 문자열).
 *  - 누구나 읽는다(앱은 로그인 없이 본다).
 *  - meta/safetyone 은 그대로다.
 *
 * 돌리는 법: 파이어스토어 에뮬레이터를 띄운 뒤 `node scripts/test-tide-rules.mjs`.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { parseKhoaHighLow, buildTideDoc, TIDE_DOC } from '../src/lib/tide.mjs';

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
const fixture = d => JSON.parse(readFileSync(new URL(`./fixtures/khoa-tide-DT_0007-${d}.json`, import.meta.url), 'utf8'));
const real = () => buildTideDoc(
  ['2026-09-05', '2026-09-06'].map(d => parseKhoaHighLow(fixture(d.replace(/-/g, '')), d)), Date.now());

const anon = env.unauthenticatedContext();
const ref = ctx => doc(ctx.firestore(), TIDE_DOC.collection, TIDE_DOC.id);

console.log('[1] 쓰기 — 액션이 만드는 실제 문서가 인증 없이 통과한다');
await t('실제 KHOA 응답으로 만든 문서 쓰기', () => assertSucceeds(setDoc(ref(anon), real())));
await t('같은 문서 덮어쓰기(매일 갱신)', () => assertSucceeds(setDoc(ref(anon), real())));

console.log('\n[2] 봉인 — 모양이 다르면 거부');
await t('필드를 하나 더 붙이면 거부', () => assertFails(setDoc(ref(anon), { ...real(), raw: 'x' })));
await t('days 가 비면 거부', () => assertFails(setDoc(ref(anon), { ...real(), days: {} })));
await t('lastSuccess 가 문자열이면 거부', () => assertFails(setDoc(ref(anon), { ...real(), lastSuccess: 'now' })));
await t('station 이 없으면 거부', () => { const d = real(); delete d.station; return assertFails(setDoc(ref(anon), d)); });
await t('station.code 가 없으면 거부', () => assertFails(setDoc(ref(anon), { ...real(), station: { name: '목포' } })));
await t('meta 의 다른 id 는 거부 (잡동사니 못 늘림)', () => assertFails(setDoc(doc(anon.firestore(), 'meta', 'tide2'), real())));

console.log('\n[3] 읽기 — 누구나');
await t('인증 없이 읽기', () => assertSucceeds(getDoc(ref(anon))));

console.log('\n[4] 기존 블록 그대로');
await t('meta/safetyone 쓰기 그대로 통과', () => assertSucceeds(setDoc(doc(anon.firestore(), 'meta', 'safetyone'), { lastSuccess: 1 })));

await env.cleanup();
console.log(fail ? `\n❌ 실패 ${fail}` : '\n✅ 전부 통과');
process.exit(fail ? 1 : 0);
