# 데이터 복구 절차

> 사고가 난 뒤에 처음 읽지 말 것. 지금 한 번 읽어두고, 여유 있을 때 **경로 A를 한 번 연습**해 볼 것.

대상 데이터베이스:

```
프로젝트 : lng-works-482811
DB 이름  : ai-studio-97629fe0-e947-4fc7-bc06-3c86d8a43060
```

아래 명령은 전부 [Cloud Shell](https://shell.cloud.google.com/?project=lng-works-482811)에서 실행한다.

```bash
export PROJECT_ID=lng-works-482811
export DB=ai-studio-97629fe0-e947-4fc7-bc06-3c86d8a43060
export BUCKET=gs://lng-works-482811-firestore-backup
```

---

## 경로 A — 배가 지워졌거나 값이 망가졌을 때 (거의 모든 경우)

**최근 7일 안이면 이걸 쓴다.** 앱 설정을 건드리지 않고, 재배포도 필요 없다.

PITR로 "망가지기 직전 시점"의 데이터를 꺼내서 그대로 다시 넣는 방식이다.

```bash
# 1) 되돌리고 싶은 시점을 정한다. 분 단위, UTC, RFC3339.
#    한국시간 기준이면 9시간을 뺀다. 예: KST 14:30 → UTC 05:30
export WHEN=2026-08-28T05:30:00.00Z

# 2) 그 시점의 데이터를 내보낸다
gcloud firestore export "${BUCKET}/pitr-${WHEN}" \
  --database="$DB" --project="$PROJECT_ID" --snapshot-time="$WHEN"

# 3) 현재 DB에 다시 넣는다 (같은 문서 ID를 덮어쓴다)
gcloud firestore import "${BUCKET}/pitr-${WHEN}" \
  --database="$DB" --project="$PROJECT_ID"
```

**동작 방식과 한계:**

- 지워진 문서는 **되살아난다.** 값이 바뀐 문서는 그 시점 값으로 **덮어쓴다.**
- 그 시점 이후에 **새로 추가된** 문서는 **지워지지 않는다.** import는 덮어쓰기이지 교체가 아니다.
  누군가 쓰레기 배 100개를 만들어 놨다면 그건 따로 지워야 한다.
- 시점은 **7일 이내 + 분 단위**여야 한다. 더 오래됐으면 경로 B로 간다.
- 되돌리려는 시점에 데이터가 없으면 내보내기 자체가 실패한다.

먼저 어디까지 거슬러 갈 수 있는지 확인하려면:

```bash
gcloud firestore databases describe --database="$DB" --project="$PROJECT_ID" \
  --format='value(earliestVersionTime)'
```

---

## 경로 B — 7일이 넘었거나 DB 전체가 망가졌을 때

예약 백업에서 복구한다. **주의: 복구는 항상 "새 데이터베이스"를 만든다.** 기존 DB 위에 덮어쓰는 게 아니다.

```bash
# 1) 쓸 수 있는 백업 목록 확인 (LOCATION은 DB 위치)
gcloud firestore backups list --location=<LOCATION> --project="$PROJECT_ID"

# 2) 새 DB로 복구
gcloud firestore databases restore \
  --source-backup=projects/$PROJECT_ID/locations/<LOCATION>/backups/<BACKUP_ID> \
  --destination-database=ship-location-restored \
  --project="$PROJECT_ID"
```

복구된 DB를 앱이 바라보게 하려면 `firebase-applet-config.json` 의 `firestoreDatabaseId` 를
새 이름으로 바꾸고 `main` 에 push 한다. **약 2분 뒤 자동 배포되고 주소는 그대로다.**

```json
"firestoreDatabaseId": "ship-location-restored"
```

> 구글 문서에 원래 이름으로 되돌리는 "in-place restore" 절차도 있는데, **원본 DB를 먼저 지운 뒤**
> 같은 이름으로 복구하는 방식이다. 지우는 순간 되돌릴 수 없으므로, 위처럼 새 이름으로 복구해서
> 앱 설정을 바꾸는 쪽이 훨씬 안전하다. 이름은 나중에 정리해도 된다.

---

## 즉시 백업 파일에서 복구

`scripts/setup-firestore-backup.sh` 를 실행할 때마다 만들어지는 수동 내보내기도 같은 방식으로 넣는다.

```bash
gcloud storage ls "${BUCKET}/"          # manual-2026....  형태
gcloud firestore import "${BUCKET}/manual-<STAMP>" \
  --database="$DB" --project="$PROJECT_ID"
```

---

## 삭제 방지

이 DB는 삭제 방지가 켜져 있다. 실수로도 지워지지 않는다.

```bash
gcloud firestore databases describe --database="$DB" --project="$PROJECT_ID" \
  --format='value(deleteProtectionState)'
```

경로 B의 구글식 in-place 복구처럼 **정말로 원본을 지워야 하는 경우에만** 먼저 끈다.
끄기 전에 백업이 실제로 존재하는지 반드시 확인할 것.

```bash
gcloud firestore databases update --database="$DB" --no-delete-protection --project="$PROJECT_ID"
```

---

## 현재 백업 상태 확인

```bash
gcloud firestore backups schedules list --database="$DB" --project="$PROJECT_ID"
gcloud firestore backups list --location=<LOCATION> --project="$PROJECT_ID"
gcloud storage ls "${BUCKET}/"
gcloud firestore databases describe --database="$DB" --project="$PROJECT_ID" \
  --format='value(pointInTimeRecoveryEnablement,earliestVersionTime)'
```

---

## 왜 이게 필요한가

앱의 뷰어/관리자 모드 구분은 **브라우저 안에서만** 이뤄진다. Firestore 규칙은 로그인 여부를
보지 않으므로, 주소를 아는 사람은 앱을 거치지 않고도 배·구역·이력을 지울 수 있다.
현장에서 로그인 없이 편집하는 방식을 유지하는 한 이 구멍을 완전히 막기는 어렵다.
따라서 **막는 것보다 되돌릴 수 있게 해두는 것**이 현실적인 방어선이다.
