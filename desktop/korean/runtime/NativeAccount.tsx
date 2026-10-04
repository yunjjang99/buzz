import { readMachineOnboardingCompletion } from "@/features/onboarding/machineOnboarding";
import { enrollNativeIdentity } from "./native-enrollment";
import "./native-account.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getIdentity,
  importIdentity,
  verifyNcryptsecBackup,
  createNcryptsecBackup,
} from "@/shared/api/tauriIdentity";
import { useCommunities } from "@/features/communities/useCommunities";
import { invokeTauri } from "@/shared/api/tauri";
import { AccountPanel } from "../web/AccountPanel";
import type { WebAccount } from "../web/login-api";
import { nativeApi, type NativeLogin } from "./native-account";

/** Full native client enrollment, using the upstream Rust NIP-49/keyring path. */
export function NativeAccount({
  onConnected,
  manage = false,
}: {
  onConnected?: (pubkey: string) => void | Promise<void>;
  manage?: boolean;
}) {
  const communities = useCommunities();
  const [open, setOpen] = useState(!manage);
  const [account, setAccount] = useState<WebAccount | null>(null);
  const [panel, setPanel] = useState(false);
  const [setup, setSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const requireActive = () => {
    if (!alive.current) throw new Error("계정 연결이 취소되었습니다.");
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const current = await getIdentity();
      requireActive();
      if (current.locked || current.resetFailed)
        throw new Error("앱 보안 저장소를 먼저 잠금 해제하거나 복구해 주세요.");
      let next: WebAccount;
      if (setup) {
        const backup = await createNcryptsecBackup(password);
        next = await nativeApi<WebAccount>("setup", {
          username,
          password,
          name,
          backup,
          backupPassword: password,
        });
        if (next.pubkey !== current.pubkey)
          throw new Error("계정이 일치하지 않습니다.");
      } else {
        const result = await nativeApi<NativeLogin>("desktop/login", {
          username,
          password,
          ...(mustChange ? { newPassword } : {}),
        });
        requireActive();
        next = result.account;
        if (manage && next.pubkey !== current.pubkey) {
          await nativeApi("logout", {});
          throw new Error(
            "현재 앱 계정과 같은 아이디로 로그인해 주세요. 다른 계정은 앱에서 로그아웃한 뒤 연결하세요.",
          );
        }
        const unlock = mustChange ? newPassword : password;
        await enrollNativeIdentity(
          current,
          next.pubkey,
          result.backup,
          unlock,
          manage,
          requireActive,
          { verify: verifyNcryptsecBackup, import: importIdentity },
          import.meta.env.VITE_BUZZ_EMPLOYEE_APP === "1" &&
            !manage &&
            communities.communities.length === 0 &&
            !readMachineOnboardingCompletion(current.pubkey),
        );
      }
      requireActive();
      setAccount(next);
      setPassword("");
      setNewPassword("");
      if (manage) {
        setOpen(false);
        setPanel(true);
        return;
      }
      await invokeTauri("apply_workspace", {
        relayUrl: "wss://buzz.kovar.kr",
        nsec: null,
        reposDir: null,
        agentManagedProfiles: false,
      });
      requireActive();
      const id = communities.addCommunity({
        id: crypto.randomUUID(),
        name: "KOVAR",
        relayUrl: "wss://buzz.kovar.kr",
        pubkey: next.pubkey,
        addedAt: new Date().toISOString(),
      });
      communities.switchCommunity(id);
      await onConnected?.(next.pubkey);
    } catch (cause) {
      if (!alive.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message === "password-change-required") {
        setMustChange(true);
        setError("첫 로그인입니다. 새 비밀번호를 12자 이상으로 입력해 주세요.");
      } else
        setError(
          (
            {
              "invalid-login": "아이디 또는 비밀번호가 올바르지 않습니다.",
              "owner-backup-required":
                "홈서버 소유자 계정으로 앱에 접속한 뒤 최초 설정을 해주세요.",
              "already-configured":
                "관리자 설정이 완료되어 있습니다. 아이디로 로그인해 주세요.",
              "invalid-origin":
                "이 기능은 설치된 Buzz 앱에서 사용할 수 있습니다.",
              "account-provisioning":
                "직원 계정 등록이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
            } as Record<string, string>
          )[message] ?? message,
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="w-full max-w-sm text-left">
      {manage && (
        <button
          type="button"
          className="m-2 rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            if (account) setPanel(true);
            else setOpen((value) => !value);
          }}
        >
          직원 계정 · 아이디 로그인
        </button>
      )}
      {open && (
        <form
          onSubmit={submit}
          className="flex flex-col gap-3 rounded-lg border bg-background p-5 text-foreground"
          aria-label="앱 아이디 로그인"
        >
          <h2 className="text-lg font-semibold">
            {setup ? "관리자 최초 설정" : "회사 계정으로 로그인"}
          </h2>
          <p className="text-sm text-muted-foreground">
            buzz.kovar.kr · 웹과 같은 계정으로 대화를 이어갑니다.
          </p>
          <label className="text-sm">
            아이디
            <input
              className="mt-1 w-full rounded border bg-background p-2"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="text-sm">
            {setup ? "새 로그인 비밀번호 (12자 이상)" : "비밀번호"}
            <input
              className="mt-1 w-full rounded border bg-background p-2"
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 12 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          {mustChange && !setup && (
            <label className="text-sm">
              새 비밀번호 (12자 이상)
              <input
                className="mt-1 w-full rounded border bg-background p-2"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={busy}
              />
            </label>
          )}
          {setup && (
            <>
              <label className="text-sm">
                관리자 이름
                <input
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <p className="text-sm">
                현재 앱의 홈서버 소유자 계정을 연결합니다. 백업 파일을 따로
                준비할 필요가 없습니다.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            className="rounded bg-primary p-2 text-sm text-primary-foreground"
            disabled={busy}
            type="submit"
          >
            {busy ? "계정 연결 중…" : setup ? "관리자 계정 연결" : "로그인"}
          </button>
          <button
            className="text-sm underline"
            disabled={busy}
            type="button"
            onClick={() => {
              setSetup((value) => !value);
              setError("");
              setPassword("");
              setNewPassword("");
              setMustChange(false);
            }}
          >
            {setup ? "아이디 로그인으로 돌아가기" : "소유자 관리자 최초 설정"}
          </button>
        </form>
      )}
      {panel && account && (
        <AccountPanel
          account={account}
          onChange={setAccount}
          onClose={() => {
            setPanel(false);
            setAccount(null);
          }}
        />
      )}
    </div>
  );
}
