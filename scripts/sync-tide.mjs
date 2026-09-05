/**
 * 국립해양조사원(KHOA) 조석예보(고·저조)를 받아 파이어스토어 meta/tide 에 쓴다.
 *
 *   KHOA_SERVICE_KEY=... node scripts/sync-tide.mjs          받아서 쓴다
 *   KHOA_SERVICE_KEY=... node scripts/sync-tide.mjs --dry    받아서 보여주기만 (아무것도 쓰지 않는다)
 *
 * 규칙 (CLAUDE.md 수집 원칙 그대로):
 *  - 파싱·검증은 전부 src/lib/tide.mjs 에 있다. 이 파일은 "부르고 → 넘기고 → 쓴다" 만 한다.
 *  - ★조용히 넘어가지 않는다. 하루치라도 못 받거나 깨지면 exit 1. 아무 일도 안 하고 초록불이면 거짓말이다.
 *  - ★공개 레포다. 키·응답 원문·URL 을 찍지 않는다. 찍는 것은 건수·관측소명·시각·조위 숫자뿐.
 *  - ★시간대는 KST. 러너는 UTC 라 new Date() 의 날짜를 그대로 쓰면 저녁부터 하루가 어긋난다.
 *  - 며칠치(TIDE_DAYS)를 한 문서에 날짜별로 담는다. 액션이 며칠 못 돌아도 앱이 빈 화면이 되지 않게.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import {
  TIDE_STATION, TIDE_DAYS, TIDE_DOC, khoaTideUrl, serviceKeyShape, kstDateKey, addDays, parseKhoaHighLow, buildTideDoc,
} from '../src/lib/tide.mjs';

const dry = process.argv.includes('--dry');
const key = process.env.KHOA_SERVICE_KEY;
if (!key) {
  console.error('KHOA_SERVICE_KEY 가 없다. 공공데이터포털(data.go.kr) 「조석예보(고, 저조)」 활용신청 후 받은 인증키(Decoding)를 넣을 것.');
  process.exit(2);
}

const now = Date.now();
const today = kstDateKey(now);
console.log(`관측소 ${TIDE_STATION.name}(${TIDE_STATION.code}) · ${today}(KST) 부터 ${TIDE_DAYS}일치`);

const days = [];
const failures = [];
for (let i = 0; i < TIDE_DAYS; i++) {
  const date = addDays(today, i);
  try {
    const res = await fetch(khoaTideUrl(key, date.replace(/-/g, '')));
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error(`HTTP ${res.status} · JSON 이 아니다 (${text.length}자)`); }   // 원문은 찍지 않는다
    const d = parseKhoaHighLow(json, date);
    days.push(d);
    console.log(`  ${date}  ${d.tides.map(t => `${t.type === 'High' ? '만' : '간'}${t.time} ${t.height}cm`).join(' · ')}`);
  } catch (e) {
    failures.push(`${date}: ${e?.message ?? e}`);
    console.log(`  ${date}  ✗ ${e?.message ?? e}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length}/${TIDE_DAYS}일치 실패 — 아무것도 쓰지 않는다. 옛 문서가 그대로 남아 앱은 마지막 수신 시각을 보여준다.`);
  // ★못 받았다는 기록에는 **왜 못 받았는지**가 같이 있어야 한다. 키는 값이 아니라 모양만 찍는다(공개 레포).
  console.error(`인증키 모양: ${serviceKeyShape(key)}`);
  if (failures.some(f => f.includes('오류 30') || f.includes('오류 31'))) {
    console.error(
      '게이트웨이 코드 30/31 은 키가 이 서비스에 **등록돼 있지 않다**는 뜻이다. 남은 원인은 둘:\n' +
      '  ① 활용신청이 아직 승인/반영되지 않았다 — data.go.kr → 마이페이지 → 오픈API → 개발계정 에서\n' +
      '     「해양수산부 국립해양조사원_조석예보(고, 저조)」(15156018)가 **승인** 상태인지 본다(반영에 최대 1시간).\n' +
      '  ② 다른 서비스의 키를 넣었다 — 그 신청 상세의 **일반 인증키**를 그대로 다시 넣는다.\n' +
      '  (Encoding/Decoding 어느 쪽을 넣어도 되게 코드가 맞춰 준다 — 이제 그건 원인이 아니다.)');
  }
  process.exit(1);
}

// 관측소 이름이 상수와 다르면 코드를 잘못 짚은 것이다 — 값이 들어와도 맞는 값이 아니다.
const got = days[0].station.name;
if (got !== TIDE_STATION.name) {
  console.error(`응답 관측소명 「${got}」 ≠ 상수 「${TIDE_STATION.name}」. TIDE_STATION.code 를 확인할 것.`);
  process.exit(1);
}

const tideDoc = buildTideDoc(days, now);
if (dry) { console.log('\n[미리보기] 아무것도 쓰지 않았다.'); process.exit(0); }

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const db = getFirestore(initializeApp(cfg), cfg.firestoreDatabaseId);
// 웹 SDK 는 FIRESTORE_EMULATOR_HOST 를 무시한다 — 직접 연결해 줘야 테스트가 프로덕션을 안 건드린다.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  console.log(`(에뮬레이터 ${host}:${port} 에 연결)`);
}

try {
  await setDoc(doc(db, TIDE_DOC.collection, TIDE_DOC.id), tideDoc);
} catch (e) {
  // ★여기서 조용히 넘어가면 "수집은 되는데 앱은 예보 없음" 이 된다. 규칙이 아직 배포 전이면 여기서 빨간불.
  console.error(`meta/tide 쓰기 실패: ${e?.code ?? e}. firestore.rules 의 /meta/tide 가 배포됐는지 볼 것.`);
  process.exit(1);
}
console.log(`\n반영 완료 — ${days.length}일치 (${days[0].date} ~ ${days[days.length - 1].date}) → ${TIDE_DOC.collection}/${TIDE_DOC.id}`);
process.exit(0);
