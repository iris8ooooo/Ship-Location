/**
 * 조석 — 국립해양조사원(KHOA) 조석예보(고·저조)를 화면 모양(TideInfo)으로 바꾸는 순수 로직.
 * 파이어스토어를 모른다. 액션(scripts/sync-tide.mjs)과 앱(App.tsx)이 같이 쓴다.
 *
 * 흐름:  깃허브 액션(하루 1회) → KHOA API → meta/tide 문서 → 앱이 onSnapshot 으로 읽음
 *
 * ★앱이 KHOA 를 직접 부르지 않는 이유 셋 (2026-09-05):
 *   1. 이 레포는 공개다 — 앱 번들에 실린 API 키는 인터넷에 공개된다.
 *   2. 브라우저에서 부르면 CORS 에 막힐 가능성이 높다.
 *   3. 조석예보는 연 1회 갱신되는 값이라 하루 한 번만 받으면 된다. 사용자마다 부를 이유가 없다.
 *
 * ★관측소는 **재서** 골랐다 (2026-09-05, 예보지점 172곳 좌표를 받아 야드 34.78/126.46 에서 하버사인 거리):
 *     목포 DT_0007   7.7 km   ← 이것
 *     송공항 SO_0566 22.7 km
 *     화봉리 SO_0576 22.8 km
 *   목포가 압도적으로 가깝고(야드가 목포항 건너편이다) 조위관측소(DT_)라 예보 품질도 정식이다.
 *
 * ★API 는 실제 응답으로 확인했다 (추측하지 않았다):
 *   - 정식 경로: 공공데이터포털 게이트웨이 `apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService`
 *     (data.go.kr 15156018 「해양수산부 국립해양조사원_조석예보(고, 저조)」 swagger 의 host 값).
 *     기관 원본은 `www.khoa.go.kr/oceandata/odmiapi/GetTideFcstHghLwApiService.do`.
 *   - 옛 바다누리 `khoa.go.kr/api/oceangrid/...` 는 2026-09 현재 307 → /503.html 로 죽어 있다. 쓰지 말 것.
 *   - 성공 응답: `{header:{resultCode:"00"}, body:{items:{item:[{obsvtrNm, lot, lat, predcDt:"YYYY-MM-DD HH:MM",
 *     predcTdlvVl(cm), extrSe:"1"~"4"}]}, totalCount}}`. extrSe 1=오전 고조 2=오전 저조 3=오후 고조 4=오후 저조.
 *   - 데이터 없음은 **에러가 아니라** `resultCode:"03" NODATA_ERROR` 로 200 OK 다. 게이트웨이 키 오류는
 *     모양이 아예 다르다: `{OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:"30", errMsg}}}` (HTTP 403).
 *     둘 다 "조용한 오답" 이 되기 쉬우므로 parseKhoaHighLow 가 전부 throw 로 바꾼다.
 *   - 응답에 물때·음력은 **없다.** 그래서 아래에서 직접 계산한다(합삭 시각 → 음력 일 → 7물때식).
 */

// ── 상수 (여기 한 곳에서만) ────────────────────────────────────────────────

/** 예보지점. 코드를 다른 파일에 다시 적지 말 것 — 한 곳만 고치게 된다. */
export const TIDE_STATION = { code: 'DT_0007', name: '목포', lat: 34.77972, lon: 126.37555 };

/** 오늘 포함 며칠치를 받아 두나. 액션이 사흘 못 돌아도 화면이 비지 않게 오늘 + 3일. */
export const TIDE_DAYS = 4;

/** 수집 주기(시간). `.github/workflows/sync-tide.yml` 의 크론과 같은 값이어야 한다. */
export const TIDE_SYNC_PERIOD_H = 24;
/** 마지막 성공이 이만큼 지났으면 "갱신이 죽었다" 로 본다 (주기 1.5배 — 크론 지연에 안 흔들리게). */
export const TIDE_STALE_MS = TIDE_SYNC_PERIOD_H * 1.5 * 3600 * 1000;

/** 하루에 이보다 적게 오면 응답이 잘린 것으로 보고 실패시킨다. 목포(반일주조)는 하루 3~4개다. */
export const MIN_TIDES_PER_DAY = 3;

export const KHOA_TIDE_API = 'https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService';

/** 앱·액션이 같이 읽는 문서 위치. */
export const TIDE_DOC = { collection: 'meta', id: 'tide' };

// ── KST 날짜 도우미 ──────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** ms → KST 기준 { y, m, d, hh, mm }. Date 의 로컬 시간대에 의존하지 않는다 — 액션 러너는 UTC 다. */
export function kstParts(ms) {
  const t = new Date(ms + KST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}
const p2 = n => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' (KST) — 문서의 날짜 키. */
export function kstDateKey(ms) { const { y, m, d } = kstParts(ms); return `${y}-${p2(m)}-${p2(d)}`; }
/** 'YYYYMMDD' (KST) — KHOA reqDate. */
export function kstYmd(ms) { return kstDateKey(ms).replace(/-/g, ''); }
/** 날짜 키에 며칠을 더한다. */
export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return kstDateKey(Date.UTC(y, m - 1, d + n) - KST_OFFSET_MS);
}

/**
 * 공공데이터포털 인증키를 **URL 에 얹기 전 모양**으로 맞춘다.
 *
 * ★data.go.kr 은 키를 **두 벌** 준다: `Decoding`(원본 — base64 라 `+ / =` 가 들어 있다)과
 *  `Encoding`(그걸 퍼센트 인코딩한 것 — `%2B %2F %3D`). 아래 `URLSearchParams` 가 값을
 *  **한 번 더** 인코딩하므로, Encoding 키를 넣으면 `%` 가 `%25` 가 되어 **이중 인코딩**된다.
 *  게이트웨이는 그걸 「코드 30 SERVICE_KEY_IS_NOT_REGISTERED(등록되지 않은 서비스키)」로
 *  돌려준다 — **키는 멀쩡한데 등록이 안 된 것처럼 보인다.**
 *  (2026-09-05 첫 실행이 정확히 이렇게 4/4일 죽었다.)
 *
 * ★가르는 법: base64 알파벳(A–Z a–z 0–9 + / =)에는 **`%` 가 없다.** 그러니 `%` 가 있으면
 *  Encoding 키다 → 한 번 되돌린다. Decoding 키는 그대로 통과한다(바뀌는 것이 없다).
 * ★왜 코드가 받아 주나 — 시크릿은 **사람만** 고칠 수 있다. 어느 쪽을 붙여 넣었는지로
 *  수집이 죽는 것은 사람 손을 한 번 더 부르는 일이라, 기계가 흡수할 수 있으면 흡수한다.
 * @param {string} key
 */
export function normalizeServiceKey(key) {
  if (typeof key !== 'string') return key;
  const k = key.trim();
  if (!k.includes('%')) return k;
  try { return decodeURIComponent(k); } catch { return k; }   // `%` 가 있어도 인코딩이 아니면 그대로
}

/** 인증키가 어떤 모양이었는지 — **값은 절대 찍지 않는다**(공개 레포). 실패 진단용. */
export function serviceKeyShape(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  const norm = normalizeServiceKey(k);
  return `${k.length}자 · ${k.includes('%') ? 'Encoding 키로 보임 → 디코딩해서 씀' : 'Decoding 키로 보임 → 그대로 씀'}` +
         (norm === k ? '' : ` (${norm.length}자로)`);
}

export function khoaTideUrl(serviceKey, dateYmd, code = TIDE_STATION.code) {
  const q = new URLSearchParams({
    serviceKey: normalizeServiceKey(serviceKey),
    obsCode: code, reqDate: dateYmd, type: 'json', numOfRows: '50', pageNo: '1',
  });
  return `${KHOA_TIDE_API}?${q}`;
}

// ── KHOA 응답 파싱 ───────────────────────────────────────────────────────

/**
 * KHOA 고·저조 응답 하나(하루치)를 검사해 `{ date, station, tides }` 로 만든다.
 * 조금이라도 이상하면 throw — 비어 오는 것, 다른 날짜, 이상한 값 전부. 조용히 빈 값을 돌려주지 않는다.
 * @param {unknown} json  응답 JSON
 * @param {string} expectDate 'YYYY-MM-DD' — 요청한 날짜. 응답의 날짜가 다르면 실패.
 */
export function parseKhoaHighLow(json, expectDate) {
  if (!json || typeof json !== 'object') throw new Error('응답이 JSON 객체가 아니다');
  const gw = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) throw new Error(`게이트웨이 오류 ${gw.returnReasonCode}: ${gw.errMsg} (${gw.returnAuthMsg ?? ''})`);
  const code = json.header?.resultCode;
  if (code !== '00') throw new Error(`KHOA resultCode ${code}: ${json.header?.resultMsg ?? '(메시지 없음)'}`);
  let items = json.body?.items?.item;
  if (items == null) throw new Error('body.items.item 이 없다');
  if (!Array.isArray(items)) items = [items];           // 한 건이면 객체로 올 수 있는 XML 계열 관례
  if (items.length < MIN_TIDES_PER_DAY) throw new Error(`${expectDate} 고·저조가 ${items.length}건 — 하루치가 아니다`);

  const tides = items.map(it => {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(String(it.predcDt ?? ''));
    if (!m) throw new Error(`predcDt 형식이 다르다: ${JSON.stringify(it.predcDt)}`);
    if (m[1] !== expectDate) throw new Error(`요청 ${expectDate} 인데 응답 날짜가 ${m[1]}`);
    const height = Number(it.predcTdlvVl);
    if (!Number.isFinite(height)) throw new Error(`predcTdlvVl 이 숫자가 아니다: ${JSON.stringify(it.predcTdlvVl)}`);
    const se = String(it.extrSe);
    if (!['1', '2', '3', '4'].includes(se)) throw new Error(`extrSe 가 1~4 가 아니다: ${JSON.stringify(it.extrSe)}`);
    return { type: se === '1' || se === '3' ? 'High' : 'Low', time: `${m[2]}:${m[3]}`, height: Math.round(height) };
  }).sort((a, b) => a.time.localeCompare(b.time));

  // 고조·저조는 반드시 번갈아 온다. 안 그러면 두 날이 섞였거나 응답이 깨진 것이다.
  for (let i = 1; i < tides.length; i++) {
    if (tides[i].type === tides[i - 1].type) throw new Error(`${expectDate} 고·저조가 번갈아 오지 않는다 (${tides[i - 1].time} ${tides[i].time})`);
  }
  const first = items[0];
  return {
    date: expectDate,
    station: { name: String(first.obsvtrNm ?? ''), lat: Number(first.lat), lon: Number(first.lot) },
    tides,
  };
}

/**
 * 며칠치 파싱 결과를 meta/tide 문서 모양으로 만든다.
 * @param {{date:string, tides:object[]}[]} days
 * @param {number} nowMs
 */
export function buildTideDoc(days, nowMs) {
  if (!days.length) throw new Error('하루치도 없다');
  const doc = { station: { code: TIDE_STATION.code, name: TIDE_STATION.name }, days: {}, lastSuccess: nowMs, source: 'KHOA 조석예보(고·저조)' };
  for (const d of days) doc.days[d.date] = d.tides;
  return doc;
}

// ── 음력 일 · 물때 ───────────────────────────────────────────────────────
//
// 물때는 음력 날짜로 정해진다. KHOA 응답에는 없으므로 합삭(신월) 시각을 천문 계산(Meeus, Astronomical
// Algorithms 49장)으로 구해 **KST 기준 합삭이 든 날을 초하루**로 잡는다 — 한국천문연구원 음력의 정의와 같다.
// 정확도는 수 분 이내라 합삭이 KST 자정 몇 분 안에 걸리는 극히 드문 날만 하루 어긋날 수 있다.
// 월 이름·윤달은 필요 없다(물때는 '몇 일' 만 본다).
//
// ★물때 이름은 **7물때식**(서해안형)이다. 목포는 서해권이다. 교차 확인: 바다타임 물때 계산법 표 ·
//  KCI 「한국 물때력의 …」(서해안형=7물때식, 남해안형=8물때식 병존) · 낚시 사이트 2곳.
//     음력  1  2  3   4   5   6   7   8    9    10 11 12 13 14 15
//          7물 8물 9물 10물 11물 12물 13물 조금 무시 1물 2물 3물 4물 5물 6물   (16~30 도 같다)
//  옛 코드의 배열(첫 주기 8칸 · 둘째 14칸)은 자기모순이라 버렸다 — 그래서 음력 24일에 「사리」가 떴다.
//  30일이 없는 달(29일 달)은 그냥 다음 초하루가 7물로 이어진다.

const MUL_7 = ['7물', '8물', '9물', '10물', '11물', '12물', '13물', '조금', '무시', '1물', '2물', '3물', '4물', '5물', '6물'];
/** 음력 일(1~30) → 물때 이름 (7물때식). */
export function mulName(lunarDay) {
  if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) throw new Error(`음력 일이 아니다: ${lunarDay}`);
  return MUL_7[(lunarDay - 1) % 15];
}

const rad = d => d * Math.PI / 180;
const sin = d => Math.sin(rad(d));
/** TDT − UT. 2020년대 약 69초. 하루 단위 판정에는 무시할 수준이지만 정직하게 넣는다. */
const DELTA_T_DAYS = 69 / 86400;

/**
 * k 번째 합삭(2000-01-06 이 k=0)의 시각, UTC ms. Meeus 49장 (신월 계수 표 49.A + 행성 보정 49.B).
 * @param {number} k 정수
 */
export function newMoonMs(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;              // 태양 평균근점이각
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4; // 달 평균근점이각
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;  // 달 위도 인수
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;                        // 승교점 경도
  jde += -0.40720 * sin(Mp)
    + 0.17241 * E * sin(M)
    + 0.01608 * sin(2 * Mp)
    + 0.01039 * sin(2 * F)
    + 0.00739 * E * sin(Mp - M)
    - 0.00514 * E * sin(Mp + M)
    + 0.00208 * E * E * sin(2 * M)
    - 0.00111 * sin(Mp - 2 * F)
    - 0.00057 * sin(Mp + 2 * F)
    + 0.00056 * E * sin(2 * Mp + M)
    - 0.00042 * sin(3 * Mp)
    + 0.00042 * E * sin(M + 2 * F)
    + 0.00038 * E * sin(M - 2 * F)
    - 0.00024 * E * sin(2 * Mp - M)
    - 0.00017 * sin(Om)
    - 0.00007 * sin(Mp + 2 * M)
    + 0.00004 * sin(2 * Mp - 2 * F)
    + 0.00004 * sin(3 * M)
    + 0.00003 * sin(Mp + M - 2 * F)
    + 0.00003 * sin(2 * Mp + 2 * F)
    - 0.00003 * sin(Mp + M + 2 * F)
    + 0.00003 * sin(Mp - M + 2 * F)
    - 0.00002 * sin(Mp - M - 2 * F)
    - 0.00002 * sin(3 * Mp + M)
    + 0.00002 * sin(4 * Mp);
  const A = [
    [0.000325, 299.77 + 0.107408 * k - 0.009173 * T2], [0.000165, 251.88 + 0.016321 * k],
    [0.000164, 251.83 + 26.651886 * k], [0.000126, 349.42 + 36.412478 * k], [0.000110, 84.66 + 18.206239 * k],
    [0.000062, 141.74 + 53.303771 * k], [0.000060, 207.14 + 2.453732 * k], [0.000056, 154.84 + 7.306860 * k],
    [0.000047, 34.52 + 27.261239 * k], [0.000042, 207.19 + 0.121824 * k], [0.000040, 291.34 + 1.844379 * k],
    [0.000037, 161.72 + 24.198154 * k], [0.000035, 239.56 + 25.513099 * k], [0.000023, 331.55 + 3.592518 * k],
  ];
  for (const [c, a] of A) jde += c * sin(a);
  return (jde - DELTA_T_DAYS - 2440587.5) * 86400000;
}

/**
 * 어느 순간(ms)의 음력 일(1~30). KST 기준 — 합삭이 든 KST 날짜가 초하루.
 * @param {number} ms
 */
export function lunarDay(ms) {
  const { y, m, d } = kstParts(ms);
  // k 근사 (Meeus 49.2) 뒤 앞뒤를 훑어 "KST 날짜가 오늘 이하인 마지막 합삭" 을 고른다.
  const yearFrac = y + (m - 1) / 12 + (d - 1) / 365;
  const k0 = Math.floor((yearFrac - 2000) * 12.3685);
  const today = Date.UTC(y, m - 1, d);                          // KST 날짜를 UTC 자정으로 표현한 값(비교용)
  const dayOf = nm => { const p = kstParts(nm); return Date.UTC(p.y, p.m - 1, p.d); };
  let last = null;
  for (let k = k0 - 1; k <= k0 + 2; k++) {
    const nm = newMoonMs(k);
    if (dayOf(nm) <= today && (last == null || nm > last)) last = nm;
  }
  if (last == null) throw new Error('합삭을 못 찾았다');
  const day = Math.round((today - dayOf(last)) / 86400000) + 1;
  if (day < 1 || day > 30) throw new Error(`음력 일 계산이 범위를 벗어났다: ${day}`);
  return day;
}

// ── 화면 모양(TideInfo) ─────────────────────────────────────────────────

/**
 * meta/tide 문서 + 지금 시각 → TideInfo (App.tsx 의 인터페이스와 같은 모양) 또는 null.
 * null 은 "오늘치가 없다" 다. 지어낸 값으로 채우지 않는다 — 화면이 「예보 없음」 을 그린다.
 * @param {{days?: Record<string, {type:'High'|'Low', time:string, height:number}[]>} | null | undefined} docData
 * @param {number} nowMs
 */
export function tideInfoFrom(docData, nowMs) {
  const key = kstDateKey(nowMs);
  const tides = docData?.days?.[key];
  if (!Array.isArray(tides) || tides.length === 0) return null;
  const { m, d, hh, mm } = kstParts(nowMs);
  const nowMin = hh * 60 + mm;
  const toMin = t => { const [h, mi] = t.time.split(':').map(Number); return h * 60 + mi; };
  // 다음에 올 극치가 고조면 지금은 밀물, 저조면 썰물. 오늘 마지막 극치가 지났으면 내일 첫 극치를,
  // 그것도 없으면 마지막 극치의 반대로 본다(고조 뒤는 반드시 썰물이다).
  const next = tides.find(t => toMin(t) > nowMin) ?? docData.days?.[addDays(key, 1)]?.[0];
  const nextType = next ? next.type : (tides[tides.length - 1].type === 'High' ? 'Low' : 'High');
  const ld = lunarDay(nowMs);
  return {
    dateStr: `${m}월 ${d}일`,
    lunarStr: `음력 ${ld}일 ${mulName(ld)}`,
    tides: tides.map(t => ({ type: t.type, time: t.time, height: t.height })),
    status: nextType === 'High' ? '밀물 진행중' : '썰물 진행중',
  };
}

/**
 * 수신 상태 글귀 — "3일째 그대로" 와 "수집이 죽음" 을 갈라 말한다.
 * @returns {{ text: string, stale: boolean } | null}  문서가 없으면 null
 */
export function tideFreshness(docData, nowMs) {
  const last = docData?.lastSuccess;
  if (typeof last !== 'number') return null;
  const { m, d, hh, mm } = kstParts(last);
  const stale = nowMs - last > TIDE_STALE_MS;
  return { text: `${m}/${d} ${p2(hh)}:${p2(mm)} 수신`, stale };
}
