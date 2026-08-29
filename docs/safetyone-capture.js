/**
 * 세이프티원 3중점검 화면에서 리스트를 JSON 으로 내려받는 콘솔 스니펫.
 *
 * 쓰는 법 (크롬):
 *  1. 세이프티원 3중점검 탭에서 '리스트 보기' 를 펼친다 (전체 호선이 보이게).
 *  2. F12 → Console 탭. 처음이면 "allow pasting" 을 입력하고 엔터.
 *  3. 아래 전체를 붙여넣고 엔터 → safetyone-list.json 이 내려받아진다.
 *
 * 내려받은 파일은 두 가지로 쓴다:
 *  - node scripts/sync-safetyone.mjs --input safetyone-list.json  (자동 반영)
 *  - api 항목: 리스트가 어떤 서버 주소에서 오는지 후보 목록.
 *    완전 자동화(폴링)를 만들 때 이 주소를 쓴다.
 */
(() => {
  // 1) 리스트 표에서 호선/위치 뽑기 — 표 구조를 모르므로 관대하게:
  //    행 단위로 텍스트를 훑어 8xxx 호선번호와 선석 이름이 같이 있는 행을 잡는다.
  const BERTH = /(1도크|2도크|1안벽|2안벽|1돌핀|2돌핀|플로팅|1BERTH|시운전|출항|해상)/;
  const rows = [];
  const seen = new Set();
  for (const tr of document.querySelectorAll('tr, [role="row"], li')) {
    const t = (tr.innerText || '').replace(/\n/g, ' ').trim();
    const hull = t.match(/\b(8\d{3})\b/);
    const berth = t.match(BERTH);
    if (hull && berth && !seen.has(hull[1])) {
      seen.add(hull[1]);
      rows.push({ hull: hull[1], loc: t.slice(hull.index + 4).trim().slice(0, 120) });
    }
  }
  // 2) 이 화면이 부른 서버 주소들 — 리스트 API 후보 (XHR/fetch 만)
  const api = performance.getEntriesByType('resource')
    .filter(r => ['xmlhttprequest', 'fetch'].includes(r.initiatorType))
    .map(r => r.name)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 60);

  const out = { capturedAt: new Date().toISOString(), page: location.href, rows, api };
  const a = document.createElement('a');
  a.download = 'safetyone-list.json';
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.click();
  console.log(`호선 ${rows.length}척 캡처 완료, API 후보 ${api.length}개`);
  if (!rows.length) console.warn('행을 못 읽었다 — 리스트 보기가 펼쳐져 있는지 확인. 표를 드래그 복사해서 텍스트로 줘도 된다.');
})();
