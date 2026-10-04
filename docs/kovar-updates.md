# Kovar Buzz 원본 업데이트 운영

이 문서의 순서는 **검사 → 별도 작업 공간에서 통합 → 검증 → Kovar 빌드 → 사람이
검토한 배포 → 복구**다. 검사·CI·빌드는 운영 서버와 설치된 앱을 변경하지 않는다.
자동 일정, 자동 병합, 원격 push, GitHub Release 공개, 운영 배포는 연결하지 않았다.
소규모 운영자가 버전마다 수동으로 실행하는 구조다.

## 현재 기준과 제품 계약

적용 기준은 `desktop/korean/update/state.json`에 있다. 최초 기준은
`e982f70fba29cdaa9a8378f118a0e498537bd8db`(2026-10-04 KST의 main snapshot)이며
공식 태그는 없다. 패키지 버전 `0.5.26`을 `desktop-v0.5.26` 출시 소스라는 뜻으로
해석하면 안 된다. 공식 태그에는 별도 배포 커밋이 있을 수 있다. 검사 보고서는
정확한 태그 SHA, 기준 SHA, 공통 조상, 두 소스 사이의 변경 파일을 따로 기록한다.

공식 Desktop 릴리스는 `block/buzz`의 공개된 stable GitHub Release 중
`desktop-v숫자.숫자.숫자` 태그만 선택한다. draft, prerelease, 모바일·서버 릴리스는
제외한다. 최신 선택 기준은 공개 시각이고, 특정 태그도 지정할 수 있다. 일반
`releases/latest`나 버전 크기·커밋 개수로 업그레이드를 승인하지 않는다.

원본의 한 도메인·동일 Nostr 계정·릴레이 권한 모델을 유지한다. Kovar 로그인
서비스의 서버 측 키 보관은 원본의 사용자 직접 키 소유와 **의도적으로 다른
운영 선택**이다. 이번 체계가 그 계약을 확대하거나 Rust 서버·DB 스키마를
변경하지는 않는다. Flutter 네이티브에는 직원 계정 기능이 없다.

## 준비

Node/pnpm/Rust는 저장소의 Hermit 버전을 사용한다. GitHub 검사에는 Git과
`gh` 인증이 필요하다. 브라우저 검증에는 Chromium·WebKit, 실제 서버 검증에는
**로컬 Docker Unix 소켓**이 필요하다. Windows는 Git Bash에서 설치·빌드하고
실제 릴레이 검증 보고서는 동일 커밋의 Linux/Mac 실행에서 가져온다.

```bash
. ./bin/activate-hermit
pnpm install --frozen-lockfile
pnpm -C desktop exec playwright install chromium webkit
# Linux에서 브라우저 시스템 라이브러리도 필요하면 --with-deps를 추가한다.
git status --short
git rev-parse HEAD
git remote -v
```

수정 사항은 검토 후 `git commit -s`로 저장한다. 도구는 미커밋 변경을 stash/reset
하지 않는다. 검사·통합·후보 빌드는 깨끗한 커밋을 요구한다. 검증 명령은 개발 중에도
실행할 수 있지만 dirty 결과를 빌드 근거로 받지 않는다. 모든 `--output`은 **아직
없는 디렉터리**여야 한다. 저장소 밖의 `/tmp` 또는 별도 기록 폴더를 사용한다.
동일 checkout에서 빌드/화면 검증 두 개를 동시에 실행하지 않는다.

## 1. 원본 확인과 읽기 쉬운 보고서

저장소 루트에서:

```bash
node desktop/korean/update/upstream.mjs --mode release --output /tmp/kovar-release-check
cat /tmp/kovar-release-check/upstream.md
```

특정 태그, main 사전 검사, 현재 기준 정상 적용 검사는 각각 다음과 같다.

```bash
node desktop/korean/update/upstream.mjs --mode release --tag desktop-v0.5.26 --output /tmp/kovar-tag-check
node desktop/korean/update/upstream.mjs --mode main --output /tmp/kovar-main-check
node desktop/korean/update/upstream.mjs --mode baseline --output /tmp/kovar-baseline-check
```

`main`과 `baseline`은 정식 릴리스가 아니라는 표시가 JSON/Markdown에 남는다.
도구는 임시 clone에 공식 원본만 fetch하며 현재 checkout의 branch/tag/remote는
바꾸지 않는다. Kovar 추가 파일 및 `desktop/korean/` 경로를 원본이 사용하기
시작하면 Git이 병합 가능하더라도 실패한다. 이어 임시 병합, 원본 대상의 79개
현재 적용점, 병합 결과의 적용점을 검사한다. 충돌 또는 모호한 문맥은 해당
파일·행·오류와 함께 exit 1로 중단한다. 보고서는 실패해도 보존한다.

보고서의 `gitMerge`, `targetOverlay`, `integratedOverlay`, `build`, `features`,
`realRelay`, 각 native 항목은 독립 결과다. 실행하지 않은 것은 `not-run`이며
검사 통과만으로 `eligibleForRelease`가 true가 되지 않는다. `changedFiles`는
기준 소스와 대상 소스의 양방향 차이이므로 과거 릴리스 분기의 삭제도 보인다.
`migrations`가 비어 있어도 DB 호환성이 자동 승인되지는 않는다.

최신 정식 릴리스가 적용 불가하면 운영 버전을 유지한다. 검사를 끄거나 강제
패치, 부분 한국어판, 원본 설치 파일로 교체하지 않는다. 예전 `check-upstream.mjs`는
단일 ref에 대한 간단한 문맥 검사이며 업데이트 의사결정에는 위 보고서를 사용한다.

## 2. 안전한 통합

통과한 검사 보고서와 **같은 Kovar 커밋**에서:

```bash
node desktop/korean/update/prepare.mjs --report /tmp/kovar-release-check/upstream.json --output /tmp/kovar-integration
cd /tmp/kovar-integration/repo
. ./bin/activate-hermit
git diff --cached
git diff -- desktop/korean/update/state.json desktop/korean/manifest.json
```

독립 clone의 `codex/kovar-integration` 브랜치에 검사했던 **정확한 SHA**를
다시 fetch하고, 경로 충돌·병합 tree·모든 적용점을 재확인한다. 원래 작업 브랜치는
건드리지 않는다. 다음 적용 기준과 태그는 이 clone의 state/manifest에만 기록한다.
실패 시 `FAILED.txt`와 작업 공간을 보존하며 자동 reset하지 않는다.

원본 릴리스 노트와 `upstream.md`의 변경 목록(인증·프로토콜·Tauri 계정 저장소·
DB·빌드 의존성 포함)을 검토한다. 필요하면 Kovar overlay만 수정하고 원본의
변경을 따라간다. 의존성 lockfile을 임의로 갱신하지 않는다.

```bash
git add desktop/korean/update/state.json desktop/korean/manifest.json
# 추가 수정이 있다면 검토한 해당 파일만 git add 한다.
git commit -s -m "chore(kovar): integrate inspected upstream desktop source"
pnpm install --frozen-lockfile
pnpm -C desktop exec playwright install chromium webkit
```

`baseline`은 준비 명령의 대상이 아니다. 적합한 새 릴리스가 없는 시점에도
baseline 검사와 현재 소스의 검증을 실행해 체계 자체를 검증할 수 있다.

## 3. 추가 기능 검증

```bash
node desktop/korean/update/validate.mjs --suite all --output /tmp/kovar-validation
cat /tmp/kovar-validation/validation.md
```

CI처럼 `--suite ui`, `--suite relay`로 나눌 수도 있다. 각 단계 로그는 보고서
폴더 안에 최대 8MiB로 제한하며 실패 이후 단계는 `not-run`이다. 자동 재시도로
실패를 감추지 않는다. 기존 테스트를 재사용한다:

| 단계 | 실제 검증 범위 |
|---|---|
| overlay/types | 등록된 전체 UI 적용점, 변환 후 TypeScript, 변경·중복 문맥 거부 |
| locale + desktop UI | 한국어/영어, 언어 보존, 직원 로그인, 앱 재실행에 해당하는 reload, 관리자 발급, 일반 직원 메뉴 제한, 만료·다른 계정 재인증 |
| account/protocol | 영속 발급 재시도, 동일 키 유지, 권한 검증, 서명, 전송 journal, 실패 전파 |
| web/mobile UI | Chromium + 모바일 WebKit, 로그인·기존 대화·세션 복원·한글·언어 전환·답글·복구 |
| production bundles | 웹 빌드 및 실제 번들된 로그인 서비스의 기존 서비스 테스트 |
| real relay | 현재 소스에서 새로 cargo build한 원본 relay, 실제 NIP-98/NIP-42, 9030/9000/0 발급, 직원의 관리/비공개 채널 쓰기 거부, 잘못된 서명 거부, 대화 조회·송신, 서비스 재시작·만료·네이티브 NIP-49 등록 |

실제 릴레이 검사는 무작위 이름의 새 PostgreSQL/Redis/MinIO 컨테이너, 루프백 임시
포트, 합성 계정과 대화만 사용한다. DB는 원본의 embedded migrations로 초기화하며
pgschema와 migration 방식을 섞지 않는다. 기존 DB/릴레이 URL 입력은 받지 않는다.
MinIO는 upstream CI와 같은 공개 이미지의 digest를 고정한다. 종료 시 자신이 만든
컨테이너와 임시 계정 저장소만 제거한다. 강제 종료/호스트 중단 때 남은 컨테이너는
`docker ps -a --filter name=kovar-test-`로 확인하고 **해당 실행 이름만** 삭제한다.
다른 compose 프로젝트의 `down -v`, `just reset`은 사용하지 않는다.

원본 CI는 수정하거나 대체하지 않는다. GitHub Kovar 검증은 원본
`_ci-desktop.yml`을 재사용하고, 원래 `ci.yml`도 PR/push에서 계속 실행한다.
PR 전에는 원본 지침대로 `just ci`를 실행한다. Rust 서버/DB/auth를 수정하는
후속 업데이트는 `just test` 및 해당 패키지 지침도 적용한다. 이번 Kovar 테스트가
원본 전체 CI 또는 DB 업그레이드 테스트를 대체하지 않는다.

Native OS 키링·기존 설치 업그레이드·Windows IME·실제 iPhone/Android 키보드는
별도 사용자 테스트다. Mock UI의 reload를 OS 네이티브 실행으로 기록하지 않는다.

## 4. 추적 가능한 Kovar 후보 빌드

검증 보고서와 정확히 같은 **깨끗한 HEAD/tree**에서만 빌드된다. 필수 검사 하나라도
없거나 Mock만 있거나 dirty/다른 SHA이면 빌드 전에 중단한다. 원본 일반 빌드는
Kovar 후보 기록을 생성하지 않는다. 단일 all 보고서는 두 인자에 같은 경로를 준다.

```bash
node desktop/korean/update/build.mjs --target web \
  --ui-report /tmp/kovar-validation/validation.json \
  --relay-report /tmp/kovar-validation/validation.json \
  --output /tmp/kovar-web-candidate
```

Mac Apple Silicon은 `--target aarch64-apple-darwin`, Intel Mac은
`--target x86_64-apple-darwin`, Windows x64는 네이티브 Windows/MSVC 호스트에서
`--target x86_64-pc-windows-msvc`를 사용한다. output 이름은 실행마다 바꾼다.
네이티브 빌드는 동일 소스의 sidecar를 먼저 만들고 기존 bundler를 재사용한다.
최종 Tauri 출력은 `target/kovar-native/`로 분리한다. Mac은 `.app` ZIP,
Windows는 NSIS `.exe`, 웹은 `web/`와 로그인 서비스 Docker context `login/`을 남긴다.
웹 출력은 원본의 `web/dist` 또는 기존 원본 배포물을 대체하지 않는다.

`build.json`/`build.md`에는 원본 태그·SHA, Kovar SHA/tree, 앱 버전, 대상,
검증 결과, 남은 확인, 각 파일 크기와 SHA-256이 들어간다. `SHA256SUMS`를 결과물과
함께 보존한다. 앱 버전은 원본 패키지 버전을 그대로 사용하고 파일 이름/manifest의
Kovar SHA로 동일 버전의 수정 빌드를 구분한다. 웹/로그인/릴레이 버전은 별도다.

```bash
cd /tmp/kovar-web-candidate
shasum -a 256 -c SHA256SUMS
# Linux: sha256sum -c SHA256SUMS
```

앱 식별자 `kr.kovar.buzz.desktop`, 계정 저장소 `kovar-accounts`, 기존 deep link와
데이터 연결은 고정한다. 원본 updater 환경값을 제거하고 updater artifact와
endpoint를 비활성화한다. 공식 Buzz 설치 파일로 Kovar를 덮어쓰지 않는다.
`--shared-identity`는 소유자 이관용 구형 경로이며 업데이트 후보 명령에는 없다.

생성물은 항상 **unsigned-candidate**이고 자동 공개하지 않는다. Mac ad-hoc 서명이
있더라도 Developer ID 배포 서명·공증 완료라는 뜻이 아니다. 직원 배포 전에는
Apple Developer ID Application 인증서/키체인, 팀 ID, 공증 API 키 또는 앱 전용
비밀번호를 조직의 비밀 저장소에 설정하고 서명 후 `codesign --verify --deep
--strict`, `xcrun notarytool submit --wait`, `xcrun stapler staple` 및 Gatekeeper
검증을 수행한다. Windows는 조직의 Authenticode 인증서/서명 서비스와 timestamp
서버를 설정하고 `signtool verify /pa`로 검증한다. 이 저장소는 자격증명 자동
주입이나 서명 완료 승격을 구현하지 않는다. 서명 후 파일의 체크섬과 배포 manifest를
새로 기록한다. 파일을 바꾼 뒤 옛 체크섬을 사용하면 안 된다.

## 5. GitHub 설정

변경을 사용자가 검토해 push한 뒤 default branch에도 workflow 정의가 있어야
Actions의 수동 실행 메뉴에서 선택하기 쉽다. 테스트하려는 **Kovar 브랜치/ref**를
선택한다. 이번 작업은 push하지 않는다.

- Actions에서 pinned 외부 actions와 reusable workflows를 허용한다.
- 기본 `GITHUB_TOKEN`의 `contents: read`면 충분하다. PAT, 운영 SSH 키, 직원
  비밀번호, accounts 파일, master.key를 등록하지 않는다.
- `Kovar upstream inspection`: 수동 release/main/baseline 검사 및 보고서 artifact.
- `Kovar compatibility`: PR/push 또는 수동 실행. 기존 원본 Desktop CI 재사용과
  Kovar ui/relay 두 lane을 별도 실행한다. branch protection에서 원본 CI 및 이
  두 lane이 모두 필수가 되도록 설정한다.
- `Kovar unsigned candidates`: 수동 실행. 먼저 동일 SHA로 검증한 뒤 Mac ARM,
  Windows x64, 웹 후보를 빌드한다. artifact만 업로드하며 release 권한은 없다.
- hosted Linux runner에는 Docker, GitHub API에는 네트워크가 필요하다. Windows
  runner에는 MSVC/WebView2/NSIS 빌드 환경이 필요하다. 원본 CI가 요구하는
  branch protection도 유지한다. 이 세션에서 GitHub runner 실행은 하지 않았다.
- artifact 보존 기간은 30일이다. 실제 배포물과 롤백 파일은 별도 사내 저장소에
  장기 보존한다. 서명 비밀과 운영 deploy 권한을 검사 workflow에 주지 않는다.

선택적으로 사용자 본인이 원격에서 실행할 명령:

```bash
gh workflow run kovar-upstream.yml --ref YOUR_KOVAR_BRANCH -f mode=release
gh workflow run kovar-ci.yml --ref YOUR_KOVAR_BRANCH
gh workflow run kovar-build.yml --ref YOUR_KOVAR_BRANCH
```

## 6. 운영 배포는 별도 명시 실행

`desktop/korean/update/deployment.example.json`을 사내 기록 저장소에 복사해 모든
`REPLACE`를 채운다. 그 기록에는 앱별 build manifest checksum/SHA, 웹 SHA,
로그인 이미지 digest/SHA, relay 이미지 digest/원본 SHA, 이전 조합 기록,
DB 전후 migration 버전, 복구 판단, 백업 ID, 테스트 기록이 포함되어야 한다.
배포하지 않는 Windows는 `not-deployed`로 남긴다. 완성된 공개 메타데이터 기록은 다음
명령으로 검증·보존한다. 누락된 계정 쌍 백업, DB 복구 판단, 변경 가능한 이미지 tag,
미완성 placeholder는 거부한다. 이 명령은 배포하지 않으며 운영자의 수행 선언만 기록한다.

```bash
node desktop/korean/update/record.mjs --input /private/kovar-combination.json --output /private/kovar-record-001
```

 기록에는 **비밀값이나 계정
내용을 넣지 않는다**. 최초 운영 조합이 불명확하면 추정해 채우지 말고 운영자가
설치 파일·현재 이미지 ID·기존 기록으로 확인한다.

1. 합성 계정만 사용하는 staging에서 후보 조합을 시험한다. 원본 SHA 변경 시
   migrations뿐 아니라 schema/릴레이 API/계정 저장소 형식 변경을 검토한다.
2. 이전 Mac/Windows 설치 파일과 체크섬, 웹 index 및 모든 hash asset, 로그인과
   relay 이미지의 정확한 digest를 보존한다. tag만으로 롤백하지 않는다.
3. 점검 시간에 로그인 서비스 쓰기를 멈추고 **accounts.json + master.key를 하나의
   백업 단위로 함께** 암호화 백업한다. DB의 일관된 snapshot/백업, S3 미디어도
   보존한다. 백업 도구는 운영자가 실행하며 에이전트/CI는 비밀을 읽거나 출력하지
   않는다. 새 계정 저장소 형식을 쓴다면 해당 이미지와 백업도 한 쌍으로 관리한다.
4. 복구 연습은 격리된 복원 환경에서 한다. 회사 키를 테스트 로그나 artifact에
   넣지 않는다. 실제 직원 계정과 실제 대화로 자동 테스트하지 않는다.
5. 웹/로그인만 업데이트할 때 기존 `deploy-home.py`를 재사용한다. **이 명령은
   운영 변경이므로 자동 검사/빌드 단계에서는 절대 실행하지 않는다.** 같은 커밋의
   `build.mjs --target web`가 성공하고 해당 `web-dist`/`login-dist`의 파일 해시가
   후보의 `web/`/`login/`과 일치함을 확인한 후 운영자가 명시 실행한다:

   ```bash
   # 운영자만 실행: 이 문서 작성/로컬 검증 과정에서는 실행하지 않음
   python3 desktop/korean/web/deploy-home.py /Users/kovar/Servers/buzz
   ```

   이 기존 명령은 config/index를 백업하고, 이전 해시 자산을 보존하며, 로그인
   이미지를 content 기반 이름으로 만들고 Caddy를 갱신한다. 실제 이미지 ID도
   조합 기록에 추가한다. 기록을 `deployed`로 바꾸는 것은 배포 후 운영자 확인이다.
6. relay는 별도 유지보수 작업이다. 위 명령은 relay/DB를 업그레이드하지 않는다.
   `deploy/compose`와 기존 홈서버 runbook을 따라 검증된 **정확한 image digest**만
   지정한다. DB migration 실행 여부/순서를 먼저 결정하고 원본 새 이미지가
   자동 migration하는지 확인한다. 새 migration은 복원 가능한 백업을 확보한 뒤
   명시 실행한다. 실 서버 구성 파일이나 `.env`를 로그에 출력하지 않는다.
7. HTTPS `/chat/`, hash assets, `/health`, WebSocket 인증을 확인한다. 사용자는
   테스트용 별도 계정으로 로그인·과거 합성 대화·한글 전송·관리자 발급·직원 거부를
   확인한다. Mac 앱을 종료/재시작해 같은 계정·언어가 유지되는지, Windows는
   설치/재시작/IME/키링을 실제 OS에서 확인한다. iPhone/Android는 실제 브라우저의
   키보드·화면 크기·네트워크 재연결을 확인한다.

## 7. 복구

- 웹: 해당 배포 백업의 `index.html`을 원자적으로 복원하고 이전 hash assets를
  남긴다. 이전 Caddyfile/compose.home.yml을 복원한 뒤 기존 홈서버 관리 명령으로
  Caddy와 **이전 digest의 로그인 서비스**를 재시작한다. config 백업만 복원해도
  새 로그인 이미지가 자동으로 이전 이미지가 된다고 가정하지 않는다.
- 앱: 같은 Kovar 식별자의 이전 설치 파일로 교체한다. 앱 데이터·키링·계정
  저장소를 지우거나 원본 Buzz 설치 파일을 쓰지 않는다. 새 버전이 로컬 저장소
  형식을 바꿨으면 기존 데이터 백업과 이전 앱의 형식 호환을 먼저 확인한다.
- relay/DB: migration이 없고 이전 image가 현재 DB와 호환됨을 검증한 경우에만
  image 교체로 복구한다. migration이 있거나 호환성이 불명확하면 쓰기를 중단하고
  해당 시점 DB backup + 호환 relay image + 필요한 미디어를 함께 복원하거나
  원본이 제공한 검증된 복구 migration을 적용한다. 임의 down migration은 금지다.
- 로그인 저장소: 복원이 필요하면 **동일 시점 accounts.json/master.key 둘 다**와
  호환 이미지로 복원한다. 한 파일만 과거로 되돌리면 계정 키를 잃을 수 있다.
  복원 시점 이후 가입·비밀번호 변경·메시지의 손실 범위를 운영자가 먼저 승인한다.
- 이전 조합의 합성 계정 smoke를 다시 수행하고 rollback 시각·이미지·백업 ID·
  손실 범위·결과를 새 조합 기록에 남긴다. `docker compose down -v` 금지.

## 출시 판단

Git 병합 성공, overlay 적용 성공, 빌드 성공, 실제 기능 호환은 모두 별개다.
자동 도구는 unsigned 후보까지만 만든다. 원본 CI, Kovar ui/실제 relay, 각 배포
플랫폼의 사람 확인, 서명/공증, 백업/복구 검토가 모두 있는 조합만 운영자가 배포한다.
AGENTS.md의 인간 확인 전 PR은 draft이며 `buzz-review-completed`를 붙이지 않는다.
