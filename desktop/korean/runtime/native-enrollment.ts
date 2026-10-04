import type { Identity } from "@/shared/api/types";
import type { BackupVerification } from "@/shared/api/tauriIdentity";
type NativeOps = {
  verify(backup: string, password: string): Promise<BackupVerification>;
  import(backup: string, password: string): Promise<Identity>;
};
/** Verify the account binding before any native key mutation, preserving existing identities. */
export async function enrollNativeIdentity(
  current: Identity,
  expected: string,
  backup: string,
  password: string,
  manage: boolean,
  active: () => void,
  ops: NativeOps,
  unusedInitialKey = false,
): Promise<void> {
  const verified = await ops.verify(backup, password);
  active();
  if (verified.pubkey !== expected)
    throw new Error("계정 백업 검증에 실패했습니다.");
  if (manage && !verified.matchesCurrentIdentity)
    throw new Error("현재 앱 계정과 같은 아이디로 로그인해 주세요.");
  if (manage) return;
  if (
    !verified.matchesCurrentIdentity &&
    current.storage !== "ephemeral" &&
    !current.lost &&
    !unusedInitialKey
  )
    throw new Error(
      "기존 앱 계정을 보호하기 위해 연결을 중단했습니다. 기존 계정으로 계속 사용하거나 앱에서 로그아웃한 뒤 다시 로그인하세요.",
    );
  if (
    !verified.matchesCurrentIdentity ||
    current.storage === "ephemeral" ||
    current.lost
  ) {
    const imported = await ops.import(backup, password);
    active();
    if (imported.pubkey !== expected)
      throw new Error("앱 계정 연결에 실패했습니다.");
  }
}
