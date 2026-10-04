# 한국어 웹 메신저

접속 주소: **https://buzz.kovar.kr/chat/**. 설치 없이 PC와 휴대폰 브라우저에서
기존 Buzz 계정의 채널·개인 대화·답글을 사용합니다. 한국어/English 선택은
브라우저에 저장합니다. 기존 원본의 저장소 웹 화면과 릴레이 경로는 유지합니다.

## 로그인

Mac 앱에서 **설정 → 프로필 → 계정 정보 → Identity details**를 펼칩니다.
Private key 행의 Reveal을 누르면 마스킹된 키와 **Create backup** 버튼이
나옵니다. 비밀번호를 정하고 암호화 백업을 만들어 **Download backup**으로
`.ncryptsec` 파일을 저장합니다. 기존 백업이 있다면 다시 만들 필요는 없습니다.
키를 표시하거나 복사해서 채팅에 붙여넣지 마세요.

웹에서 그 파일을 선택하고 백업 비밀번호를 직접 입력합니다. 백업과 비밀번호는
서버에 업로드하지 않습니다. 복호화와 서명은 브라우저 Worker에서 처리하고,
키는 저장하지 않습니다. 로그아웃 또는 새로고침하면 다시 로그인해야 합니다.
Worker의 복호화 메모리 비용은 데스크톱과 동일하게 log_n 18 이하로 제한합니다.

NIP-07 서명 확장이 있는 브라우저는 **브라우저 서명 확장으로 로그인**을
선택할 수 있습니다. 확장에 있는 계정이 워크스페이스 멤버여야 합니다.
새 직원은 먼저 관리자의 초대로 Buzz 계정을 워크스페이스에 참여시킵니다.
직원별로 각자의 계정 백업을 사용합니다. 소유자의 키를 함께 사용하지 않습니다.

## 모바일 화면

- 채널 목록과 대화를 분리하고 왕복 버튼을 제공합니다.
- 터치 대상은 최소 44px이고, 입력 글자는 iOS 자동 확대를 피하는 1rem입니다.
- 화면 높이는 visualViewport를 따라 바뀌어 키보드가 열릴 때 입력 공간을 조정합니다.
- 안전 영역, 좁은 화면, 짧은 화면 및 가로 넘침을 처리합니다.
- Enter는 전송, Shift+Enter는 줄바꿈입니다. 한글 조합 중 Enter는 전송하지 않습니다.
- 이전 메시지를 읽고 있으면 새 메시지가 와도 자동으로 아래로 이동하지 않습니다.

실제 iPhone/Android의 키보드, 파일 선택 및 네트워크 전환은 사용자가 직접
확인해야 합니다. WebKit 모바일 에뮬레이션은 실제 휴대폰 테스트를 대신하지 않습니다.

## 현재 범위

지원: 기존 계정 로그인, 참여한 채널/DM 목록, 최근 이벤트 200개 조회와 실시간
수신, 한글 메시지, 답글, 기본 수정/삭제 반영, 언어 전환, 수동 재연결.

파일 업로드, 음성, 알림, 채널 생성/초대 관리, 에이전트, 포럼 작성 등은
데스크톱을 사용합니다. 데스크톱 전체 기능을 브라우저로 이식한 버전은 아닙니다.
포럼 등 미지원 유형에는 데스크톱 이용 안내를 표시합니다.

전송 전에 서명한 메시지 한 개를 탭의 sessionStorage에 기록합니다. 릴레이의
긍정 OK를 받은 뒤 기록을 지웁니다. 실패하면 동일한 ID를 재전송하며 새 메시지를
자동으로 만들어 중복시키지 않습니다. 기록은 계정과 릴레이에 묶입니다.
탭을 닫기 전에 남아 있는 재시도 메시지를 확인하세요. 브라우저 저장소 접근을
금지하면 재시도 기록을 저장할 수 없어 메시지를 보내지 않습니다.

## 구조와 원본 업데이트

모든 웹 코드/설정은 `desktop/korean/web/`에 추가했습니다. 원본 파일을
수정하거나 Tauri mock bridge를 제품에 포함하지 않습니다. Nostr의 NIP-42
인증, 서명 이벤트, d-tag 채널 메타데이터와 h-tag 메시지를 사용하며,
접근 권한은 기존 릴레이가 검사합니다. 브라우저에서는 Tauri 기능을 실행하지 않습니다.

원본의 제품 방향인 동일 도메인·동일 계정·동일 워크스페이스를 따르며,
원본의 저장소 웹 화면을 채팅 화면으로 대체하지 않고 `/chat/`을 추가합니다.
Git 충돌 위험은 분리했지만 원본 프로토콜이나 로그인 계약이 바뀌면 웹 코드를
검토해야 합니다. 원본 릴리즈에 웹 메신저가 자동 포함되지는 않습니다.

## 빌드·검증

저장소 루트에서 Hermit 환경을 활성화하고 고정 의존성을 설치한 뒤:

```bash
cd desktop
pnpm exec tsc -p korean/web/tsconfig.json
pnpm exec biome check korean/web
node --import ./test-loader.mjs --experimental-strip-types --test korean/web/tests/protocol.test.mjs
pnpm exec playwright install chromium webkit
pnpm exec playwright test --config korean/web/playwright.config.ts
pnpm exec vite build --config korean/web/vite.config.ts
```

결과는 `desktop/korean/web-dist/`입니다. 원본 데스크톱의 `dist/`와 별도입니다.
테스트는 합성 계정과 테스트 릴레이로 인증·전송·실패 재시도를 검사합니다.
실제 직원 대화에 테스트 메시지를 보내지 않습니다.

배포된 HTML/JS/CSP도 같은 테스트로 확인할 수 있습니다:

```bash
BUZZ_WEB_TEST_URL=https://buzz.kovar.kr/chat/ \
  pnpm exec playwright test --config korean/web/playwright.config.ts
```

## 홈서버 배포·복구

```bash
python3 korean/web/deploy-home.py /Users/kovar/Servers/buzz
```

이 명령은 운영 서버를 변경합니다. 홈서버의 Caddyfile과 compose.home.yml을
먼저 `web-deploy-backups/`에 백업합니다. `/chat/` 정적 파일과 읽기 전용 볼륨을
추가하고 설정 검사 후 Caddy만 재적용합니다. 릴레이·DB·S3는 재설치하지 않습니다.
알 수 없는 기존 Caddy 설정에는 덮어쓰기하지 않고 중단합니다.
실패하면 이전 설정을 복구합니다. 다음 배포에서도 이전 해시 자산을 남겨
이미 열린 탭을 깨뜨리지 않고 index.html을 마지막에 교체합니다.

복구 시 해당 백업의 Caddyfile과 compose.home.yml을 서버에 복원하고
`buzzctl start`로 Caddy 구성을 재적용합니다. 백업에 index.html이 있으면
web-client/index.html도 복원합니다. 기존 해시 자산은 남겨 둡니다.

배포 후 `/chat/`의 HTTP 200, 해시 자산의 HTTP 200, `/health`의 `ok`,
WebSocket의 AUTH challenge, 직접 로그인·상대 계정과 수신을 확인합니다.
