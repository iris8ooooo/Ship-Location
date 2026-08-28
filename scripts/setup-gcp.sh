#!/usr/bin/env bash
#
# GitHub Actions가 Cloud Run에 배포할 수 있도록 GCP를 1회 설정한다.
#
# 실행 방법 (제일 쉬운 경로 — 로컬에 gcloud 설치 불필요):
#   1. https://console.cloud.google.com 접속
#   2. 우측 상단 터미널 아이콘으로 Cloud Shell 열기
#   3. 아래 실행
#        git clone https://github.com/iris8ooooo/Ship-Location.git
#        cd Ship-Location
#        bash scripts/setup-gcp.sh
#
# 여러 번 실행해도 안전하다(이미 있는 리소스는 건너뛴다).
# 끝나면 GitHub에 등록할 시크릿 3개를 출력한다.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lng-works-482811}"
PROJECT_NUMBER="${PROJECT_NUMBER:-238928524992}"
REPO="${REPO:-iris8ooooo/Ship-Location}"
SERVICE="${SERVICE:-hd-ship-location}"
REGION="${REGION:-us-west1}"
POOL="github"
PROVIDER="github"
SA_NAME="github-deployer"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# ── 0. 사전 확인 ─────────────────────────────────────────────────────────
say "0. 대상 확인 — 여기서 틀리면 URL이 바뀐다"
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1

CURRENT_URL="$(gcloud run services describe "$SERVICE" \
  --region "$REGION" --project "$PROJECT_ID" \
  --format='value(status.url)' 2>/dev/null || true)"

if [ -z "$CURRENT_URL" ]; then
  warn "서비스 '$SERVICE'를 $REGION / $PROJECT_ID 에서 찾지 못했다."
  warn "이 상태로 배포하면 새 서비스가 만들어져 URL이 달라진다. 중단한다."
  warn "아래로 실제 위치를 확인한 뒤 PROJECT_ID/REGION/SERVICE 를 맞춰 다시 실행할 것:"
  warn "  gcloud run services list --project $PROJECT_ID"
  exit 1
fi
ok "서비스 확인: $SERVICE ($REGION)"
ok "현재 URL   : $CURRENT_URL"
echo "$CURRENT_URL" | grep -q "^https://${SERVICE}-${PROJECT_NUMBER}\.${REGION}\.run\.app$" \
  && ok "URL이 예상 형식과 일치 — 리비전 배포로 주소가 유지된다" \
  || warn "URL 형식이 예상과 다르다: $CURRENT_URL (계속 진행하되 첫 배포 후 주소를 반드시 확인할 것)"

# ── 1. API ──────────────────────────────────────────────────────────────
say "1. 필요한 API 활성화"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT_ID"
ok "완료"

# ── 2. 배포용 서비스 계정 ────────────────────────────────────────────────
say "2. 배포용 서비스 계정"
if gcloud iam service-accounts describe "$SA" --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "이미 존재: $SA"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions deployer" --project="$PROJECT_ID"
  ok "생성: $SA"
fi

say "3. 권한 부여"
for ROLE in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.admin \
  roles/storage.admin \
  roles/logging.viewer \
  roles/iam.serviceAccountUser
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA}" --role="$ROLE" \
    --condition=None --quiet >/dev/null
  ok "$ROLE"
done

# Cloud Build가 소스 빌드에 쓰는 기본 서비스 계정에도 권한이 필요하다.
say "4. Cloud Build 기본 서비스 계정 권한"
CB_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
if gcloud iam service-accounts describe "$CB_SA" --project="$PROJECT_ID" >/dev/null 2>&1; then
  for ROLE in roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${CB_SA}" --role="$ROLE" \
      --condition=None --quiet >/dev/null
    ok "$CB_SA → $ROLE"
  done
else
  warn "$CB_SA 없음 — 배포가 권한 오류로 실패하면 이 부분을 다시 확인할 것"
fi

# ── 5. Workload Identity Federation ─────────────────────────────────────
say "5. Workload Identity Federation (키 파일 없이 인증)"
if gcloud iam workload-identity-pools describe "$POOL" \
     --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "풀 이미 존재: $POOL"
else
  gcloud iam workload-identity-pools create "$POOL" \
    --location=global --display-name="GitHub Actions" --project="$PROJECT_ID"
  ok "풀 생성: $POOL"
fi

if gcloud iam workload-identity-pools providers describe "$PROVIDER" \
     --location=global --workload-identity-pool="$POOL" \
     --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "제공자 이미 존재: $PROVIDER"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --display-name="GitHub" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${REPO}'" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --project="$PROJECT_ID"
  ok "제공자 생성: $PROVIDER (저장소 ${REPO} 로만 제한)"
fi

say "6. 저장소가 서비스 계정을 쓸 수 있도록 연결"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --project="$PROJECT_ID" --quiet >/dev/null
ok "완료"

# ── 결과 ────────────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────
 설정 완료. 아래 3개를 GitHub에 등록하면 끝이다.

 https://github.com/${REPO}/settings/secrets/actions
 → New repository secret 로 하나씩 추가

   GCP_PROJECT_ID
   ${PROJECT_ID}

   GCP_SERVICE_ACCOUNT
   ${SA}

   GCP_WIF_PROVIDER
   projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}

 등록 후 Actions 탭에서 "Deploy to Cloud Run" → Run workflow 로 첫 배포.
 배포 후에도 주소는 그대로여야 한다:
   ${CURRENT_URL}
────────────────────────────────────────────────────────────────────
EOF
