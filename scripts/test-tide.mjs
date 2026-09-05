/**
 * 조석 파싱·물때 회귀 테스트 — 파이어스토어 없이 **실제 코드**를 그대로 돌린다.
 *
 * 픽스처는 손으로 만든 것이 아니라 **KHOA 가 실제로 돌려준 응답**이다
 * (scripts/fixtures/khoa-tide-DT_0007-2026090{5,6,7,8}.json — 2026-09-05 에 받음).
 *
 * 지켜야 하는 것:
 *  - 화면의 만조·간조 시각·조위가 **KHOA 값 그대로**여야 한다. 옛 코드는 02:00/08:12/14:24/20:36 에
 *    음력나이×50분을 더한 사인 곡선이었다 — 목포든 인천이든 같은 값이 나왔다.
 *  - 물때 이름은 7물때식으로 맞아야 한다. 옛 배열은 음력 24일에 「사리」를 냈다(정답은 「무시」).
 *  - 응답이 비거나 깨지면 **throw** 해야 한다. 조용히 빈 값을 돌려주면 액션이 초록불로 거짓말을 한다.
 *
 * 돌리는 법: node scripts/test-tide.mjs
 */
import { readFileSync } from 'node:fs';
import {
  parseKhoaHighLow, buildTideDoc, tideInfoFrom, tideFreshness, lunarDay, mulName, newMoonMs,
  kstDateKey, kstYmd, addDays, khoaTideUrl, TIDE_STATION, TIDE_DAYS, TIDE_STALE_MS, MIN_TIDES_PER_DAY,
} from '../src/lib/tide.mjs';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${what}`); }
  else { fail++; console.log(`  ✗ ${what}\n      기대 ${w}\n      실제 ${g}`); }
};
const throws = (fn, what) => {
  try { fn(); fail++; console.log(`  ✗ ${what} — throw 하지 않았다`); }
  catch (e) { pass++; console.log(`  ✓ ${what} (${e.message.slice(0, 60)})`); }
};
const fixture = d => JSON.parse(readFileSync(new URL(`./fixtures/khoa-tide-DT_0007-${d}.json`, import.meta.url), 'utf8'));
/** KST 시각 → ms */
const kst = (y, m, d, hh = 12, mm = 0) => Date.UTC(y, m - 1, d, hh - 9, mm);

console.log('\n① 실제 응답 파싱 — 2026-09-05 목포');
{
  const r = parseKhoaHighLow(fixture('20260905'), '2026-09-05');
  eq(r.station.name, '목포', '관측소명');
  eq(r.tides, [
    { type: 'Low', time: '00:33', height: 173 },
    { type: 'High', time: '07:28', height: 333 },
    { type: 'Low', time: '12:45', height: 97 },
    { type: 'High', time: '20:43', height: 404 },
  ], '만조·간조 4건이 KHOA 값 그대로, 시각순');
  eq(r.tides.every(t => /^\d{2}:\d{2}$/.test(t.time)), true, 'time 은 "HH:MM"');
}

console.log('\n② 4일치 → 문서 → 오늘 화면 (TideInfo 모양 유지)');
{
  const dates = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'];
  const days = dates.map(d => parseKhoaHighLow(fixture(d.replace(/-/g, '')), d));
  const now = kst(2026, 9, 5, 10, 0);
  const doc = buildTideDoc(days, now);
  eq(Object.keys(doc.days), dates, '날짜별로 4일치가 한 문서에');
  eq(doc.station, { code: 'DT_0007', name: '목포' }, '관측소 코드는 상수에서');
  eq(doc.lastSuccess, now, 'lastSuccess = 수집 시각');

  const info = tideInfoFrom(doc, now);
  eq(Object.keys(info).sort(), ['dateStr', 'lunarStr', 'status', 'tides'], 'TideInfo 키 넷 그대로');
  eq(info.dateStr, '9월 5일', 'dateStr');
  eq(info.lunarStr, '음력 24일 무시', 'lunarStr — 옛 코드는 여기서 「사리」를 냈다');
  eq(info.tides.length, 4, '오늘치 4건');
  eq(info.status, '썰물 진행중', '10:00 — 07:28 만조는 지났고 다음은 12:45 간조 → 썰물');
}

console.log('\n③ 진행 상태 — 다음 극치가 정한다');
{
  const doc = buildTideDoc([parseKhoaHighLow(fixture('20260905'), '2026-09-05'), parseKhoaHighLow(fixture('20260906'), '2026-09-06')], 0);
  eq(tideInfoFrom(doc, kst(2026, 9, 5, 5, 0)).status, '밀물 진행중', '05:00 → 다음 07:28 만조 = 밀물');
  eq(tideInfoFrom(doc, kst(2026, 9, 5, 10, 0)).status, '썰물 진행중', '10:00 → 다음 12:45 간조 = 썰물');
  eq(tideInfoFrom(doc, kst(2026, 9, 5, 21, 0)).status, '썰물 진행중', '21:00 → 오늘 끝남, 내일 02:15 간조 = 썰물');
  const only = buildTideDoc([parseKhoaHighLow(fixture('20260905'), '2026-09-05')], 0);
  eq(tideInfoFrom(only, kst(2026, 9, 5, 21, 0)).status, '썰물 진행중', '내일치 없어도 마지막이 만조였으니 썰물');
}

console.log('\n④ 오늘치가 없으면 null — 지어낸 값으로 채우지 않는다');
{
  const doc = buildTideDoc([parseKhoaHighLow(fixture('20260905'), '2026-09-05')], kst(2026, 9, 5));
  eq(tideInfoFrom(doc, kst(2026, 9, 9, 8, 0)), null, '9/9 은 문서에 없다 → null');
  eq(tideInfoFrom(null, kst(2026, 9, 5)), null, '문서 자체가 없다 → null');
  eq(tideInfoFrom({}, kst(2026, 9, 5)), null, 'days 없는 문서 → null');
  eq(tideInfoFrom(doc, kst(2026, 9, 5, 23, 59)) !== null, true, 'KST 23:59 은 아직 9/5 (UTC 로 세면 9/5 14:59 라 어긋나기 쉽다)');
  eq(tideInfoFrom(doc, kst(2026, 9, 6, 0, 0)), null, 'KST 00:00 은 9/6 → 없음');
}

console.log('\n⑤ 마지막 수신 — "그대로" 와 "죽음" 을 가른다');
{
  const doc = buildTideDoc([parseKhoaHighLow(fixture('20260905'), '2026-09-05')], kst(2026, 9, 5, 4, 3));
  eq(tideFreshness(doc, kst(2026, 9, 5, 9, 0)), { text: '9/5 04:03 수신', stale: false }, '5시간 전 → 정상');
  eq(tideFreshness(doc, kst(2026, 9, 6, 15, 0)), { text: '9/5 04:03 수신', stale: false }, '35시간 → 아직(주기 24h 의 1.5배 안)');
  eq(tideFreshness(doc, kst(2026, 9, 6, 17, 0)).stale, true, '37시간 → 죽음');
  eq(tideFreshness({}, 0), null, 'lastSuccess 없으면 null');
  eq(TIDE_STALE_MS, 36 * 3600 * 1000, 'STALE = 주기 24h × 1.5');
}

console.log('\n⑥ 깨진 응답은 전부 throw — 조용한 오답 금지');
{
  const good = fixture('20260905');
  throws(() => parseKhoaHighLow({ header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } }, '2026-09-05'), 'NODATA(200 OK 로 온다)');
  throws(() => parseKhoaHighLow({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: '30', errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } }, '2026-09-05'), '게이트웨이 키 오류(모양이 다르다)');
  throws(() => parseKhoaHighLow({ header: { resultCode: '00' }, body: { items: { item: [] } } }, '2026-09-05'), '0건');
  throws(() => parseKhoaHighLow({ header: { resultCode: '00' }, body: { items: { item: good.body.items.item.slice(0, MIN_TIDES_PER_DAY - 1) } } }, '2026-09-05'), `${MIN_TIDES_PER_DAY}건 미만`);
  throws(() => parseKhoaHighLow(good, '2026-09-06'), '요청한 날짜와 다른 날짜');
  const mutate = f => { const c = JSON.parse(JSON.stringify(good)); f(c.body.items.item); return c; };
  throws(() => parseKhoaHighLow(mutate(it => { it[0].predcTdlvVl = '-'; }), '2026-09-05'), '조위가 숫자가 아님');
  throws(() => parseKhoaHighLow(mutate(it => { it[0].extrSe = '1'; }), '2026-09-05'), '고조가 연달아 옴');
  throws(() => parseKhoaHighLow(mutate(it => { it[0].predcDt = '2026-09-05 0:33'; }), '2026-09-05'), '시각 형식이 다름');
  throws(() => parseKhoaHighLow('<html>', '2026-09-05'), 'JSON 아님');
  throws(() => buildTideDoc([], 0), '하루치도 없는 문서');
}

console.log('\n⑦ 음력 일 — 합삭(Meeus) 이 알려진 값과 맞는가');
{
  const iso = ms => new Date(ms).toISOString().slice(0, 16);
  eq(iso(newMoonMs(0)), '2000-01-06T18:13', 'k=0 합삭 2000-01-06 18:14 UTC (±1분)');
  eq(iso(newMoonMs(323)), '2026-02-17T12:01', '2026-02-17 12:01 UTC 합삭');
  eq(lunarDay(kst(2025, 1, 29)), 1, '2025 설날');
  eq(lunarDay(kst(2025, 10, 6)), 15, '2025 추석');
  eq(lunarDay(kst(2026, 2, 17)), 1, '2026 설날');
  eq(lunarDay(kst(2026, 5, 24)), 8, '2026 부처님오신날 (음 4/8)');
  eq(lunarDay(kst(2026, 9, 25)), 15, '2026 추석');
  eq(lunarDay(kst(2026, 9, 10)), 29, '2026-09-10 = 음 7/29 (7월은 29일 달)');
  eq(lunarDay(kst(2026, 9, 11)), 1, '2026-09-11 = 음 8/1 (합삭 12:27 KST)');
  eq(lunarDay(kst(2026, 9, 5, 0, 1)), 24, 'KST 00:01 도 9/5');
  eq(lunarDay(kst(2026, 9, 5, 23, 59)), 24, 'KST 23:59 도 9/5');
}

console.log('\n⑧ 물때 — 7물때식 (서해). 15일 주기 두 번');
{
  const want = ['7물', '8물', '9물', '10물', '11물', '12물', '13물', '조금', '무시', '1물', '2물', '3물', '4물', '5물', '6물'];
  eq(Array.from({ length: 15 }, (_, i) => mulName(i + 1)), want, '음력 1~15');
  eq(Array.from({ length: 15 }, (_, i) => mulName(i + 16)), want, '음력 16~30 은 같다');
  eq(mulName(24), '무시', '음력 24일 = 무시 (옛 코드: 사리)');
  eq(mulName(8), '조금', '음력 8일 = 조금');
  eq(mulName(30), '6물', '음력 30일 = 6물');
  throws(() => mulName(0), '0일'); throws(() => mulName(31), '31일');
}

console.log('\n⑨ KST 도우미 · URL');
{
  eq(kstDateKey(Date.UTC(2026, 8, 5, 15, 30)), '2026-09-06', 'UTC 9/5 15:30 = KST 9/6 00:30');
  eq(kstYmd(Date.UTC(2026, 8, 5, 14, 59)), '20260905', 'UTC 9/5 14:59 = KST 9/5 23:59');
  eq(addDays('2026-09-30', 1), '2026-10-01', '월말 넘김');
  eq(TIDE_DAYS >= 4, true, '최소 오늘+3일치');
  const u = new URL(khoaTideUrl('KEY', '20260905'));
  eq(u.host, 'apis.data.go.kr', '공공데이터포털 게이트웨이');
  eq(u.pathname, '/1192136/tideFcstHghLw/GetTideFcstHghLwApiService', '조석예보(고·저조) 경로');
  eq([u.searchParams.get('obsCode'), u.searchParams.get('reqDate'), u.searchParams.get('type')], [TIDE_STATION.code, '20260905', 'json'], '파라미터');
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
