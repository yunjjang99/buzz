import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../runtime/locale";
import { errorText } from "./copy";
import { MfaEnrollment } from "./MfaEnrollment";
import {
  loginApi,
  type MfaChallenge,
  type MfaEnrollmentResult,
  type WebAccount,
} from "./login-api";

/** Changing an administrator's factor requires password and an existing one-time proof. */
export function MfaSettings({
  account,
  onChange,
}: {
  account: WebAccount;
  onChange(account: WebAccount): void;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const language = useLocale();
  const t = (ko: string, en: string) => (language === "ko" ? ko : en);
  const [enrollment, setEnrollment] = useState<MfaChallenge | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  async function begin(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await loginApi<MfaEnrollmentResult>("mfa/rotate", {
        password,
        mfaCode: code,
      });
      if (alive.current) setEnrollment(result.mfaEnrollment);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setPassword("");
      setCode("");
    }
  }
  return (
    <section aria-label={t("관리자 MFA 관리", "Administrator MFA management")}>
      <h3>{t("관리자 2단계 인증", "Administrator MFA")}</h3>
      <p>
        {t(
          `남은 복구 코드: ${account.recoveryCodesRemaining ?? 0}개. 인증 앱을 교체하면 기존 코드와 다른 기기의 로그인이 만료됩니다.`,
          `Recovery codes remaining: ${account.recoveryCodesRemaining ?? 0}. Replacing your authenticator invalidates old codes and signs out other devices.`,
        )}
      </p>
      {enrollment ? (
        <MfaEnrollment
          key={enrollment.challenge}
          enrollment={enrollment}
          busy={busy}
          onCancel={() => {
            setEnrollment(null);
            setError(null);
          }}
          onConfirm={async (proof) => {
            setBusy(true);
            setError(null);
            try {
              const next = await loginApi<WebAccount>("mfa/confirm", proof);
              if (!alive.current) return;
              setEnrollment(null);
              onChange(next);
              setNotice(
                t(
                  "새 인증 앱 등록을 완료했습니다.",
                  "Your new authenticator is registered.",
                ),
              );
            } catch (failure) {
              setError(failure);
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <form className="account-form" onSubmit={begin}>
          <label>
            {t("현재 비밀번호 (MFA 변경)", "Current password (MFA change)")}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            {t(
              "현재 인증 코드 또는 복구 코드",
              "Current authenticator or recovery code",
            )}
            <input
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={35}
              disabled={busy}
            />
          </label>
          <p>
            {t(
              "복구 코드로 로그인한 뒤 5분 이내에는 비밀번호만 다시 입력해 인증 앱을 교체할 수 있습니다. 그 외에는 현재 인증 코드가 필요합니다.",
              "For five minutes after a recovery-code login, re-entering your password is enough to replace the authenticator. Otherwise a current code is required.",
            )}
          </p>
          <button disabled={busy} type="submit">
            {t(
              "인증 앱·복구 코드 교체",
              "Replace authenticator and recovery codes",
            )}
          </button>
        </form>
      )}
      {Boolean(error) && (
        <p role="alert" className="error">
          {errorText(error, language)}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
