# 서버 연동 설계 초안 (향후 단계)

현재 전자야장은 모든 자료를 **조사자 기기 안(IndexedDB)** 에만 저장합니다. 다만 기록 구조와 내보내기 형식은 서버 이전을 전제로 설계되어 있어, 서버가 준비되면 앱의 `SYNC.push()`만 구현하면 됩니다. 이 문서는 그 서버의 최소 요건을 정리한 것입니다.

## 1. 구성
```
[조사자 PWA] ──HTTPS──▶ [API 서버] ──▶ [DB]
   │  기기 저장(오프라인)      │ 인증·권한       ├─ 레지스트리(버전별)
   │  표준 데이터 패키지 전송  │ 검증(레지스트리) ├─ 조사자·기관
   └  registry.json 수신      │ 감사로그         ├─ 기록(표준값) / 첨부
                              └ 관리자 열람 화면 └─ 감사로그
```

## 2. 역할
| 역할 | 권한 |
|---|---|
| 조사자 | 본인 기록 업로드·수정, 레지스트리 조회, 개정 제안 |
| 관리자 | 전체 조사자 기록 열람·검색·내보내기, 레지스트리 새 버전 발행, 개정 제안 처리 |
| 열람자(선택) | 좌표를 일반화한 집계 자료만 조회 |

## 3. 앱이 이미 갖춘 서버 연동 요소
| 요소 | 앱 내 위치 | 서버에서의 용도 |
|---|---|---|
| 기록 ID (`id`) | 기기 생성 고유값 | 업서트(upsert) 키 |
| 수정 차수 (`rev`) | 저장마다 +1 | 충돌 판단 (서버 rev보다 작으면 거절) |
| 작성 기기 (`deviceId`) | 기기별 무작위 ID | 출처 추적 |
| 조사자 ID (`owner.surveyorId`) | 설정 › 조사자 ID | 서버 계정과 연결 |
| 동기화 상태 (`sync.status`) | local / modified / synced | 전송 대상 선별 |
| 표준값 (`std`) | 레지스트리 요소ID → 코드값 | DB 저장 형식 |
| 검증 결과 (`qc`) | 저장 시 레지스트리 규칙 검증 | 품질 관리·실증 지표 |
| 적용 레지스트리 버전 (`rv`) | 저장 시점 버전 | 버전별 해석 |

## 4. API (안)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/registry/latest` | 최신 레지스트리 JSON (앱의 `registry.json`과 동일 형식) |
| GET | `/api/registry/{version}` | 특정 버전 |
| POST | `/api/registry` | (관리자) 새 버전 발행 — semver 증가, changeLog 필수 |
| POST | `/api/registry/proposals` | 개정 제안 제출 (앱의 개정 제안 CSV 항목과 동일) |
| POST | `/api/records:batch` | 표준 데이터 패키지(`ES-DataPackage`) 업로드. 기록별 `{id, rev}`로 업서트, 결과로 `serverId`, 수용/거절 사유 반환 |
| GET | `/api/records` | (관리자) 조사자·분류군·기간·종·지역 필터 조회 |
| GET | `/api/records/{id}` | 기록 1건 + 수정 이력 |
| POST | `/api/records/{id}/attachments` | 사진·약도 업로드 (패키지와 분리) |
| GET | `/api/audit` | (관리자) 접속·저장·수정·내보내기 로그 |

업로드 응답을 받으면 앱은 해당 기록의 `sync = { status: 'synced', serverId, lastSyncedAt }`로 갱신합니다.

## 5. DB 테이블 (안)
- `registry_versions` (registry_id, version, status, issued, json)
- `data_elements` (element_id, version, name_ko, data_type, unit, min, max, code_list, …) — 레지스트리 JSON을 정규화
- `code_lists`, `codes` (list_id, code, label_ko, parent, status, version)
- `surveyors` (surveyor_id, name, org, role)
- `records` (id, taxon, surveyor_id, device_id, registry_version, rev, created_at, updated_at, qc_errors, qc_warns, std_json)
- `record_values` (record_id, element_id, value_code, value_num, value_text) — 통계·검색용 펼침 테이블
- `attachments` (record_id, kind, hash, path)
- `audit_log` (at, actor, action, record_id, detail, prev_hash, hash)

## 6. 보안
- 출현좌표(`sensitivity: restricted` 요소)는 열람 권한별로 원좌표 / 일반화 좌표(예: 10 km 격자)를 구분해 제공
- 전송은 HTTPS만, 토큰 기반 인증, 관리자 열람은 감사로그에 기록
- 레지스트리의 `sensitivity` 값을 서버 권한 규칙의 기준으로 사용
