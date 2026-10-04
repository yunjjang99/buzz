import { decrypt } from "nostr-tools/nip49";
import {
  finalizeEvent,
  getPublicKey,
  type EventTemplate,
} from "nostr-tools/pure";
import { assertNoKeys, KINDS, validateBackup } from "./protocol";

let secret: Uint8Array | null = null;
self.onmessage = (
  message: MessageEvent<{
    id: number;
    operation: string;
    backup?: string;
    password?: string;
    template?: EventTemplate;
  }>,
) => {
  const { id, operation } = message.data;
  try {
    if (operation === "unlock") {
      if (secret) throw new Error("already-unlocked");
      secret = decrypt(
        validateBackup(message.data.backup ?? ""),
        message.data.password ?? "",
      );
      self.postMessage({ id, result: getPublicKey(secret) });
    } else if (operation === "sign" && secret && message.data.template) {
      const template = message.data.template;
      if (template.kind !== KINDS.auth && template.kind !== KINDS.message)
        throw new Error("unsupported-operation");
      assertNoKeys(template.content);
      self.postMessage({ id, result: finalizeEvent(template, secret) });
    } else throw new Error("locked");
  } catch {
    self.postMessage({
      id,
      error: operation === "unlock" ? "backup-unlock-failed" : "sign-failed",
    });
  }
};
