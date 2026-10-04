import { validateBackup } from "./protocol";
import { validPublicKey } from "./signer";

const STORAGE_KEY = "buzz-korean-web.account.v1";
export interface SavedAccount {
  version: 1;
  relay: string;
  pubkey: string;
  backup: string;
}

/** Read one encrypted identity scoped to the current workspace. */
export function readAccount(relay: string): SavedAccount | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    if (raw.length > 1024) throw new Error("invalid-account");
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.relay !== relay)
      throw new Error("invalid-account");
    return {
      version: 1,
      relay,
      pubkey: validPublicKey(value.pubkey),
      backup: validateBackup(value.backup),
    };
  } catch {
    throw new Error("saved-account-invalid");
  }
}

/** Atomically persist only the encrypted backup after a successful local unlock. */
export function saveAccount(
  relay: string,
  pubkey: string,
  backup: string,
): SavedAccount {
  const value: SavedAccount = {
    version: 1,
    relay,
    pubkey: validPublicKey(pubkey),
    backup: validateBackup(backup),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  return value;
}

/** Remove the device copy without changing the relay identity or membership. */
export function forgetAccount(): void {
  localStorage.removeItem(STORAGE_KEY);
}
