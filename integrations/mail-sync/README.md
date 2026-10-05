# KOVAR / 청북 메일 수집

기존 Buzz relay의 NIP-98 `/events`, `/query`를 사용하는 별도 수집 서비스입니다.
Buzz 전용 계정으로 회사별 공개 채널에 기록합니다. 사용자 메일 계정의 인증이
성공하기 전에는 수집하지 않습니다. 두 회사의 견적번호·거래·판매 데이터는
변경하지 않으며, 이 단계에서는 메일 원문 기록만 만듭니다.

## 운영

- 관리자 설정: <http://localhost:8766/> (서버 Mac에서만 접근)
- Gmail: `nova@kovar.kr`, `sales@kovar.kr`는 발신 별칭
- 네이버: `cbtcshin@naver.com`
- 최초 범위는 첫 실행일 기준 최근 3개월의 시작 날짜로 고정해 저장합니다.
  현재 설치는 **2026-07-05부터**입니다. 매번 날짜를 이동시키지 않습니다.
- 보통 2분 간격. 과거 메일이 남아 있으면 회당 25건/계정씩 수집하고 10초 뒤
  이어서 실행합니다. 서버 응답 시간에 따라 실제 간격은 늘어납니다.
- Gmail은 All Mail을 우선 사용합니다. 나머지 경우 읽을 수 있는 메일함을
  조회하되 스팸·휴지통·임시보관함을 제외합니다. EXAMINE과 BODY.PEEK를 사용해
  발송·삭제·읽음 변경을 하지 않습니다.
- 앱 비밀번호가 필요합니다. Google Workspace에서 앱 비밀번호를 금지하면
  OAuth 클라이언트 등록이 별도로 필요하며 현재 서비스는 OAuth를 지원하지 않습니다.
- 인증 정보는 AES-256-GCM으로 암호화합니다. 설치 키와 SQLite는 전용 Docker
  volume 안에 있으며 0700/0600 권한입니다. 호스트/Docker 관리자에게는 접근 권한이
  있으므로 이 방식이 호스트 관리자에 대한 암호학적 격리를 제공하지는 않습니다.
- 첨부파일은 파일명만 기록합니다. 전체 MIME 8 MiB 초과는 제목·주소 등 기본
  정보만 기록하고 제한을 표시합니다. 긴 본문은 일부만 Buzz에 표시합니다.
- 같은 메일의 동일 Message-ID/본문/발신 정보는 계정 안에서 중복 제거됩니다.
  다른 계정으로 전달된 메일은 각 원본 메일함 기록으로 유지됩니다.
- 메일은 반드시 암호화 연결로 가져옵니다. SSL 검증을 끄지 않습니다.

상태는 설정 화면에서 수집/게시/일부 내용 제한 건수와 마지막 확인 시각을
확인합니다. 수집·게시 오류는 저장해 재시도하며 5회 연속 실패하면 `확인 필요`로
멈춥니다. 원인을 해결한 뒤 `연결 상태 다시 확인`을 누릅니다. 수집 중지 시 이미
내려받아 저장한 게시 대기 메일은 계속 게시됩니다.

## 설치와 실행

운영 설치 경로: `/Users/kovar/Servers/buzz/mail-sync`.
Compose 프로젝트: `kovar-mail-sync`, 외부 네트워크: `buzz-home_buzz-net`.
볼륨: `kovar-mail-sync_mail-data`. 기존 Buzz 서비스의 재시작은 필요하지 않습니다.

```sh
docker compose -f /Users/kovar/Servers/buzz/mail-sync/compose.yml up -d --wait
docker compose -f /Users/kovar/Servers/buzz/mail-sync/compose.yml ps
docker compose -f /Users/kovar/Servers/buzz/mail-sync/compose.yml logs --tail 30
```

새 설치에서는 `node src/setup.mjs identity`로 생성된 공개키만 출력한 뒤
Buzz 관리자 CLI의 `add-member`로 회원 등록하고 `node src/setup.mjs relay`로
채널과 프로필을 만듭니다. 비밀키를 출력하거나 기존 관리자 키를 복사하지 않습니다.
`node src/check-relay.mjs`는 채널 안내를 한 번 게시하고 동일 서명 이벤트가
실제 relay에서 조회되는지 검증합니다. 재실행해도 같은 안내 이벤트를 사용합니다.

Docker 재시작 시 `unless-stopped`로 재개됩니다. Mac이 꺼지거나 잠들거나
Docker가 종료되면 수집하지 못하며, 재개 후 저장된 UID부터 이어서 확인합니다.

```sh
# 중지 (데이터 보존)
docker compose -f /Users/kovar/Servers/buzz/mail-sync/compose.yml stop
# 재개
docker compose -f /Users/kovar/Servers/buzz/mail-sync/compose.yml start
```

앱 비밀번호를 폐기하려면 해당 메일 서비스의 보안 설정에서 해지합니다.
DB·암호화 키·커서를 함께 백업해야 하며 volume을 삭제하지 마세요. 메시지와
게시 대기열을 같은 SQLite 트랜잭션으로 저장하고, relay 게시 확인 후에만
완료 표시합니다. 네트워크 응답 유실 시 같은 서명 이벤트 ID로 재시도합니다.

## 검증

```sh
npm ci --ignore-scripts
npm test
npm audit --omit=dev
```

테스트는 실제 collector/store/drain 코드에 연결됩니다. 읽기 전용 선택,
3개월 날짜, self-mail 중복, UIDVALIDITY 변경, 계정 중지 중 비동기 응답,
부분 배치, 트랜잭션 실패, 게시 실패 재시도를 검사합니다.
실제 Gmail/Naver 연결 검증은 사용자가 로컬 설정 화면에서 인증한 후 진행합니다.

## 코바 업무 자동 분류

기존 메일과 새로 수집한 코바 메일을 제목·최신 본문·발신/수신 방향에 따른
규칙으로 분류합니다. `classify.mjs`가 판정하며 `preview-routing.mjs`로 게시 없이
예상 결과를 볼 수 있습니다. 이메일의 지시문을 코드나 도구 명령으로 실행하지 않습니다.

웹 주문, 견적요청, 견적관리, 공급처오퍼, 주문·발주, 배송입고는 기존 업무 채널에
요약과 Buzz 원본/Gmail 링크를 게시합니다. 운영관리와 정보알림은 별도 채널을
사용합니다. 원문 미수집·다른 회사 문서·근거 부족은 공동메일분류로 보냅니다.
자동 접수확인·회신·전달본을 구분하고 확정되지 않은 거래 방향은 확인 필요로
표시합니다. 보안 알림의 제목·본문은 분류 게시물에 복사하지 않습니다.

원본 메일을 게시한 뒤 분류를 진행합니다. 분류 결과와 서명 이벤트를 SQLite에
먼저 저장하고 게시 성공 후 완료 처리합니다. 계정+원본 수집 키당 한 번만
분류하며 재시작·응답 유실 시 동일 이벤트로 재시도합니다. 수집 루프가 이후의
새 메일도 자동 처리합니다. 분류 오류는 별도 상태에 저장하며 기존 메일 수집은
계속됩니다. 설정 화면에서 분류 게시 건수와 남은 건수를 확인할 수 있습니다.

초기 확인 대상의 명확한 제목/본문 패턴을 보완해 재분류한 경우 이전 게시물을
`classification_refinements`에 보존합니다. 최종 채널 게시가 성공한 뒤 기존
확인 글의 답글에 해결 표시와 최종 위치를 남깁니다. 이 과정도 중단 후 재시도됩니다.

PDF 내용 추출, 견적/오퍼/발주 자동 연결, FedEx API, 미응답 리마인드는 아직
구현되어 있지 않습니다. 분류 결과는 확정 거래 원장이 아니며 견적 발행·수주·
입금·판매 확정을 대신하지 않습니다. 판매기록 채널로 자동 매출을 만들지 않습니다.
