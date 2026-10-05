# Kovar 개발 통합 브랜치: dev

2026-10-05 로컬 개발 소스를 `yunjjang99/buzz`의 `dev`로 통합했다.
앞으로 Windows PC는 [Windows 빌드 안내](kovar-windows-build.md)에 따라 `dev`를 받는다.
`main`은 원본 기준으로 유지한다. 이 작업은 소스 통합이며 운영 서버 재배포가 아니다.

## 포함한 개발 내용

| 로컬 작업 | 통합 내용 |
|---|---|
| `codex/admin-mfa` (`8995bfaf5`) | 한국어 기본 UI, 웹/모바일 브라우저 클라이언트, 직원 계정, 파일 첨부, 로그인 단계별 잠금, 관리자 MFA, Mac 및 Windows 빌드 도구/문서 |
| `codex/korean-interactions` (`5f12c9d6b`) | 채팅·프로필·허들·에이전트 상호작용 추가 번역 및 테스트 |
| `codex/kovar-upstream-updates` (`c312bab4a`) | 상위 원본 호환성 검사/후보 빌드/배포 기록, 하위 프로세스 정리 및 불변 이미지 복구 기록 수정 |
| `codex/strategy-room` 작업 폴더 | 데스크톱/웹 전략실, 독립 페이지, 채팅 안 전략실, 관련 테스트 및 배포 스크립트 |
| `codex/mail-sync` 작업 폴더 | `integrations/mail-sync/`의 메일 수집 소스, Docker 구성, 안내 및 테스트 |
| `codex/login-security`, `codex/web-file-attachments` 작업 폴더 | MFA 기준에 이미 들어 있는 최신 로그인 잠금/첨부 기능임을 대조 확인 |

`codex/korean-desktop-and-web`와 나머지 등록 작업 폴더도 비교했다. 기본 한국어/웹
커밋들은 MFA 브랜치의 조상이다. 기존 원본/분리 작업 폴더의 미커밋 변경은 삭제하거나
재설정하지 않았고 필요한 소스만 통합 작업 폴더로 가져왔다. 메일 소스는 원본 작업
폴더와 바이트 단위로 일치한다. 번역 manifest와 테스트 목록은 양쪽 항목을 합쳤다.

## 통합 조정

- 웹 전략실을 채팅 production bundle에 포함하고 별도 페이지도 빌드한다.
  `buzz-strategy-bundled` 메타 표시가 있는 버전에는 예전 독립 전략실 스크립트를
  다시 주입하지 않는다. 구버전 채팅 배포에서는 기존 bootstrap 보존을 유지한다.
- 최신 번들형 전략실은 전체 `deploy-home.py` 경로로 배포한다. 독립
  `deploy-strategy.py`는 번들형 채팅에 중복 주입하려 하면 중단한다.
- 실제 relay 검증 시 합성 관리자도 MFA를 등록해야 관리 API를 사용할 수 있도록
  테스트 준비 절차를 갱신했다. MFA 등록 전 관리 API 401도 확인한다.
- Windows 안내의 clone/갱신 대상은 `dev`로 바꾸고 Kovar CI push 대상에도 추가했다.

## 검증 범위

- 한국어 overlay 및 변환 TypeScript, 웹 TypeScript 통과.
- 데스크톱 mock UI 15개 통과 (추가 번역·계정·전략실 포함).
- Chromium/모바일 WebKit 웹 테스트 36개 재실행 통과. 최초 실행에서는 Chromium
  백업 로그인/첨부 1개가 화면 대기에서 실패했고 나머지 35개는 통과했다.
  해당 실패의 원인을 확정하지 않았으므로 간헐 실패 가능성을 남긴다.
- 인증/MFA·앱 식별자·업데이트 도구 단위 테스트 30개, 메일 연동 테스트 23개 통과.
- 웹 및 로그인 서비스 production build, 배포 entry 구버전/통합버전 분기 확인.
- Windows 실제 설치/실행 및 인간 앱 검증, 전체 `just ci`는 이 통합에서 수행하지 않았다.
  원격 CI와 로컬 검증은 구분한다. 기존 MFA 브랜치의 CI 실패 원인 중 relay MFA
  준비 절차는 수정했고 하위 프로세스 정리 수정은 업데이트 브랜치에서 병합했다.

## 포함하지 않는 파일

운영 `.env`, 계정/메일 비밀번호, 개인키, `master.key`, SQLite/계정 DB, 원본 메일,
`node_modules`, 빌드 캐시, 설치 ZIP/EXE, 스크린샷은 소스 브랜치에 넣지 않는다.
빌드 파일은 [배포판 모으기 안내](kovar-windows-build.md#5-macwindows-배포판을-한-폴더에-모으기)에 따라 보관한다.
