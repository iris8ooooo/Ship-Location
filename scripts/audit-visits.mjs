/**
 * 「이름 미등록 N명」이 **왜** 이름이 없는지 센다 (2026-09-05 사용자 질문).
 *
 * 서비스계정 토큰으로 Firestore REST 를 읽는다 — 규칙(`isOwner()`)을 우회하는 관리자
 * 경로다. 그래서 **더더욱 값을 안 찍는다**: 이름도 기기 id 도 로그에 남기지 않는다.
 * 이 레포는 공개이고 액션 로그도 공개다.
 *
 * 판정에 필요한 것은 「그 기기가 **언제 처음 들어왔나**」 하나뿐이다. 이름 묻는 카드가
 * 오늘 세 번 모양이 바뀌었고, 그중 한 구간에는 **「나중에」 버튼**이 있었다 —
 * 그걸 누르면 `visitorAsked` 가 찍혀 **다시는 묻지 않는다**(그 기기는 영영 미등록).
 */
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const token = process.env.TOKEN;
if (!token) { console.error('TOKEN 이 없다.'); process.exit(2); }
const days = Number(process.env.DAYS || 14);

const BASE = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents`;
const PAGE = 300;

/** KST 로 YYYY-MM-DD HH:MM. 러너는 UTC 라 그냥 찍으면 저녁부터 하루가 어긋난다. */
const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);

// 오늘 이름 카드가 바뀐 시각(KST) — 커밋 시각이다. 실제 배포는 몇 분 뒤다.
const MARKS = [
  ['2026-09-05 17:49', '집계 시작 — 카드에 「나중에」 있음'],
  ['2026-09-05 19:35', '「나중에」 제거 — 이름을 적어야 사라짐'],
];
const bucket = (t) => {
  let i = 0;
  for (let k = 0; k < MARKS.length; k++) if (t >= MARKS[k][0]) i = k;
  return t < MARKS[0][0] ? -1 : i;
};

const rows = [];
let pageToken = '';
for (let guard = 0; guard < 50; guard++) {
  const url = `${BASE}/visits?pageSize=${PAGE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    // ★값이 아니라 **왜 막혔는지**를 남긴다. 403 이면 서비스계정에 Firestore 읽기 권한이 없다.
    console.error(`HTTP ${res.status} — visits 를 못 읽었다.`);
    console.error(res.status === 403
      ? '서비스계정에 datastore 읽기 권한이 없다(roles/datastore.viewer). 이 감사는 그 권한이 있어야 돈다.'
      : body.slice(0, 400));
    process.exit(1);
  }
  const j = await res.json();
  for (const d of j.documents ?? []) {
    const f = d.fields ?? {};
    const at = f.at?.timestampValue;
    if (!at || !f.device?.stringValue) continue;
    rows.push({
      device: f.device.stringValue,
      named: !!(f.name?.stringValue ?? '').trim(),
      t: kst(at),
    });
  }
  pageToken = j.nextPageToken ?? '';
  if (!pageToken) break;
}

const since = kst(new Date(Date.now() - days * 86400e3).toISOString()).slice(0, 10);
const kept = rows.filter(r => r.t.slice(0, 10) >= since).sort((a, b) => (a.t < b.t ? -1 : 1));
console.log(`문서 ${rows.length}건 (최근 ${days}일 ${kept.length}건) · 시각은 전부 KST\n`);

// 기기별로 묶는다 — 집계창과 **같은 방식**이다(같은 기기의 두 줄 중 이름 있는 쪽이 이긴다).
const dev = new Map();
for (const r of kept) {
  const d = dev.get(r.device) ?? { rows: 0, named: false, first: r.t, last: r.t, days: new Set() };
  d.rows++; d.named ||= r.named; d.last = r.t; d.days.add(r.t.slice(0, 10));
  dev.set(r.device, d);
}

const byDay = new Map();
for (const [id, d] of dev) for (const day of d.days) {
  const g = byDay.get(day) ?? { named: new Set(), anon: new Set() };
  (d.named ? g.named : g.anon).add(id);
  byDay.set(day, g);
}
console.log('날짜별 (집계창과 같은 셈)');
for (const [day, g] of [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)))
  console.log(`  ${day}  기기 ${g.named.size + g.anon.size} = 이름 ${g.named.size} + 미등록 ${g.anon.size}`);

const anon = [...dev.values()].filter(d => !d.named);
console.log(`\n이름 미등록 기기 ${anon.length}대 — 각각 언제 처음 들어왔나`);
const tally = new Map();
for (const d of anon.sort((a, b) => (a.first < b.first ? -1 : 1))) {
  const b = bucket(d.first);
  const label = b < 0 ? '집계 시작 전(있을 수 없음)' : MARKS[b][1];
  tally.set(label, (tally.get(label) ?? 0) + 1);
  console.log(`  첫 접속 ${d.first} · 줄 ${d.rows} · 방문일 ${d.days.size}일 → ${label}`);
}
console.log('\n구간별 합계');
for (const [k, v] of tally) console.log(`  ${v}대 — ${k}`);
console.log(`\n※ 「나중에」 구간(17:49~19:35)에 처음 들어온 기기는 그 버튼을 눌렀다면`);
console.log(`   visitorAsked 가 찍혀 **다시는 묻지 않는다** — 영영 미등록으로 남는다.`);
console.log(`※ 이름·기기 id 는 일부러 안 찍었다(공개 레포).`);
