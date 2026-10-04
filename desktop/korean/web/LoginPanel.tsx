import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../runtime/locale";
import { errorText } from "./copy";
import { loginApi, type WebAccount } from "./login-api";

/** Primary employee sign-in, with one-time owner migration when the service is empty. */
export function LoginPanel({
  onLogin,
  restore = true,
}: {
  onLogin(account: WebAccount): Promise<void>;
  restore?: boolean;
}) {
  const restoreAllowed = useRef(restore);
  restoreAllowed.current = restore;
  const callback = useRef(onLogin);
  callback.current = onLogin;
  const language = useLocale();
  const t = (ko: string, en: string) => (language === "ko" ? ko : en);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await loginApi<{ configured: boolean }>("status");
        if (!active) return;
        setConfigured(status.configured);
        if (status.configured) {
          try {
            const account = await loginApi<WebAccount>("session");
            if (active && restoreAllowed.current)
              await callback.current(account);
          } catch (failure) {
            if (
              active &&
              (!(failure instanceof Error) ||
                failure.message !== "login-required")
            )
              setError(failure);
          }
        }
      } catch (failure) {
        if (active) setError(failure);
      } finally {
        if (active) setRestoring(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let account: WebAccount;
      if (setup) {
        if (!file || file.size > 4096)
          throw new Error("encrypted-backup-required");
        account = await loginApi<WebAccount>("setup", {
          username,
          password,
          name,
          backup: await file.text(),
          backupPassword,
        });
      } else
        account = await loginApi<WebAccount>("login", {
          username,
          password,
          remember,
        });
      setPassword("");
      setBackupPassword("");
      setFile(null);
      await onLogin(account);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setPassword("");
      setBackupPassword("");
    }
  }
  return (
    <div className="employee-login">
      <p className="login-description">
        {t(
          "직원 아이디로 로그인하면 기존 대화가 이어집니다.",
          "Sign in with your employee ID to continue your conversations.",
        )}
      </p>
      {restoring ? (
        <p role="status">
          {t("로그인 상태 확인 중…", "Checking your session…")}
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {setup && (
            <p className="help">
              {t(
                "최초 한 번만 기존 소유자 계정을 연결합니다. 이후 직원 계정은 관리 화면에서 발급할 수 있습니다.",
                "Connect the existing owner account once. Then issue employee accounts from account management.",
              )}
            </p>
          )}
          <label htmlFor="employee-id">{t("아이디", "Employee ID")}</label>
          <input
            id="employee-id"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}"
            value={username}
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
          />
          {setup && (
            <p className="help">
              {t(
                "영문·숫자·점·밑줄·하이픈으로 3~32자",
                "3–32 letters, numbers, dots, underscores or hyphens",
              )}
            </p>
          )}
          <label htmlFor="employee-password">
            {setup
              ? t("새 로그인 비밀번호", "New login password")
              : t("비밀번호", "Password")}
          </label>
          <input
            id="employee-password"
            name="password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            required
            minLength={setup ? 12 : 1}
            maxLength={128}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          {setup ? (
            <>
              <p className="help">
                {t(
                  "로그인 비밀번호는 12자 이상으로 정하세요.",
                  "Choose a login password with at least 12 characters.",
                )}
              </p>
              <label htmlFor="owner-name">
                {t("관리자 이름", "Administrator name")}
              </label>
              <input
                id="owner-name"
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <label htmlFor="owner-backup">
                {t("기존 소유자 계정 백업", "Existing owner account backup")}
              </label>
              <input
                id="owner-backup"
                type="file"
                accept=".ncryptsec,.txt"
                required
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <label htmlFor="owner-backup-password">
                {t("기존 백업 비밀번호", "Existing backup password")}
              </label>
              <input
                id="owner-backup-password"
                type="password"
                autoComplete="off"
                required
                value={backupPassword}
                disabled={busy}
                onChange={(event) => setBackupPassword(event.target.value)}
              />
            </>
          ) : (
            <label className="remember-account">
              <input
                type="checkbox"
                checked={remember}
                disabled={busy}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>
                {t(
                  "이 기기에서 로그인 상태 유지",
                  "Keep me signed in on this device",
                )}
              </span>
            </label>
          )}
          <button
            className="primary"
            type="submit"
            disabled={busy || configured === null}
          >
            {busy
              ? t("로그인하는 중…", "Signing in…")
              : setup
                ? t("관리자 계정 연결", "Connect administrator account")
                : t("로그인", "Sign in")}
          </button>
        </form>
      )}
      {configured === false && !restoring && (
        <button
          type="button"
          className="setup-toggle"
          disabled={busy}
          onClick={() => {
            setSetup(!setup);
            setError(null);
            setPassword("");
            setBackupPassword("");
          }}
        >
          {setup
            ? t("로그인으로 돌아가기", "Back to sign in")
            : t("관리자 최초 설정", "First-time administrator setup")}
        </button>
      )}
      {configured !== false && !setup && (
        <p className="help">
          {t(
            "계정이 없거나 비밀번호를 잊으셨다면 관리자에게 계정 발급·초기화를 요청하세요.",
            "Ask your administrator to issue an account or reset your password.",
          )}
        </p>
      )}
      <p className="privacy">
        {t(
          "홈서버가 계정 키를 암호화해 보관합니다. 비밀번호는 해시로 저장하며, 대화 권한은 기존 Buzz 서버가 확인합니다.",
          "The home server stores encrypted account keys and password hashes. Your Buzz relay continues to enforce conversation access.",
        )}
      </p>
      {Boolean(error) && (
        <p className="error" role="alert">
          {errorText(error, language)}
        </p>
      )}
    </div>
  );
}
