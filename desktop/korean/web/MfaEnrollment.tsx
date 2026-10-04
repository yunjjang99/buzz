import { useId, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useLocale } from "../runtime/locale";
import type { MfaChallenge, MfaConfirmation } from "./login-api";

/** Enrollment secrets stay in component memory and are rendered without third-party QR services. */
export function MfaEnrollment({
  enrollment,
  busy,
  onConfirm,
  onCancel,
}: {
  enrollment: MfaChallenge;
  busy: boolean;
  onConfirm(proof: MfaConfirmation): Promise<void>;
  onCancel(): void;
}) {
  const language = useLocale();
  const t = (ko: string, en: string) => (language === "ko" ? ko : en);
  const heading = useId();
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !saved) return;
    try {
      await onConfirm({
        mfaChallenge: enrollment.challenge,
        mfaCode: code,
        recoverySaved: true,
      });
    } finally {
      setCode("");
    }
  }
  return (
    <form className="account-form" aria-labelledby={heading} onSubmit={submit}>
      <h3 id={heading}>
        {t("관리자 2단계 인증 등록", "Set up administrator MFA")}
      </h3>
      <p>
        {t(
          "인증 앱에서 QR 코드를 스캔하거나 아래 설정 키를 직접 입력하세요. 등록은 10분 안에 완료해 주세요.",
          "Scan the QR code in your authenticator app or enter the setup key below. Complete setup within 10 minutes.",
        )}
      </p>
      <div
        role="img"
        aria-label={t("인증 앱 등록 QR 코드", "Authenticator setup QR code")}
      >
        <QRCodeSVG
          value={enrollment.uri}
          size={192}
          marginSize={4}
          aria-hidden="true"
        />
      </div>
      <label>
        {t("설정 키", "Setup key")}
        <input
          value={enrollment.secret}
          readOnly
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p>
        {t(
          "휴대폰을 잃어버리면 비밀번호와 일회용 복구 코드로 로그인할 수 있습니다. 아래 코드를 안전한 곳에 저장하세요. 이 화면을 닫으면 다시 표시하지 않습니다.",
          "If you lose your phone, sign in with your password and a single-use recovery code. Save these codes securely; they will not be shown again after closing this screen.",
        )}
      </p>
      <ul aria-label={t("일회용 복구 코드", "Single-use recovery codes")}>
        {enrollment.recoveryCodes.map((value) => (
          <li key={value}>
            <code style={{ overflowWrap: "anywhere" }}>{value}</code>
          </li>
        ))}
      </ul>
      <label className="remember-account">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          disabled={busy}
          required
        />
        {t(
          "복구 코드를 안전한 곳에 저장했습니다",
          "I saved the recovery codes securely",
        )}
      </label>
      <label>
        {t("인증 앱의 6자리 코드", "6-digit authenticator code")}
        <input
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          disabled={busy}
        />
      </label>
      <button className="primary" type="submit" disabled={busy || !saved}>
        {t("등록 완료", "Complete setup")}
      </button>
      <button type="button" disabled={busy} onClick={onCancel}>
        {t("취소하고 다시 로그인", "Cancel and sign in again")}
      </button>
    </form>
  );
}
