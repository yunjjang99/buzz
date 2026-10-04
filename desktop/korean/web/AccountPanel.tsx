import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocale } from "../runtime/locale";
import { errorText } from "./copy";
import { loginApi, type WebAccount } from "./login-api";
type ChannelChoice = { id: string; name: string };

/** Employee password changes and owner-issued accounts keep their stable Buzz identity. */
export function AccountPanel({
  account,
  onChange,
  onClose,
  employeesOnly = false,
}: {
  account: WebAccount;
  onChange(account: WebAccount): void;
  onClose(): void;
  employeesOnly?: boolean;
}) {
  const language = useLocale();
  const t = (ko: string, en: string) => (language === "ko" ? ko : en);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [watchVersion, setWatchVersion] = useState(0);
  const [accounts, setAccounts] = useState<WebAccount[]>([]);
  const [channels, setChannels] = useState<ChannelChoice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [resetTarget, setResetTarget] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [importExisting, setImportExisting] = useState(false);
  const [backup, setBackup] = useState<File | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const pending = useRef(false);
  const requestVersion = useRef(0);
  const watch = useRef(watchVersion);
  watch.current = watchVersion;
  const alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (employeesOnly) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [employeesOnly]);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const records = await loginApi<WebAccount[]>("admin/accounts");
    if (!alive.current || version !== requestVersion.current) return;
    setAccounts(records);
    pending.current = records.some((item) => item.status === "pending");
  }, []);
  useEffect(() => {
    const activeWatch = watchVersion;
    alive.current = true;
    if (account.role !== "admin")
      return () => {
        alive.current = false;
      };
    void Promise.all([
      refresh(),
      loginApi<ChannelChoice[]>("admin/channels").then((records) => {
        if (alive.current && watch.current === activeWatch)
          setChannels(records);
      }),
    ]).catch((failure) => {
      if (alive.current) setError(failure);
    });
    let attempts = 0;
    let running = false;
    const timer = setInterval(() => {
      if (++attempts > 30) {
        clearInterval(timer);
        return;
      }
      if (!pending.current || running) return;
      running = true;
      void refresh()
        .catch((failure) => {
          if (alive.current) setError(failure);
        })
        .finally(() => {
          running = false;
        });
    }, 2000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [account.role, refresh, watchVersion]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await work();
    } catch (failure) {
      if (alive.current) setError(failure);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function changePassword(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      if (newPassword !== confirmation)
        throw new Error("password-confirmation-mismatch");
      const updated = await loginApi<WebAccount>("password", {
        currentPassword,
        password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      if (!alive.current) return;
      onChange(updated);
      setNotice(
        t(
          "비밀번호를 변경했습니다. 기존 대화와 계정은 유지됩니다.",
          "Password changed. Your account and conversations are unchanged.",
        ),
      );
    });
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      if (importExisting && (!backup || backup.size > 4096))
        throw new Error("encrypted-backup-required");
      await loginApi<WebAccount>("admin/create", {
        username,
        name,
        password: temporaryPassword,
        channels: selected,
        ...(importExisting
          ? { backup: await (backup as File).text(), backupPassword }
          : {}),
      });
      setTemporaryPassword("");
      setBackupPassword("");
      setBackup(null);
      setUsername("");
      setName("");
      await refresh();
      setWatchVersion((version) => version + 1);
      setNotice(
        t(
          "계정 발급을 요청했습니다. ‘사용 가능’이 되면 직원에게 아이디와 초기 비밀번호를 전달하세요.",
          "Account requested. Give the employee their ID and temporary password once it is ready.",
        ),
      );
    });
  }
  const content = (
    <section className="account-panel">
      <div className="account-panel-heading">
        {!employeesOnly && (
          <h2 id="account-title">
            {account.mustChangePassword
              ? t("초기 비밀번호 변경", "Change your temporary password")
              : t("계정 관리", "Account management")}
          </h2>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={
            employeesOnly
              ? t("관리자 다시 인증", "Sign in again")
              : t("계정 관리 닫기", "Close account management")
          }
        >
          {employeesOnly
            ? t("관리자 다시 인증", "Sign in again")
            : t("닫기", "Close")}
        </button>
      </div>
      <p>
        {account.name} · {account.username}
      </p>
      {Boolean(error) && (
        <p className="error" role="alert">
          {errorText(error, language)}
        </p>
      )}
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {(!employeesOnly || account.mustChangePassword) && (
        <form onSubmit={changePassword} className="account-form">
          <h3>{t("내 비밀번호 변경", "Change my password")}</h3>
          {account.mustChangePassword && (
            <p className="help">
              {t(
                "메시지를 보내기 전에 본인만 아는 비밀번호로 변경하세요. 기존 대화는 그대로 불러옵니다.",
                "Choose your own password before sending messages. Existing conversations remain available.",
              )}
            </p>
          )}
          <label htmlFor="current-login-password">
            {t("현재 비밀번호", "Current password")}
          </label>
          <input
            id="current-login-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={busy}
          />
          <label htmlFor="new-login-password">
            {t("새 비밀번호", "New password")}
          </label>
          <input
            id="new-login-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={busy}
          />
          <label htmlFor="confirm-login-password">
            {t("새 비밀번호 확인", "Confirm new password")}
          </label>
          <input
            id="confirm-login-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
          />
          <p className="help">
            {t(
              "12자 이상 · 변경 시 다른 기기의 로그인은 만료됩니다.",
              "At least 12 characters. Other devices will need to sign in again.",
            )}
          </p>
          <button className="primary" type="submit" disabled={busy}>
            {t("비밀번호 변경", "Change password")}
          </button>
        </form>
      )}
      {account.role === "admin" && !account.mustChangePassword && (
        <>
          <form onSubmit={create} className="account-form">
            <h3>{t("직원 계정 발급", "Issue employee account")}</h3>
            <label htmlFor="new-employee-id">
              {t("직원 아이디", "New employee ID")}
            </label>
            <input
              id="new-employee-id"
              required
              minLength={3}
              maxLength={254}
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
            />
            <label htmlFor="new-employee-name">
              {t("직원 이름", "Employee name")}
            </label>
            <input
              id="new-employee-name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
            <label htmlFor="temporary-password">
              {t("초기 비밀번호", "Temporary password")}
            </label>
            <input
              id="temporary-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              disabled={busy}
            />
            <fieldset disabled={busy}>
              <legend>{t("참여할 채널", "Channels to join")}</legend>
              {channels.length ? (
                channels.map((channel) => (
                  <label className="remember-account" key={channel.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(channel.id)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, channel.id]
                            : selected.filter((id) => id !== channel.id),
                        )
                      }
                    />
                    <span>{channel.name}</span>
                  </label>
                ))
              ) : (
                <p className="help">
                  {t(
                    "선택할 채널이 없습니다. 기존 Buzz 앱에서 채널을 확인하세요.",
                    "No channels available. Check your channels in the Buzz app.",
                  )}
                </p>
              )}
            </fieldset>
            <label className="remember-account">
              <input
                type="checkbox"
                checked={importExisting}
                onChange={(event) => setImportExisting(event.target.checked)}
                disabled={busy}
              />
              <span>
                {t(
                  "기존 직원 Buzz 계정 연결",
                  "Connect an existing employee Buzz account",
                )}
              </span>
            </label>
            {importExisting && (
              <>
                <p className="help">
                  {t(
                    "기존 계정 백업을 연결하면 이전 대화·채널·프로필이 유지됩니다.",
                    "Importing the existing identity keeps its previous conversations, channels and profile.",
                  )}
                </p>
                <label htmlFor="employee-account-backup">
                  {t("직원 계정 백업 파일", "Employee account backup file")}
                </label>
                <input
                  id="employee-account-backup"
                  type="file"
                  accept=".ncryptsec,.txt"
                  required
                  onChange={(event) =>
                    setBackup(event.target.files?.[0] ?? null)
                  }
                  disabled={busy}
                />
                <label htmlFor="employee-backup-password">
                  {t("직원 백업 비밀번호", "Employee backup password")}
                </label>
                <input
                  id="employee-backup-password"
                  type="password"
                  autoComplete="off"
                  required
                  value={backupPassword}
                  onChange={(event) => setBackupPassword(event.target.value)}
                  disabled={busy}
                />
              </>
            )}
            <button className="primary" type="submit" disabled={busy}>
              {t("직원 계정 만들기", "Create employee account")}
            </button>
          </form>
          <div className="account-form">
            <div className="account-panel-heading">
              <h3>{t("직원 계정 목록", "Employee accounts")}</h3>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(refresh)}
              >
                {t("목록 새로고침", "Refresh accounts")}
              </button>
            </div>
            {accounts.map((item) => (
              <div className="employee-row" key={item.username}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.username} ·{" "}
                    {item.status === "ready"
                      ? t("사용 가능", "Ready")
                      : item.status === "failed"
                        ? t("등록 실패", "Registration failed")
                        : t("채널 등록 중…", "Registering channels…")}
                  </span>
                </div>
                {item.status === "failed" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await loginApi("admin/retry", {
                          username: item.username,
                        });
                        await refresh();
                        setWatchVersion((version) => version + 1);
                      })
                    }
                  >
                    {t("등록 재시도", "Retry registration")}
                  </button>
                )}
                {item.role !== "admin" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setResetTarget(item.username);
                      setResetPassword("");
                    }}
                  >
                    {t("비밀번호 초기화", "Reset password")}
                  </button>
                )}
              </div>
            ))}
          </div>
          {resetTarget && (
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await loginApi("admin/reset", {
                    username: resetTarget,
                    password: resetPassword,
                  });
                  setResetPassword("");
                  setResetTarget("");
                  setNotice(
                    t(
                      "초기 비밀번호로 변경했습니다. 직원의 기존 계정과 대화는 유지됩니다.",
                      "Password reset. The employee's identity and conversations are unchanged.",
                    ),
                  );
                });
              }}
            >
              <h3>
                {resetTarget} · {t("비밀번호 초기화", "Reset password")}
              </h3>
              <label htmlFor="reset-password">
                {t("새 초기 비밀번호", "New temporary password")}
              </label>
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                disabled={busy}
              />
              <button type="submit" className="primary" disabled={busy}>
                {t("초기화 적용", "Apply reset")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
  return employeesOnly ? (
    <section
      className="employee-account-page"
      aria-label={t(
        "직원 계정 발급 및 목록",
        "Employee account administration",
      )}
    >
      {content}
    </section>
  ) : (
    <dialog
      ref={dialog}
      className="account-overlay"
      aria-labelledby="account-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {content}
    </dialog>
  );
}
