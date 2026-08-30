/**
 * 앱 이름을 **DOM 에서 읽는다.** 상수로 또 적어 두지 않는다.
 *
 * 이름은 이미 네 곳(`<title>`·`apple-mobile-web-app-title`·manifest `name`·`short_name`)에
 * 같은 값으로 있고 `pwa-check` 가 그 넷이 어긋나면 실패시킨다. 여기에 다섯 번째 사본을
 * 만들면 이름을 바꿀 때 이것만 빠뜨린다 — 아이콘 해시를 `apple-touch-icon` href 에서
 * 읽는 것과 같은 이유다.
 */
export function appName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  return meta?.content || document.title || '';
}
