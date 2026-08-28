---
name: "yard-map-extract"
description: "세이프티원 3중점검 화면에서 야드 지도의 원본 좌표를 통째로 뽑아 JSON 파일로 저장한다. \"야드 지도 좌표 뽑아\", \"3중점검 지도 긁어와\", \"세이프티원 지도 추출\", \"지도 원본 좌표\" 같은 요청에 사용. 사용자 컴퓨터(크롬)에서 실행하는 것을 전제로 한다."
---

# 세이프티원 야드 지도 좌표 추출

배위치웹(`src/components/YardMap.tsx`)의 야드 지도를 **추정이 아니라 원본 좌표로** 다시 만들기
위한 스킬이다. 스크린샷을 보고 트레이싱하면 구역 위치·A/B 방향 같은 걸 지어내게 되고,
실제로 그렇게 해서 1BERTH·플로팅·안벽 A/B 를 전부 틀렸다. 그래서 화면을 보는 대신 DOM 을 읽는다.

같은 좌표계를 알아야 나중에 **배 위치 자동 가져오기**도 붙일 수 있다. 이 스킬은 그 선행 작업이다.

## 전제

- 사용자 컴퓨터에서 실행한다. 클라우드 세션에서는 세이프티원에 접속이 안 된다.
- 브라우저 조작은 `mcp__claude-in-chrome__*` 도구로 한다.
- 사용자가 이미 세이프티원에 로그인해 둔 상태를 전제한다. 로그인이 필요하면
  `safety-check-kim-eunho` 스킬의 로그인 절차를 그대로 쓴다.

## 절차

### 1. 3중점검 지도 화면을 연다

사용자에게 **3중점검 지도가 보이는 화면**을 띄워 달라고 한다. 주소를 추측해서 넣지 않는다 —
세이프티원 메뉴에서 직접 들어가는 게 확실하다. 지도에 구역 이름(`1안벽`, `2도크`, `대조립공장`
등)이 실제로 보이는 상태여야 한다.

`mcp__claude-in-chrome__computer(action=screenshot)` 으로 지도가 보이는지 눈으로 확인한다.

### 2. 추출 스니펫을 실행한다

`javascript_tool` 로 아래를 그대로 실행한다. 결과 JSON 을 **다운로드 파일로** 떨군다 —
도구 반환값은 잘릴 수 있어서 콘솔로 받으면 안 된다.

```js
(() => {
  const R = el => { const r = el.getBoundingClientRect(); return {
    x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = { url: location.href, at: new Date().toISOString(),
                viewport: { w: innerWidth, h: innerHeight } };

  // (a) 지도가 SVG 면 통째로 가져간다 — 이게 제일 좋은 경우다
  const big = [...document.querySelectorAll('svg')]
    .map(s => ({ s, r: R(s) }))
    .filter(o => o.r.w > 300 && o.r.h > 200)
    .sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h)[0];
  if (big) {
    out.kind = 'svg';
    out.rect = big.r;
    out.viewBox = big.s.getAttribute('viewBox');
    out.svg = big.s.outerHTML;
  } else {
    // (b) div 로 그린 지도면 컨테이너 기준 상대좌표 + 텍스트를 전부 훑는다
    const texts = [...document.querySelectorAll('body *')].filter(el => {
      const t = (el.textContent || '').trim();
      return t && t.length <= 24 && el.children.length === 0;
    });
    // 라벨이 가장 많이 들어있는 조상을 지도 컨테이너로 본다
    const score = new Map();
    for (const t of texts) for (let p = t.parentElement; p; p = p.parentElement)
      score.set(p, (score.get(p) || 0) + 1);
    const box = [...score.entries()]
      .filter(([el]) => { const r = R(el); return r.w > 400 && r.h > 250; })
      .sort((a, b) => b[1] - a[1])[0]?.[0] || document.body;
    const B = R(box);
    out.kind = 'dom';
    out.rect = B;
    out.nodes = [...box.querySelectorAll('*')].map(el => {
      const r = R(el), cs = getComputedStyle(el);
      const t = el.children.length === 0 ? (el.textContent || '').trim() : '';
      if (r.w < 3 || r.h < 3) return null;
      if (!t && cs.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          cs.backgroundImage === 'none' && cs.borderStyle === 'none') return null;
      return { x: r.x - B.x, y: r.y - B.y, w: r.w, h: r.h, t: t || undefined,
               bg: cs.backgroundColor, bi: cs.backgroundImage.slice(0, 200),
               bd: cs.border, tf: cs.transform === 'none' ? undefined : cs.transform };
    }).filter(Boolean);
    out.images = [...box.querySelectorAll('img')].map(i => ({ src: i.src, ...R(i) }));
  }

  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'yard-map-raw.json';
  document.body.appendChild(a); a.click(); a.remove();
  return { kind: out.kind, rect: out.rect, viewBox: out.viewBox,
           count: out.nodes ? out.nodes.length : (out.svg || '').length,
           saved: 'yard-map-raw.json' };
})()
```

반환값에서 확인할 것:

- `kind: 'svg'` → 최상. `viewBox` 가 곧 원본 좌표계다.
- `kind: 'dom'` → `count` 가 수십~수백이면 정상. 한 자리면 컨테이너를 잘못 잡은 것이니
  `rect` 가 지도 크기와 맞는지 보고, 아니면 사용자에게 지도 영역을 클릭해 달라고 한 뒤
  `document.activeElement` 기준으로 다시 잡는다.

### 3. 파일을 저장소로 옮긴다

다운로드 폴더의 `yard-map-raw.json` 을 저장소의 `docs/reference/` 로 옮긴다.

```
mv ~/Downloads/yard-map-raw.json docs/reference/yard-map-raw.json
```

### 4. 지도를 다시 만든다

`docs/reference/yard-map-raw.json` 을 읽어 `src/components/YardMap.tsx` 를 다시 만든다.
이때 지키는 것:

- **JSON 에 없는 구역·라벨은 만들어내지 않는다.** 이 스킬이 존재하는 이유가 그거다.
- `YARD_W` / `YARD_H` 는 JSON 의 `viewBox`(또는 `rect`)를 그대로 쓴다. 좌표를 다시
  스케일하지 않는다 — 나중에 배 위치를 그대로 얹으려면 좌표계가 같아야 한다.
- `YARD_REGIONS`(1안벽/2안벽/1돌핀/2돌핀/1도크/2도크/플로팅/1BERTH)는 JSON 에서 그
  이름이 붙은 노드의 좌표를 쓴다. A/B 방향도 여기서 읽는다.
- 기존 좌표계와 다르면 저장된 배 좌표가 무효가 된다. 사용자에게 먼저 알린다.

## 주의

- 화면 캡처가 아니라 DOM 을 읽는 것이므로 **모니터 크기와 무관**하다. 좌표 보정 공식이 필요 없다.
- 지도가 `<canvas>` 로 그려져 있으면 이 방법이 안 통한다. 그때는 사용자에게 알리고,
  네트워크 탭에서 지도 데이터를 받아오는 요청(`.json` / `.svg`)을 찾는 쪽으로 바꾼다.
