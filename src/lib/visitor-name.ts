/**
 * 이 기기를 쓰는 **사람의 이름** — 한 칸에만 둔다.
 *
 * ★2026-09-05 여기서 틀렸다. 접속 집계를 붙이면서 `visitorName` 이라는 **두 번째 칸**을
 *  만들었다. 그런데 이 앱에는 이미 `adminName` 이 있었다 — 관리자로 전환할 때 「작업
 *  이력에 남길 성함」으로 받아 두는 값이고, 이력의 `author` 로 쓰인다.
 *  그래서 **이미 이름을 등록한 사람에게 또 물었다.** 사용자가 바로 지적했다.
 *  (아이콘 해시·앱 이름에서 배운 것과 같은 규칙이다: **사본을 만들면 반드시 갈라진다.**)
 *
 * ★그래서 읽고 쓰는 칸은 `adminName` **하나**다. 집계용 이름과 이력용 이름은
 *  애초에 같은 사람의 같은 이름이라 나눌 이유가 없었다.
 *
 * ★**빈 이름으로 덮어쓰지 않는다.** 그러면 관리자 이름이 날아가 다음 이력이 이름 없이 남는다.
 *  (닫는 버튼「나중에」를 뺀 지금 빈 값으로 부르는 곳은 없지만, 가드는 남겨 둔다 —
 *   다시 닫는 버튼을 붙이는 날 이 함정을 또 밟게 된다.)
 *  「물어는 봤다」는 이름과 **별도 표시**로 남긴다.
 */

/** 이름 길이 상한. **파이어스토어 규칙에도 같은 값이 박혀 있다** — 넘기면 쓰기가 거부된다. */
export const NAME_MAX = 20;

const NAME_KEY = 'adminName';         // ★한 사람의 이름은 여기 하나
const OLD_KEY = 'visitorName';        // 2026-09-05 하루 동안만 쓰던 둘째 칸 (읽기만 — 이사용)
/**
 * 물어봤다는 표시 (이름 자체와 따로 둔다).
 *
 * ★★**한 번 올렸다**(`visitorAsked` → `visitorAsked2`, 2026-09-05).
 *  17:49~19:40 사이의 카드에는 **「나중에」 버튼**이 있었고 그것은 `setVisitorName('')` 을
 *  불렀다 — 이름 없이 「물어봤다」만 찍힌다. 그 뒤 사용자가 그 버튼을 **없애서**
 *  (「이름을 적어야 사라진다」) 그 사이에 누른 기기는 **다시는 묻지 않는 상태로 굳었다.**
 *  없어진 버튼 때문에 영영 「이름 미등록」으로 남는 것은 사용자가 정한 뜻과 반대다.
 * ★올려도 **이름을 적은 사람은 다시 안 묻는다** — `nameAsked()` 가 이름부터 보기 때문이다.
 *  즉 다시 묻는 대상은 정확히 「물어봤는데 이름이 없는」 기기, 곧 그 버튼을 누른 기기뿐이다.
 * ★트레이드오프: 「기기당 딱 한 번만 묻는다」를 그 기기들에 한해 두 번으로 만든다.
 *  다음에 또 올리지 말 것 — 이건 없어진 버튼을 되돌리는 일회성이다.
 */
const ASKED_KEY = 'visitorAsked2';

/** 저장소가 막힌 브라우저(사파리 비공개)에서도 앱은 그대로 돈다. */
function get(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

/** 이 기기 주인의 이름. 없으면 빈 문자열. */
export function getVisitorName(): string {
  return (get(NAME_KEY) || get(OLD_KEY) || '').trim().slice(0, NAME_MAX);
}

/** 이름을 저장한다. ★빈 값은 **쓰지 않는다** — 관리자 이름을 지우게 된다. */
export function setVisitorName(name: string): void {
  const nm = name.trim().slice(0, NAME_MAX);
  try {
    if (nm) localStorage.setItem(NAME_KEY, nm);
    localStorage.setItem(ASKED_KEY, '1');
  } catch { /* 저장 못 해도 앱은 돈다 */ }
}

/** 저장소를 쓸 수 있는가. 사파리 비공개 모드는 읽기부터 예외를 던진다. */
function storageOk(): boolean {
  try { localStorage.getItem(ASKED_KEY); return true; } catch { return false; }
}

/**
 * 이름을 물어볼 필요가 없는가.
 * ★**이미 등록한 사람에게 다시 묻지 않는다** — 관리자로 전환하며 적은 이름도 이름이다.
 * ★저장소가 막혔으면 **묻지 않는다.** 답을 적어도 남길 곳이 없어 열 때마다 다시 묻게 되는데,
 *  그건 안내가 아니라 고장이다. (회귀 테스트가 실제로 이걸 잡았다 — `test-visitor-name.mjs` ⑥)
 */
export function nameAsked(): boolean {
  if (!storageOk()) return true;
  if (getVisitorName()) return true;
  // ★`OLD_KEY` 는 여기서 **안 본다.** 그 칸이 빈 값으로 남아 있다는 것은 옛 「나중에」를
  //  눌렀다는 뜻이라(이름을 적었으면 위 `getVisitorName()` 에서 이미 걸린다), 그걸
  //  「물어봤다」로 치면 그 기기는 영영 안 묻게 된다 — 위 ASKED_KEY 주석과 같은 이유다.
  return get(ASKED_KEY) !== null;
}
