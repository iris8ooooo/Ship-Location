#!/usr/bin/env bash
#
# Firestore 백업 설정. 현재 이 프로젝트에는 백업이 하나도 없다.
#
# 실행 방법 (Cloud Shell):
#   https://shell.cloud.google.com/?project=lng-works-482811
#   git clone https://github.com/iris8ooooo/Ship-Location.git
#   cd Ship-Location
#   bash scripts/setup-firestore-backup.sh
#
# 이 스크립트가 만드는 것:
#   1) 즉시 1회 내보내기  — 지금 당장 손에 쥐는 백업 (예약만으로는 오늘 밤까지 무방비)
#   2) PITR              — 최근 7일 안의 "아무 시점"으로 복구 (분 단위)
#   3) 일간 백업 (7일 보관)
#   4) 주간 백업 (14주 보관)
#
# 읽기 전용 조회 외에는 기존 데이터를 건드리지 않는다.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lng-works-482811}"
DB="${DB:-ai-studio-97629fe0-e947-4fc7-bc06-3c86d8a43060}"
BUCKET="${BUCKET:-gs://${PROJECT_ID}-firestore-backup}"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

gcloud config set project "$PROJECT_ID" >/dev/null 2>&1

# ── 0. 대상 확인 ─────────────────────────────────────────────────────────
say "0. 대상 데이터베이스 확인"
LOCATION="$(gcloud firestore databases describe --database="$DB" \
  --project="$PROJECT_ID" --format='value(locationId)' 2>/dev/null || true)"

if [ -z "$LOCATION" ]; then
  warn "데이터베이스 '$DB' 를 찾지 못했다. 아래로 실제 이름을 확인할 것:"
  warn "  gcloud firestore databases list --project $PROJECT_ID"
  exit 1
fi
ok "데이터베이스: $DB"
ok "위치        : $LOCATION"

say "1. 필요한 API 활성화"
gcloud services enable firestore.googleapis.com storage.googleapis.com \
  --project="$PROJECT_ID" >/dev/null
ok "완료"

# ── 2. 즉시 1회 내보내기 ─────────────────────────────────────────────────
say "2. 즉시 백업 (지금 당장 쓸 수 있는 사본)"
if gcloud storage buckets describe "$BUCKET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "버킷 이미 존재: $BUCKET"
else
  gcloud storage buckets create "$BUCKET" \
    --project="$PROJECT_ID" --location="$LOCATION" --uniform-bucket-level-access
  ok "버킷 생성: $BUCKET (위치 $LOCATION — DB와 동일해야 내보내기가 된다)"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
say "   내보내는 중... (수십 초 걸릴 수 있다)"
gcloud firestore export "${BUCKET}/manual-${STAMP}" \
  --database="$DB" --project="$PROJECT_ID"
ok "완료: ${BUCKET}/manual-${STAMP}"

# ── 3. PITR ─────────────────────────────────────────────────────────────
say "3. PITR (최근 7일 내 아무 시점으로 복구)"
PITR="$(gcloud firestore databases describe --database="$DB" \
  --project="$PROJECT_ID" --format='value(pointInTimeRecoveryEnablement)' 2>/dev/null || true)"
if printf '%s' "$PITR" | grep -qi 'ENABLED'; then
  ok "이미 켜져 있음"
else
  gcloud firestore databases update --database="$DB" \
    --enable-pitr --project="$PROJECT_ID"
  ok "활성화됨 — 이제부터 7일치가 분 단위로 쌓인다"
fi

# ── 4. 예약 백업 ─────────────────────────────────────────────────────────
say "4. 예약 백업"
EXISTING="$(gcloud firestore backups schedules list --database="$DB" \
  --project="$PROJECT_ID" --format='value(recurrence)' 2>/dev/null || true)"

if printf '%s' "$EXISTING" | grep -qi 'DAILY'; then
  ok "일간 예약 이미 존재"
else
  gcloud firestore backups schedules create --database="$DB" \
    --recurrence=daily --retention=7d --project="$PROJECT_ID"
  ok "일간 생성 (7일 보관)"
fi

if printf '%s' "$EXISTING" | grep -qi 'WEEKLY'; then
  ok "주간 예약 이미 존재"
else
  gcloud firestore backups schedules create --database="$DB" \
    --recurrence=weekly --retention=14w --project="$PROJECT_ID"
  ok "주간 생성 (14주 보관)"
fi

# ── 결과 ────────────────────────────────────────────────────────────────
cat <<EOF

────────────────────────────────────────────────────────────────────
 백업 설정 완료.

 지금 손에 있는 것:
   즉시 백업   ${BUCKET}/manual-${STAMP}
   PITR        최근 7일, 분 단위
   일간 백업   7일 보관   (내일부터 쌓임)
   주간 백업   14주 보관  (다음 주부터 쌓임)

 확인 명령:
   gcloud firestore backups list --location=${LOCATION} --project=${PROJECT_ID}
   gcloud firestore backups schedules list --database=${DB} --project=${PROJECT_ID}

 ⚠️ 복구 방법은 저장소의 docs/RESTORE.md 를 볼 것.
    복구는 "새 데이터베이스"를 만드는 방식이라 앱 설정을 바꿔야 한다.
    사고가 난 뒤에 처음 읽지 말고 지금 한 번 읽어둘 것.
────────────────────────────────────────────────────────────────────
EOF
