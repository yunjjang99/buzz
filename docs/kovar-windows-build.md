# Windows PC에서 Kovar Buzz 빌드하기

대상은 **Windows 10/11 x64, MSVC**다. WSL/Linux 셸이나 Windows ARM64용 빌드가 아니다.
저장소 `yunjjang99/buzz`의 **`codex/admin-mfa` 브랜치**에 관리자 MFA, 단계별 로그인
잠금, 한국어 UI, 직원 계정, 전략실 및 아래 빌드 스크립트가 있다. `main`을 받으면
이 변경이 포함되지 않을 수 있다. 서버는 이미 `https://buzz.kovar.kr`에서 운영 중이다.
클라이언트 빌드에는 운영 서버 `.env`, 개인키, `accounts.json`, `master.key`가 필요 없다.

## 1. PC 준비 (최초 한 번)

1. [Git for Windows](https://git-scm.com/downloads/win)를 설치한다.
2. [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)의 2022 도구와
   **Desktop development with C++** 워크로드를 설치한다. MSVC v143 x64/x86,
   Windows SDK, C++ CMake tools를 포함한다.
3. [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
   설치 여부를 확인한다. [Tauri 공식 Windows 준비 안내](https://v2.tauri.app/start/prerequisites/#windows)도 참고한다.
4. [Rustup](https://rustup.rs/)에서 Windows용 `rustup-init.exe`를 실행해 MSVC 도구체인을 설치한다.
   저장소의 `rust-toolchain.toml`이 Rust **1.95.0**을 선택한다.
5. [Node.js 24.14.1](https://nodejs.org/dist/v24.14.1/) Windows x64 설치 파일을 사용한다.
   PowerShell에서 `npm.cmd install --global pnpm@11.4.0`을 실행한다.

설치 후 **Developer PowerShell for VS 2022**를 새로 연다. Git/Rust/Node가 PATH에서
인식되어야 한다. `.cmd` 명시 실행은 PowerShell의 npm/pnpm `.ps1` 실행 정책 문제를 피한다.
보안 정책을 해제할 필요는 없다. 첫 빌드는 인터넷과 충분한 여유 디스크가 필요하다.

```powershell
git --version
node --version
pnpm.cmd --version
rustup --version
cmake --version
```

## 2. 소스 받기

가능하면 짧은 경로(예: `C:\src`)를 사용한다. 아래 `C:\src`가 없으면 먼저 만든다.
Windows에서는 Hermit 활성화 대신 위의 네이티브 도구체인을 사용한다.

```powershell
New-Item -ItemType Directory -Force C:\src | Out-Null
Set-Location C:\src
git -c core.autocrlf=false clone --branch codex/admin-mfa https://github.com/yunjjang99/buzz.git kovar-buzz
Set-Location C:\src\kovar-buzz
git config core.autocrlf false
git status --short
git rev-parse HEAD
pnpm.cmd install --frozen-lockfile
rustup target add x86_64-pc-windows-msvc
```

명령이 실패하면 다음 단계로 진행하지 말고 오류를 해결한다. `git status --short`는
비어 있어야 한다. 설치 중 파일이 바뀌었다면 변경을 검토하고 보존한다. `reset --hard`,
키체인 초기화, lockfile 삭제로 넘어가지 않는다. 이미 clone한 PC는 변경을 보존한 뒤
`git fetch origin`, `git switch codex/admin-mfa`, `git pull --ff-only`로 갱신한다.

## 3. 로컬 시험용 설치 파일 생성

저장소 루트에서 실행한다. 출력 폴더는 저장소 밖의 **아직 없는 폴더**여야 한다.

```powershell
$buildStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$buildOutput = Join-Path $env:USERPROFILE "Downloads\Kovar-Buzz-Windows-$buildStamp"
node desktop/korean/build-windows.mjs --output "$buildOutput"
if ($LASTEXITCODE -ne 0) { throw "Build failed. Read build.log and build.json in $buildOutput" }
Get-ChildItem "$buildOutput"
```

스크립트는 다음을 순서대로 수행하며 실패 즉시 중단한다.

- 깨끗한 소스 커밋 확인, MFA/로그인 서비스 및 앱 식별자 테스트.
- 같은 소스의 Windows 보조 실행 파일 5개를 `cargo build --locked`로 빌드.
- 한국어 overlay 및 변환된 TypeScript 검사, production frontend 빌드.
- `kr.kovar.buzz.desktop` / `kovar-accounts` 식별자로 Windows NSIS 설치 파일 생성.
  원본 Buzz 자동 업데이트 설정은 상속하지 않는다.
- 새 `.exe`를 출력 폴더에 복사하고 SHA-256, 소스 SHA, 빌드 상태/로그 저장.

출력 예시:

```text
Kovar-Buzz-Windows-날짜/
  Kovar-Buzz-0.5.26-커밋SHA-windows-x64-unsigned.exe
  SHA256SUMS
  build.json
  build.log
```

`build.json`의 `status`가 `unsigned-local-test-build`여야 성공이다. `failed`이면
중간 산출물을 배포하지 않는다. SHA-256 확인:

```powershell
$buildInfo = Get-Content (Join-Path $buildOutput 'build.json') -Raw | ConvertFrom-Json
$exePath = Join-Path $buildOutput $buildInfo.artifact.name
$actualHash = (Get-FileHash $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $buildInfo.artifact.sha256) { throw 'SHA256 mismatch' }
```

## 4. 설치와 확인

이 경로는 **본인 PC 시험용 미서명 빌드**다. Windows Authenticode 서명이나 실제 Windows
실행 검증을 완료했다는 뜻이 아니다. SmartScreen 정책이 차단하면 회사의 서명/승인 절차를
사용한다. 직원에게 정식 배포하려면 아래 검증 및 조직의 코드 서명이 필요하다.

기존 Kovar Buzz를 종료하고 이전 설치 파일을 보관한 뒤 생성된 설치 파일을 실행한다.
원본 Buzz와 Kovar Buzz는 다른 앱이므로 Kovar Buzz를 실행한다. 설치 후:

1. `buzz.kovar.kr` 회사 계정 로그인. 관리자이면 인증 앱 MFA 등록/코드 확인 및 복구 코드 보관.
2. MFA 오류 시 관리자 작업이 허용되지 않는지, 정상 MFA 후 직원 관리가 열리는지 확인.
   반복 실패/잠금 시험은 실제 관리자 대신 별도 합성 테스트 계정으로 한다.
3. 한글 입력/조합, 채팅, 전략실 표시와 화면 이동 확인. 쓰기 시험은 테스트 채널에서 수행.
4. 앱을 완전히 종료하고 재실행해 동일 계정/언어가 유지되는지 확인.
5. 관리자 관리 화면의 별도 비밀번호/MFA 재인증 확인.

저장된 기기 키로 채팅에 재접속하는 경로는 비밀번호 로그인 MFA와 별개다.
앱 설치만으로 기존 관리자에게 인증 앱이 자동 등록되지는 않는다.

## 5. Mac·Windows 배포판을 한 폴더에 모으기

Mac의 기존 폴더 `~/Downloads/Kovar-Buzz-0.5.26-MFA`를 Windows로 복사하거나,
새 공용 보관 폴더를 만들고 위 출력 폴더의 파일들을 `Windows-x64`에 복사한다.

```text
Kovar-Buzz-0.5.26-MFA/
  README.txt
  macOS-Apple-Silicon/   (기존 Mac ZIP, SHA256SUMS, build-info.json)
  Windows-x64/          (새 EXE, SHA256SUMS, build.json, build.log)
```

Mac 앱 커밋은 `4af047c6c`; 이후 Windows 빌드 스크립트/문서 커밋을 포함한 Windows SHA는
다를 수 있으므로 플랫폼별 manifest를 유지한다. `.exe`나 `.app`을 Git에 커밋하지 않는다.
계정 파일·개인키·서버 환경설정도 배포 폴더에 넣지 않는다.

## 6. 문제 해결과 정식 후보 빌드

- `link.exe`, `cl.exe` 또는 Windows SDK 오류: VS C++ 구성요소와 Developer PowerShell 확인.
- CMake 관련 오류: VS의 CMake tools 설치 및 PATH 확인. 스크립트는 기존 Windows 빌드와
  동일한 `CMAKE_POLICY_VERSION_MINIMUM=3.5`를 설정한다.
- NSIS/WebView2/의존성 다운로드 실패: 프록시·방화벽 및 빌드 로그 확인 후 새 출력 폴더로 재시도.
- `build.lock`이 이미 있음: 다른 빌드가 실행 중인지 먼저 확인한다. 이전 실행이 강제 종료되어
  남은 것이 확실할 때만 `target/kovar-windows/build.lock`을 제거한다.
- Mac/WSL에서 실행하면 빌드 전에 거부한다. 파일 확장자 변경으로 Windows 설치 파일을 만들 수 없다.
- 정식 후보는 [업데이트 운영 문서](kovar-updates.md)의 같은 SHA UI/실제 relay 검증 보고서를
  갖춰 `desktop/korean/update/build.mjs --target x86_64-pc-windows-msvc`로 만든다.
  본인 PC 시험용 스크립트는 이 검증 완료 상태를 주장하거나 해당 gate를 변경하지 않는다.

이 인계 시점에는 Mac에서 스크립트 구문·도움말·지원하지 않는 플랫폼 거부 및 관련 테스트를
확인했다. Windows 네이티브 컴파일/설치/실행은 아직 수행하지 않았으며 해당 PC에서 확인해야 한다.
