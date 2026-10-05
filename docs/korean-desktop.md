# 한국어 Buzz 데스크톱

이 포크는 첫 실행에서 한국어를 사용합니다. **프로필 메뉴 → 설정 → 화면 설정 →
언어**에서 한국어와 English를 선택할 수 있습니다. 설정은 기기에 저장되어
앱을 다시 실행해도 유지됩니다. 언어 변경은 계정이나 서버 데이터를 변경하지
않으며, 작성한 메시지와 채널 이름은 번역하지 않습니다.

## 현재 번역 범위

- 사이드바, 검색, 워크스페이스 메뉴와 프로필 메뉴
- 워크스페이스 접속 및 초대 링크 입력
- 채널 생성·찾아보기·공개 범위·자동 삭제 기간
- 메시지 입력·전송·답장·서식·파일 첨부 버튼
- 설정 메뉴, 프로필·백업·로그아웃 확인창, 화면 설정과 언어 선택
- 알림·음성·단축키·모바일 연결·업데이트의 상세 설명과 오류 안내
- 직원 초대·권한 관리, 사용자 이모지·보관함·채널 템플릿
- 에이전트 기본값·실행 도구·제공업체 설정, 컴퓨팅·실험 기능

아직 번역하지 않은 화면과 서버 오류 문구는 영어로 표시됩니다. 에이전트
대화·프로젝트·자동화 화면과 외부 도구가 반환하는 안내는 별도 범위입니다.
이 문서는 전체 한국어 번역이나 Windows 실행 검증이 완료되었다는 의미가 아닙니다.

## 홈서버 연결

현재 홈서버 주소는 `wss://buzz.kovar.kr`입니다. Kovar Buzz 직원은 관리자가
발급한 아이디로 로그인합니다. 기존 Buzz 계정을 사용하는 경우 초대 링크로
참여할 수도 있습니다. 소유자의 개인 키를 직원에게 공유하지 않습니다.
UI 언어 변경을 위해 서버나 데이터베이스를 다시 설치할 필요는 없습니다.

## 빌드

빌드에는 저장소의 Hermit 환경을 사용합니다. Windows는 Windows 빌드 머신과
MSVC 개발 도구가 필요하며, 아래 명령은 Git Bash 기준입니다. Mac의 파일을
Windows 설치 파일로 사용할 수는 없습니다.

```bash
. ./bin/activate-hermit
pnpm install --frozen-lockfile
```

Apple Silicon Mac:

```bash
cargo build --release --target aarch64-apple-darwin \
  -p buzz-acp -p buzz-agent -p buzz-backend-kubernetes \
  -p buzz-dev-mcp -p git-credential-nostr -p buzz-cli
./scripts/bundle-sidecars.sh aarch64-apple-darwin
cd desktop
BUZZ_RELAY_URL=wss://buzz.kovar.kr BUZZ_RELAY_HTTP=https://buzz.kovar.kr \
  node korean/native-build.mjs --target aarch64-apple-darwin --bundles app
```

Windows x64:

```bash
cargo build --release --target x86_64-pc-windows-msvc \
  -p buzz-acp -p buzz-agent -p buzz-dev-mcp \
  -p git-credential-nostr -p buzz-cli
./scripts/bundle-sidecars.sh x86_64-pc-windows-msvc
cd desktop
BUZZ_RELAY_URL=wss://buzz.kovar.kr BUZZ_RELAY_HTTP=https://buzz.kovar.kr \
  node korean/native-build.mjs --target x86_64-pc-windows-msvc --bundles nsis \
  --config src-tauri/tauri.windows.conf.json
```

이 명령은 공개 배포용 코드 서명이나 공증을 수행하지 않습니다. 최초 로컬
Mac UI 빌드는 설치된 Buzz 0.5.26의 보조 실행 파일 6개를 재사용합니다.
직원 배포용 빌드는 위의 명령으로 보조 실행 파일도 동일한 소스에서 빌드하세요.

## 검증

```bash
cd desktop
pnpm typecheck
pnpm check
pnpm test
node korean/check.mjs
node --test korean/tests/overlay.test.mjs
node --import ./test-jsdom-setup.mjs --import ./test-loader.mjs \
  --experimental-strip-types --test-force-exit --test korean/runtime/locale.jsdom-test.mjs
VITE_BUZZ_EMPLOYEE_APP=1 node korean/build.mjs --e2e
pnpm exec playwright test --config korean/playwright.config.ts
```

화면 테스트는 실제 UI에서 한국어·영어 전환, 키보드 선택, 재실행에 해당하는
새로고침 후 설정 유지, 한글 초안 보존과 메시지 전송을 확인합니다. 상세 설정
탭과 로그아웃 확인창의 번역·영어 복귀도 검사합니다. 실제 서버,
네이티브 알림, Windows IME 및 운영체제별 설치 동작은 별도 확인해야 합니다.

직원 배포 전에 Mac과 Windows에서 다음을 직접 확인하세요.

1. 초대 링크로 각자의 계정이 워크스페이스에 접속되는지 확인합니다.
2. 한글 메시지, 답장, 파일을 상대방이 받을 수 있는지 확인합니다.
3. 언어를 바꾼 뒤 앱을 종료하고 다시 열어 선택이 유지되는지 확인합니다.
4. 한글 조합 중 Enter를 누르면 글자가 확정되고, 의도치 않게 메시지가
   전송되지 않는지 확인합니다.

## 원본 업데이트와 충돌 범위

한국어 파일은 `desktop/korean/`과 이 문서에만 추가했습니다. 기존 원본 소스,
패키지 설정, 테스트, Rust 코드, 릴리즈 설정에는 수정이 없습니다. 일반 원본
빌드 명령은 원래 영어판을 만듭니다. 한국어판은 위의 별도 빌드 명령을 사용합니다.

`korean/vite.config.ts`가 원본 Vite 설정을 불러오고, 원본 파일을 저장하지 않고
메모리에서 UI 번역 변경을 적용합니다. 프로토콜·서버·메시지 데이터는 건드리지
않습니다. 원본의 공개/내부 기능 검사와 Tauri 패키징 절차도 재사용합니다.

이 구조는 한국어 수정 때문에 원본 파일에서 발생하던 **Git 병합 충돌**을
피합니다. 다만 원본이 같은 폴더를 새로 만들거나 UI 구조를 바꾸는 경우까지
무조건 호환된다고 보장할 수는 없습니다. 적용 문맥이 바뀌거나 중복되면
검사가 실패하며, 원본을 변경하거나 이전 한국어판을 덮어쓰지 않습니다.
실패 시 `korean/patches/`의 해당 UI 적용 규칙을 새 원본에 맞게 검토해야 합니다.
검사를 끄거나 부분 적용으로 출시하지 마세요.

업데이트 전에 저장소 루트에서:

```bash
. ./bin/activate-hermit
git fetch upstream main --tags
cd desktop
node korean/check-upstream.mjs upstream/main
# 특정 릴리즈를 설치할 때는 그 태그로 검사합니다.
node korean/check-upstream.mjs desktop-v0.5.26
```

이 검사는 읽기 전용입니다. 브랜치, 설치된 앱, 홈서버는 변경하지 않습니다.
통과한 검사도 새 원본의 컴파일·실행 호환성까지 보장하지 않으므로 변경을
저장한 작업 브랜치에 선택한 원본 커밋을 병합한 뒤 의존성 설치, 위의 검사,
화면 테스트, 해당 운영체제 네이티브 빌드와 직접 사용 테스트를 다시 수행하세요.
원본 버전 번호와 설치 파일 이름을 임의로 최신 버전으로 올리지 마세요.

현재 적용 기준은 원본 main `e982f70fba29cdaa9a8378f118a0e498537bd8db`
(패키지 버전 0.5.26)입니다. 같은 버전 번호를 가진 정식
`desktop-v0.5.26` 태그는 더 이전 커밋이며 CommunitySwitcher의 함수 인자가
달라 현재 적용 검사에서 중단됩니다. 버전 번호만으로 호환을 판단하지 않고
정확한 커밋별로 검사하는 이유입니다. 해당 태그용 한국어판이 검증됐다고
주장하지 않습니다.

공식 설치 파일이나 공식 자동 업데이트는 한국어 기능을 포함하지 않습니다.
한국어판을 유지하려면 원본 업데이트마다 이 계층을 검사하고 자체 설치 파일을
다시 만들어 배포해야 합니다. 자체 서명·릴리즈 서버·자동 업데이트 배포는
아직 구성하지 않았습니다. 기존 계정과 홈서버는 그대로 연결합니다.

## 번역 추가

일반 문구는 `desktop/korean/runtime/messages.ts`, 상세 설정 문구는
`desktop/korean/runtime/settings-messages.json`에 추가합니다. UI 적용 규칙은
`desktop/korean/manifest.json`과 `patches/`에 있습니다. 원본 컴포넌트를 직접
수정하지 않습니다. 규칙은 `useLocale()`로 변경을 구독하고 `t("English copy")`를
표시하도록 변환합니다. 이름·메시지 등 사용자 데이터는 `t()`에 직접 넣지 말고
`t("Message #{channel}", { channel: channelName })`처럼 매개변수로 전달합니다.
모듈 수준 옵션은 렌더링 또는 getter에서 번역해 언어 변경을 반영합니다.
역할·상태 식별자와 저장되는 값은 영어 원본을 유지합니다.

새 규칙을 추가하거나 원본에 맞게 수정한 뒤 `node korean/check.mjs`로 전체
적용 위치와 **변환 후 TypeScript**까지 검사하고 화면 테스트를 실행합니다.
기존 원본 단위 테스트는 기존 소스에 대해 실행되고, 한국어 전용 테스트는
변환된 실제 UI에서 실행됩니다.


## 앱 아이디 로그인과 직원 발급

첫 실행의 **회사 계정으로 로그인**에 웹과 같은 아이디와 비밀번호를 입력합니다.
초기 비밀번호라면 새 비밀번호를 정한 뒤 연결합니다. 기존 Rust의 NIP-49
복호화와 OS 키링 저장 경로를 재사용하고, 연결 후 기존 Buzz 전체 화면으로
진입합니다. 서버는 비밀번호로 암호화한 백업만 전달하며, 앱 화면의 저장소에
백업·비밀번호·접속 토큰을 저장하지 않습니다. 재실행은 기존 앱의 로컬 키로
인증하므로 매번 비밀번호를 입력할 필요가 없습니다.

관리자는 **설정 → 워크스페이스 → 직원 계정 관리**에서 직원 아이디·이름·
초기 비밀번호(12자 이상)와 참여할 채널을 입력한 뒤 **직원 계정 만들기**를
누릅니다. 같은 페이지의 **직원 계정 목록**에서 `사용 가능` 상태를 확인한 뒤
직원에게 아이디와 초기 비밀번호를 전달합니다. 이 메뉴는 KOVAR 홈서버의
소유자·관리자에게 표시되고, 발급 요청은 기존 계정 서비스가 관리자 권한을
다시 검증합니다. 일반 직원과 다른 서버의 관리자는 이 메뉴가 표시되지 않습니다.

현재 앱에서 아이디로 로그인한 관리 접속이 유효하면 발급 화면을 바로 엽니다.
재인증이 필요하면 같은 페이지에 **직원 계정 관리 인증**이 표시됩니다.
일반 사용자의 비밀번호 변경은 기존 **설정 하단 → 직원 계정 · 아이디 로그인**에서
같은 계정의 아이디로 인증한 뒤 이용합니다.
홈서버 소유자는 로그인 화면의 **소유자 관리자 최초 설정**을 선택하고 새
아이디·비밀번호·이름을 입력합니다. 현재 앱 계정의 암호화 백업을 자동 생성해
서버의 소유자 키와 대조하므로 별도 파일 전달은 필요하지 않습니다.

기존에 저장된 다른 앱 계정을 자동으로 덮어쓰지 않습니다. 다른 계정으로
연결하려면 기존 계정을 백업하고 앱의 기존 로그아웃 기능을 먼저 사용하세요.
관리 기능의 앱 접속 토큰은 메모리에만 유지하며 8시간 후 만료됩니다.
앱을 종료하면 관리 접속 토큰도 사라집니다. 채팅은 로컬 키로 다시 접속하지만,
직원 발급에는 **직원 계정 관리 인증**에서 관리자 아이디로 다시 인증해야 합니다.
직원 계정 관리 페이지의 **관리자 다시 인증**으로 만료된 접속을 복구할 수 있습니다.

이 연결은 앱에 계정 키를 저장하는 **기기 등록**이기도 합니다. 웹 비밀번호
초기화는 웹·관리 접속 세션을 해제하지만 등록된 네이티브 앱의 키를 회수하지
않습니다. 퇴사 등으로 모든 접근을 종료하려면 원래 Buzz의 커뮤니티 관리에서
직원의 릴레이 멤버십과 채널 권한을 제거해야 합니다. 아이디 로그인은 회사가
관리하는 서버 키 보관을 선택한 운영 방식이며 원본의 사용자 키 소유 모델과
의도적인 차이가 있습니다.

추가 변경도 `desktop/korean/` 오버레이와 별도 로그인 서비스에 한정합니다.
원본 Rust·화면 파일은 수정하지 않고, 업데이트 시 매니페스트에 등록된 모든 UI 바인딩의 문맥을
검사합니다. 문맥이 바뀌면 빌드를 중단하고 재검토합니다. 충돌이 영원히 없다는
보장은 아니며 새 원본 버전에서 앱 빌드와 동작 검증을 반복해야 합니다.


## 직원용 앱과 원본 계정 저장소 분리

기본 `node korean/native-build.mjs` 빌드는 **Kovar Buzz** 직원용 앱을 만듭니다.
Tauri 식별자는 `kr.kovar.buzz.desktop`, 원본의 이름 있는 계정 격리 기능에
전달하는 식별자는 `kovar-accounts`입니다. OS 키링, 앱 데이터, 웹뷰 로그인
설정, 에이전트 캐시와 작업 폴더를 원본 Buzz에서 분리하고, 원본의 기존 계정
자동 이전도 사용하지 않습니다. 첫 실행은 회사 아이디 로그인 화면입니다.
한 번 연결한 뒤의 재실행은 이 직원용 앱에 저장한 해당 직원 계정으로 접속합니다.
원본 Buzz에서 로그인한 신윤수 계정이나 대화는 삭제하거나 로그아웃하지 않습니다.

최초 소유자 아이디를 연결할 때는 기존 소유자 계정이 들어 있는 이전
**Buzz-Kovar.app**의 설정 하단에서 관리자 최초 설정을 완료합니다.
그 후 새 **Kovar Buzz** 앱에는 발급한 아이디로 로그인합니다. 원본 저장소를
쓰는 소유자 연결용 빌드를 다시 만들려면 `--shared-identity`를 명시합니다.
이 옵션은 기존 계정이 자동으로 열리므로 직원에게 배포하지 않습니다.

원본 Rust 코드는 그대로 두고 원본의 계정 격리 빌드 기능을 재사용합니다.
직원용 딥링크는 `buzz-demo-kovar-accounts://`로 분리되어 원본의 `buzz://`
등록을 덮어쓰지 않습니다.

## 업데이트 운영 절차

원본 확인·격리 통합·필수 검증·Kovar 후보 빌드·배포 및 복구는
[Kovar 원본 업데이트 운영](kovar-updates.md)을 따릅니다. 검사와 빌드는 운영을
변경하지 않으며, 실제 릴레이 검증 없이 Mock 결과만으로 출시하지 않습니다.

## 2026-10-05 관리자 MFA Mac 로컬 업데이트

- 설치 소스: `4af047c6c` (`codex/admin-mfa`), 앱 버전 `0.5.26`, Apple Silicon.
- 관리자 비밀번호 로그인/관리 기능 재인증에 MFA를 적용한다. 기존 기기 키를 이용한
  채팅 접속은 유지된다. 실제 관리자 인증 앱 등록과 복구 코드 보관은 사용자가 수행한다.
- 이미 설치되어 있던 전략실의 소스를 `fa4f` 작업 공간에서 복사해 함께 보존했다.
  웹 배포와 원래 작업 공간은 이 데스크톱 업데이트에서 수정하지 않았다.
- 동일 Rust 소스와 루트 Cargo.lock임을 확인한 `c312bab4a41e` 빌드의 sidecar 6개를
  재사용했다. 파일별 SHA-256은 아래 배포 기록의 `buzz-mfa-sidecars.json`에 있다.
- overlay/변환 TypeScript, MFA·직원 계정·전략실 mock UI 10개, 전략실 모델 6개 통과.
  네이티브 release 빌드와 ad-hoc 서명 후 `codesign --verify --deep --strict` 통과.
  전체 `just ci`, Windows 빌드, Developer ID 서명/공증은 수행하지 않았다.
- 설치: `/Users/kovar/Applications/Kovar Buzz.app`.
- 이전 앱: `/Users/kovar/Applications/Kovar Buzz Backups/Kovar Buzz-before-MFA-20261005-165606.app`.
- ZIP·SHA256SUMS·로그·배포 상태:
  `/Users/kovar/Servers/buzz/desktop-releases/mfa-4af047c6c-20261005/`.
- 설치 후 시작 시 macOS 키체인 승인 대기가 확인되었다. SecurityAgent 시스템 창은
  자동화 도구가 접근을 차단하므로 사용자가 Mac 로그인 비밀번호를 직접 입력해
  승인해야 한다. 키체인/계정 저장소를 삭제하거나 초기화해서 우회하지 않는다.
  승인 이후 네이티브 화면·관리자 재인증 확인은 배포 기록에 별도로 남긴다.
- 복구하려면 앱을 종료한 뒤 현재 앱을 보관하고 위 백업 앱을 같은 설치 경로로
  복원한다. 앱 데이터와 OS 키체인은 유지한다. 이 ZIP은 로컬 보관용이며 공증된
  직원 배포물이나 자동 업데이트로 게시한 것이 아니다.
