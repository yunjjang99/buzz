export const copy = {
  ko: {
    title: "웹 메신저",
    subtitle: "팀의 대화, 어느 기기에서든.",
    welcome: "Buzz에 오신 것을 환영합니다",
    intro: "설치 없이 기존 계정으로 팀의 대화를 이어가세요.",
    backup: "암호화 계정 백업",
    backupHelp:
      "Mac 앱의 설정 → 프로필 → 계정 정보에서 내보낸 .ncryptsec 파일을 선택하세요.",
    password: "백업 비밀번호",
    unlock: "백업으로 로그인",
    extension: "브라우저 서명 확장으로 로그인",
    savedAccount: "이 기기에 연결된 계정",
    savedHelp: "파일을 다시 선택할 필요 없이 백업 비밀번호로 로그인하세요.",
    remember: "이 기기에 암호화된 계정 저장",
    rememberHelp:
      "개인 기기에서 선택하세요. 다음부터 비밀번호만 입력하면 됩니다.",
    signIn: "로그인",
    otherAccount: "다른 계정 연결",
    backToSaved: "저장된 계정으로 돌아가기",
    forget: "기기에 저장된 계정 지우기",
    privacy:
      "비밀번호와 복호화한 키는 저장하지 않습니다. 계정 저장을 선택하면 암호화된 백업만 이 기기에 보관합니다. 로그아웃하면 계정이 잠깁니다.",
    channels: "채널",
    direct: "개인 대화",
    loading: "불러오는 중…",
    connecting: "로그인하는 중…",
    connected: "연결됨",
    disconnected: "연결 끊김",
    reconnect: "다시 연결",
    logout: "로그아웃",
    refresh: "채널 새로고침",
    send: "메시지 보내기",
    attach: "파일 첨부",
    attachments: "첨부 파일",
    removeFile: "첨부 삭제",
    fileLimit: "최대 5개 · 합계 100 MB · 붙여넣기 또는 끌어놓기",
    uploading: "업로드 중",
    cancelUpload: "업로드 취소",
    download: "다운로드",
    downloading: "다운로드 중…",
    input: "메시지 입력",
    placeholder: "팀에 메시지를 보내세요…",
    empty: "아직 메시지가 없습니다. 첫 대화를 시작하세요.",
    noChannels:
      "참여 중인 채널이 없습니다. 관리자의 초대로 먼저 워크스페이스에 참여하세요.",
    choose: "채널을 선택하세요",
    reply: "답장",
    cancel: "답장 취소",
    deleted: "삭제된 메시지",
    edited: "수정됨",
    history: "최근 메시지 200개 · 실시간 수신",
    newLine: "Enter 전송 · Shift+Enter 줄바꿈",
    members: "참여한 대화",
    retry: "같은 메시지 다시 전송",
    outbox:
      "전송 결과를 확인하지 못한 메시지가 남아 있습니다. 다시 전송하면 같은 ID를 사용해 중복을 방지합니다.",
    readOnly: "이 채널 유형의 작성은 데스크톱 앱에서 지원합니다.",
    language: "언어",
    error: "작업을 완료하지 못했습니다",
    identity: "내 계정",
    thread: "답글 대화",
    closeThread: "답글 대화 닫기",
    back: "채널 목록",
    limitations:
      "채널·개인 대화·답글·파일 첨부를 지원합니다. 음성, 에이전트 관리 등은 데스크톱 앱을 사용하세요.",
  },
  en: {
    title: "Web messenger",
    subtitle: "Your team, wherever you are.",
    welcome: "Welcome to Buzz",
    intro: "Continue your team's conversations with your existing account.",
    backup: "Encrypted account backup",
    backupHelp:
      "Choose the .ncryptsec file exported from Mac Settings → Profile → Identity details.",
    password: "Backup password",
    unlock: "Sign in with backup",
    extension: "Sign in with browser signer",
    savedAccount: "Account connected on this device",
    savedHelp:
      "Sign in with your backup password. No need to choose the file again.",
    remember: "Save encrypted account on this device",
    rememberHelp:
      "Choose this on a personal device. Next time, only your password is needed.",
    signIn: "Sign in",
    otherAccount: "Connect another account",
    backToSaved: "Return to saved account",
    forget: "Remove saved account from device",
    privacy:
      "Your password and decrypted key are never saved. Saving your account keeps only the encrypted backup on this device. Signing out locks your account.",
    channels: "Channels",
    direct: "Direct messages",
    loading: "Loading…",
    connecting: "Signing in…",
    connected: "Connected",
    disconnected: "Disconnected",
    reconnect: "Reconnect",
    logout: "Sign out",
    refresh: "Refresh channels",
    send: "Send message",
    attach: "Attach files",
    attachments: "Attachments",
    removeFile: "Remove attachment",
    fileLimit: "Up to 5 files · 100 MB total · paste or drop files",
    uploading: "Uploading",
    cancelUpload: "Cancel upload",
    download: "Download",
    downloading: "Downloading…",
    input: "Message input",
    placeholder: "Send a message to your team…",
    empty: "No messages yet. Start a conversation.",
    noChannels:
      "No joined channels. First join the workspace using an invitation from your administrator.",
    choose: "Choose a channel",
    reply: "Reply",
    cancel: "Cancel reply",
    deleted: "Deleted message",
    edited: "Edited",
    history: "Latest 200 messages · live updates",
    newLine: "Enter to send · Shift+Enter for a new line",
    members: "Your conversations",
    retry: "Retry the same message",
    outbox:
      "A message has an unconfirmed delivery outcome. Retrying uses the same ID to prevent duplicates.",
    readOnly: "Use the desktop app to write in this channel type.",
    language: "Language",
    error: "Could not complete the operation",
    identity: "My account",
    thread: "Thread",
    closeThread: "Close thread",
    back: "Channel list",
    limitations:
      "Channels, direct messages, replies and attachments are supported. Use the desktop app for voice and agent management.",
  },
};

/** Explain known recovery actions while retaining the actual relay failure reason. */
export function errorText(error: unknown, language: "ko" | "en"): string {
  if (error instanceof Error && error.message === "login-locked") {
    const seconds = (error as Error & { retryAfter?: number }).retryAfter;
    if (
      typeof seconds === "number" &&
      Number.isFinite(seconds) &&
      seconds > 0
    ) {
      const minutes = Math.ceil(seconds / 60);
      return language === "ko"
        ? `로그인 실패가 반복되어 잠겼습니다. 약 ${minutes}분 후 다시 시도해 주세요.`
        : `Login is temporarily locked after repeated failures. Try again in about ${minutes} minute(s).`;
    }
    return language === "ko"
      ? "로그인 실패가 반복되어 잠겼습니다. 잠시 후 다시 시도해 주세요."
      : "Login is temporarily locked after repeated failures. Please try again later.";
  }

  const code =
    error instanceof Error
      ? error.name === "AbortError"
        ? "media-cancelled"
        : error.name === "TimeoutError"
          ? "media-request-failed"
          : error.message
      : "operation-failed";
  const messages: Record<string, [string, string]> = {
    "mfa-required": [
      "관리자 계정입니다. 인증 앱의 코드 또는 일회용 복구 코드를 입력해 주세요.",
      "Enter your authenticator code or a single-use recovery code.",
    ],
    "invalid-mfa": [
      "인증 코드가 올바르지 않거나 이미 사용되었습니다. 인증 앱의 새 코드 또는 사용하지 않은 복구 코드를 입력해 주세요.",
      "The code is invalid or already used. Enter a fresh authenticator code or an unused recovery code.",
    ],
    "mfa-enrollment-expired": [
      "인증 등록이 만료되었거나 변경되었습니다. 다시 로그인하여 새 설정 키로 등록해 주세요.",
      "MFA enrollment expired or changed. Sign in again and use a new setup key.",
    ],
    "too-many-files": [
      "첨부는 모든 대화를 합쳐 최대 5개입니다. 전송하거나 삭제한 뒤 다시 선택하세요.",
      "Select up to 5 files across drafts. Send or remove existing files first.",
    ],
    "file-too-large": [
      "빈 파일은 첨부할 수 없으며, 첨부 합계와 다운로드는 100 MB까지 지원합니다. 릴레이 제한은 더 작을 수 있습니다.",
      "Files must not be empty. Attachments total and downloads are limited to 100 MB; the relay may impose a lower limit.",
    ],
    "media-access-denied": [
      "파일 접근이 거부되었습니다. 로그인과 커뮤니티 권한을 확인하세요.",
      "File access denied. Check your login and community membership.",
    ],
    "file-type-rejected": [
      "릴레이에서 허용하지 않는 파일 형식입니다.",
      "The relay does not allow this file type.",
    ],
    "media-request-failed": [
      "파일을 전송하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.",
      "File transfer failed. Check your connection and retry.",
    ],
    "invalid-media": [
      "파일 주소 또는 무결성을 확인할 수 없습니다.",
      "The file address or integrity could not be verified.",
    ],
    "media-cancelled": [
      "파일 전송을 취소했습니다. 첨부는 유지됩니다.",
      "Transfer cancelled. Your attachments are retained.",
    ],
    "login-service-unavailable": [
      "로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.",
      "The login service is unavailable. Try again shortly.",
    ],
    "invalid-login": [
      "아이디 또는 비밀번호를 확인해 주세요.",
      "Check your ID and password.",
    ],
    "invalid-username": [
      "이메일 주소 또는 영문·숫자·점·밑줄·하이픈으로 3~32자의 아이디를 입력하세요.",
      "Use an email address or a 3–32 character ID with letters, numbers, dots, underscores or hyphens.",
    ],
    "invalid-password": [
      "새 비밀번호는 12~128자로 입력하세요.",
      "Choose a password with 12–128 characters.",
    ],
    "invalid-name": [
      "직원 이름을 80자 이내로 입력하세요.",
      "Enter a name with at most 80 characters.",
    ],
    "username-taken": [
      "이미 발급된 아이디입니다. 계정 목록을 확인하세요.",
      "This ID already exists. Check the account list.",
    ],
    "account-already-exists": [
      "이미 연결된 계정 또는 아이디입니다. 계정 목록을 확인하세요.",
      "The identity or ID is already connected. Check the account list.",
    ],
    "owner-backup-required": [
      "현재 홈서버 소유자의 계정 백업만 최초 연결할 수 있습니다.",
      "Initial setup requires the current home server owner's backup.",
    ],
    "account-provisioning": [
      "채널 등록이 아직 완료되지 않았습니다. 관리자에게 등록 상태 확인을 요청하세요.",
      "Channel registration is not complete. Ask your administrator to check its status.",
    ],
    "login-required": [
      "로그인이 만료되었습니다. 로그아웃한 뒤 다시 로그인하세요.",
      "Your session expired. Sign out and sign in again.",
    ],
    "rate-limited": [
      "요청이 많습니다. 잠시 기다린 뒤 다시 시도하세요.",
      "Too many requests. Wait a moment and try again.",
    ],
    "service-error": [
      "계정 작업을 완료하지 못했습니다. 계정 목록을 새로고침하고 다시 시도하세요.",
      "Could not complete the account operation. Refresh the account list before retrying.",
    ],
    "password-change-required": [
      "계정 관리에서 초기 비밀번호를 변경한 뒤 메시지를 보내세요.",
      "Change your temporary password in account management before sending messages.",
    ],
    "password-confirmation-mismatch": [
      "새 비밀번호와 확인 입력이 다릅니다.",
      "The new password and confirmation do not match.",
    ],
    "password-unchanged": [
      "초기 비밀번호와 다른 새 비밀번호를 정하세요.",
      "Choose a different new password.",
    ],
    "saved-account-invalid": [
      "저장된 계정을 읽을 수 없습니다. 기기에 저장된 계정을 지우고 백업 파일을 다시 연결하세요.",
      "Could not read the saved account. Remove the device copy and reconnect your backup.",
    ],
    "extension-required": [
      "NIP-07 서명 확장이 없으면 암호화 백업으로 로그인하세요.",
      "Use an encrypted backup if no NIP-07 extension is installed.",
    ],
    "backup-unlock-failed": [
      "백업 비밀번호가 다르거나 파일이 손상되었습니다. 다시 선택해 주세요.",
      "Wrong backup password or damaged backup. Try again.",
    ],
    "encrypted-backup-required": [
      "암호화된 .ncryptsec 계정 백업 파일이 필요합니다.",
      "An encrypted .ncryptsec account backup is required.",
    ],
    "unsupported-backup": [
      "이 백업의 암호화 형식 또는 메모리 요구량을 지원하지 않습니다.",
      "Unsupported backup format or memory requirements.",
    ],
    "key-in-message": [
      "계정 키가 포함된 메시지는 전송할 수 없습니다.",
      "Messages containing account keys cannot be sent.",
    ],
  };
  return (
    messages[code]?.[language === "ko" ? 0 : 1] ??
    `${copy[language].error}: ${code}`
  );
}
