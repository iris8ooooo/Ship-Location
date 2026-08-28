# HD현대삼호 SHIP LOCATION

선박 건조장(Yard)의 지형도 위에 배 모양 아이콘을 배치하고 실시간으로 위치를 동기화하는 웹 애플리케이션.

원래 Google AI Studio에서 만들어 Cloud Run에 배포했고, 지금은 소스를 이 저장소에서 관리하고 GitHub Actions로 배포한다.

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
| 프로젝트 번호 | `238928524992` | ❌ URL 변경 |

### 하지 말아야 할 것

- ❌ **Cloud Run 서비스를 삭제하지 말 것.** 리비전 교체는 안전하지만 서비스 삭제는 위험하다.
- ❌ **Vercel / GitHub Pages 등 다른 호스팅으로 옮기지 말 것.** `run.app` 도메인은 Google 소유라
  DNS를 다른 곳으로 돌릴 방법이 없다. 주소를 지키려면 반드시 Cloud Run에 계속 배포해야 한다.
- ❌ **AI Studio에서 "Update app" 버튼을 누르지 말 것.** 이 저장소의 배포를 통째로 덮어쓴다.
  이 저장소로 옮긴 뒤에는 배포 경로를 GitHub push 하나로만 유지한다.

> 주소를 호스팅과 무관하게 만들고 싶다면 방법은 하나뿐이다 — **직접 소유한 도메인**을 사서
> Cloud Run에 매핑하는 것. 그러면 나중에 어디로 옮기든 주소를 그대로 쓸 수 있다.

---

## 1단계 — AI Studio에서 소스 꺼내오기

이 저장소에는 아직 **앱 소스가 없다.** AI Studio의 GitHub 내보내기가 배너 README만 만들고
소스를 올리지 않았기 때문이다. 아래 중 한 방법으로 소스를 넣어야 한다.

**방법 A — AI Studio에서 다운로드 (권장)**
1. [AI Studio](https://aistudio.google.com/apps)에서 `HD현대삼호 SHIP LOCATION` 앱을 연다.
2. 코드 다운로드(ZIP) 또는 GitHub 동기화를 실행한다.
3. 받은 파일을 이 저장소 루트에 풀고 커밋한다.

**방법 B — Cloud Run 소스 편집기**
1. [Cloud Run 콘솔](https://console.cloud.google.com/run)에서 `hd-ship-location` 서비스를 연다.
2. 소스 편집기를 열어 파일들을 복사한다. (앱이 돌아가고 있으므로 소스는 반드시 여기 있다)

넣어야 할 파일은 대략 이렇다:
`package.json`, `index.html`, `index.tsx`, `App.tsx`, `vite.config.ts`, `tsconfig.json`,
`metadata.json`, `components/`, `services/`

빌드 결과가 `dist/`로 나오면 이 저장소의 `Dockerfile`이 그대로 동작한다.
다른 경로로 나온다면 `Dockerfile`의 `COPY --from=build /app/dist` 줄만 고치면 된다.

---

## 2단계 — GCP 1회 설정

GitHub Actions가 Cloud Run에 배포할 수 있도록 권한을 연결한다. `gcloud`에서 한 번만 실행한다.

```bash
export PROJECT_ID=<프로젝트 ID>          # 번호 238928524992 에 해당하는 ID
export PROJECT_NUMBER=238928524992
export REPO=iris8ooooo/Ship-Location

# 필요한 API 활성화
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  --project="$PROJECT_ID"

# 배포용 서비스 계정
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer" --project="$PROJECT_ID"

SA="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

for ROLE in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.admin \
  roles/storage.admin \
  roles/iam.serviceAccountUser
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA}" --role="$ROLE"
done

# Workload Identity Federation (키 파일 없이 인증)
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions" --project="$PROJECT_ID"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='${REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project="$PROJECT_ID"

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}" \
  --project="$PROJECT_ID"
```

그다음 GitHub 저장소의 **Settings → Secrets and variables → Actions**에 아래 3개를 등록한다.

| 시크릿 | 값 |
|---|---|
| `GCP_PROJECT_ID` | 프로젝트 ID (번호 아님) |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |
| `GCP_WIF_PROVIDER` | `projects/238928524992/locations/global/workloadIdentityPools/github/providers/github` |

---

## 3단계 — 이후 개발 흐름

```
코드 수정 → main 에 push → GitHub Actions 자동 배포 → 같은 URL에 반영
```

`.github/workflows/deploy-cloudrun.yml`이 `main` 브랜치 push마다 돈다.
수동 실행이 필요하면 Actions 탭에서 `Run workflow`를 누르면 된다.

---

## ⚠️ Gemini API 키 주의

AI Studio 앱은 보통 Gemini API 키를 **빌드 타임에 번들에 박아 넣는다.** 그러면 공개 URL의
브라우저 소스에서 키가 그대로 보인다. 소스를 옮긴 뒤 다음을 확인할 것:

1. 앱이 브라우저에서 직접 Gemini를 호출하는가? → 키가 노출되고 있다.
2. 노출됐다면 **그 키는 폐기하고 새로 발급**한다.
3. 근본 해결은 키를 서버 쪽에 두고 호출을 프록시하는 것이다. Cloud Run에 이미 컨테이너가
   있으므로 작은 백엔드 라우트를 추가해 거기서만 키를 쓰면 된다.

---

## 이 저장소의 파일

| 파일 | 역할 |
|---|---|
| `Dockerfile` | Vite 빌드 → nginx 정적 서빙. Cloud Run의 `$PORT`를 따른다. |
| `nginx.conf` | SPA 라우팅 폴백, 정적 자산 캐시, gzip |
| `.github/workflows/deploy-cloudrun.yml` | 같은 서비스에 새 리비전 배포 (URL 유지) |
