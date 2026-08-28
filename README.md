# HD현대삼호 SHIP LOCATION

선박 건조장(Yard)의 지형도 위에 배 모양 아이콘을 배치하고 실시간으로 위치를 동기화하는 웹 애플리케이션.

React 19 + Vite 6 + Tailwind 4, 실시간 동기화는 Firebase Firestore.
Google AI Studio에서 만들어 Cloud Run에 배포했고, 지금은 소스를 이 저장소에서 관리하고 GitHub Actions로 배포한다.

---

## 🔒 URL 계약 — 가장 중요한 규칙

서비스 주소는 **바뀌면 안 된다**:

```
https://hd-ship-location-238928524992.us-west1.run.app
```

Cloud Run의 공개 URL은 `서비스명-프로젝트번호.리전.run.app` 규칙으로 결정되고,
**새 리비전을 배포해도 URL은 바뀌지 않는다.** 따라서 아래 세 값만 고정하면 주소는 영구히 유지된다.

| 항목 | 값 | 바꾸면? |
|---|---|---|
| 서비스명 | `hd-ship-location` | ❌ URL 변경 |
| 리전 | `us-west1` | ❌ URL 변경 |
| 프로젝트 | `lng-works-482811` (번호 `238928524992`) | ❌ URL 변경 |

### 하지 말아야 할 것

- ❌ **Cloud Run 서비스를 삭제하지 말 것.** 리비전 교체는 안전하지만 서비스 삭제는 위험하다.
- ❌ **Vercel / GitHub Pages 등 다른 호스팅으로 옮기지 말 것.** `run.app` 도메인은 Google 소유라
  DNS를 다른 곳으로 돌릴 방법이 없다. 주소를 지키려면 반드시 Cloud Run에 계속 배포해야 한다.
- ❌ **AI Studio에서 "Update app" 버튼을 누르지 말 것.** 이 저장소의 배포를 통째로 덮어쓴다.
  이 저장소로 옮긴 뒤에는 배포 경로를 GitHub push 하나로만 유지한다.

> 주소를 호스팅과 무관하게 만들고 싶다면 방법은 하나뿐이다 — **직접 소유한 도메인**을 사서
> Cloud Run에 매핑하는 것. 그러면 나중에 어디로 옮기든 주소를 그대로 쓸 수 있다.

---

## ⚠️ 알려진 보안 문제 — Firestore 규칙이 열려 있다

`firestore.rules`의 현재 상태:

```
match /ships/{shipId} {
  allow read: if true;
  allow create: if isValidShip(request.resource.data);   // 인증 검사 없음
  allow update: if isValidShip(request.resource.data);   // 인증 검사 없음
  allow delete: if true;                                  // 누구나 삭제 가능
}
```

파일 안에 `isAuthenticated()` 헬퍼가 정의돼 있지만 **어디에서도 쓰이지 않는다.**
즉 쓰기·삭제에 아무 제한이 없다.

앱의 관리자 모드는 제목을 5번 탭 → Google 로그인 → `localStorage.isAdmin = 'true'` 로 열리는데,
이 게이팅은 **전부 브라우저 쪽에서만** 이뤄진다. 서버(Firestore) 규칙은 로그인 여부를 보지 않는다.

결과적으로 다음이 가능하다.

1. 개발자 도구에서 `localStorage.isAdmin = 'true'` 를 넣으면 로그인 없이 관리자 UI가 열린다.
2. 앱을 거치지 않고 Firestore를 직접 호출해 배·구역·이력을 통째로 지울 수 있다.
   접속에 필요한 설정(`firebase-applet-config.json`)은 이 공개 저장소와 브라우저 번들에 모두 들어 있다.

> 참고: `firebase-applet-config.json`의 `apiKey`는 비밀값이 아니다. Firebase 웹 API 키는 공개되도록
> 설계된 식별자이고, 실제 보호는 Firestore 규칙이 담당한다. 그래서 문제는 키가 아니라 규칙이다.

**고치려면** 규칙에 인증 검사를 넣어야 한다. 다만 이건 제품 결정이 필요하다 — 예를 들어 다음처럼:

```
// 읽기는 계속 공개(비로그인 조회 허용), 쓰기·삭제만 로그인 요구
match /ships/{shipId} {
  allow read: if true;
  allow create, update: if isAuthenticated() && isValidShip(request.resource.data);
  allow delete: if isAuthenticated();
}
```

아무 Google 계정이나 로그인할 수 있으므로, 더 확실히 하려면 허용할 계정을 명시적으로 제한한다:

```
function isAdmin() {
  return request.auth != null && request.auth.token.email in [
    'someone@example.com',
  ];
}
```

⚠️ 규칙을 조이면 **로그인하지 않은 상태에서 편집하던 흐름은 끊긴다.** 현재 현장에서 어떻게 쓰고
있는지 확인한 뒤 적용할 것.

---

## 배포

```
코드 수정 → main 에 push → GitHub Actions 자동 배포 → 같은 URL에 반영
```

`.github/workflows/deploy-cloudrun.yml`이 `main` 브랜치 push마다 돈다.
수동 실행은 Actions 탭의 `Run workflow`. GCP 시크릿이 아직 없으면 배포 단계를 건너뛰고
안내만 남기므로, 설정 전에 머지해도 CI가 실패로 뜨지 않는다.

### GCP 1회 설정

```bash
export PROJECT_ID=lng-works-482811
export PROJECT_NUMBER=238928524992
export REPO=iris8ooooo/Ship-Location

gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com iamcredentials.googleapis.com \
  --project="$PROJECT_ID"

gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer" --project="$PROJECT_ID"

SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

for ROLE in roles/run.admin roles/cloudbuild.builds.editor \
            roles/artifactregistry.admin roles/storage.admin \
            roles/iam.serviceAccountUser
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA}" --role="$ROLE"
done

# Workload Identity Federation (키 파일 없이 인증)
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions" --project="$PROJECT_ID"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project="$PROJECT_ID"

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}" \
  --project="$PROJECT_ID"
```

**Settings → Secrets and variables → Actions**에 등록:

| 시크릿 | 값 |
|---|---|
| `GCP_PROJECT_ID` | `lng-works-482811` |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@lng-works-482811.iam.gserviceaccount.com` |
| `GCP_WIF_PROVIDER` | `projects/238928524992/locations/global/workloadIdentityPools/github/providers/github` |

---

## 로컬 개발

```bash
npm ci
npm run dev      # http://localhost:3000
npm run lint     # tsc --noEmit
npm run build    # dist/ 생성
```

### Gemini API 키에 대하여

`vite.config.ts`가 `process.env.GEMINI_API_KEY`를 빌드 타임에 치환하도록 돼 있지만,
이를 쓰는 `src/components/IconGenerator.tsx`는 **어디에서도 import되지 않아** 번들에서
트리셰이킹으로 제거된다. 실제로 키를 넣고 빌드해 산출물을 검사한 결과 키 문자열은
번들에 존재하지 않았다. 즉 **현재 구성에서 Gemini 키는 브라우저에 노출되지 않는다.**

단, 앞으로 `IconGenerator`를 실제 화면에 연결하면 그 순간 키가 번들에 박힌다.
그때는 키를 서버 쪽으로 옮기고 호출을 프록시해야 한다.

`generate-icons.ts`는 아이콘을 미리 만들어 두는 개발용 스크립트이므로 브라우저와 무관하다.

---

## 저장소 구조

| 경로 | 역할 |
|---|---|
| `src/App.tsx` | 앱 본체 (약 1,200줄) — 지도, 배 배치, 실시간 동기화, 이력, 조석·바람 정보 |
| `src/firebase.ts` | Firebase 초기화 (`firebase-applet-config.json` 사용) |
| `src/components/IconGenerator.tsx` | Gemini로 아이콘 생성. 현재 미사용 |
| `firestore.rules` | Firestore 보안 규칙 — 위 "알려진 보안 문제" 참고 |
| `public/map.jpg` | 건조장 지형도 (1.8MB) |
| `Dockerfile` | Vite 빌드 → nginx 정적 서빙. Cloud Run의 `$PORT`를 따른다 |
| `nginx.conf` | SPA 라우팅 폴백, 정적 자산 캐시, gzip |
| `.github/workflows/deploy-cloudrun.yml` | 같은 서비스에 새 리비전 배포 (URL 유지) |
| `*.cjs`, `naver.html`, `badatime.html` | 조석 데이터 스크래핑 실험용 잔재. 앱 빌드와 무관 |
