import { useEffect, useRef, useState } from "react";
import type { Signer } from "./signer";
import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  type Attachment,
} from "./media-protocol";
import { downloadAttachment, saveAttachment, uploadAttachment } from "./media";

export type DraftFile = { id: string; file: File; uploaded?: Attachment };

/** Retain selected files and completed uploads per channel until the message is acknowledged. */
export function useAttachments(identity: Signer | null, relay: string) {
  const drafts = useRef<Record<string, DraftFile[]>>({});
  const [, render] = useState(0);
  const session = useRef(new AbortController());
  const upload = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState("");
  const [downloading, setDownloading] = useState("");
  const downloadBusy = useRef(false);
  const refresh = () => render((version) => version + 1);

  useEffect(() => {
    const scope = new AbortController();
    if (!identity) scope.abort();
    session.current = scope;
    drafts.current = {};
    upload.current = null;
    downloadBusy.current = false;
    setUploading("");
    setDownloading("");
    render((version) => version + 1);
    const close = () => scope.abort();
    window.addEventListener("pagehide", close);
    return () => {
      scope.abort();
      window.removeEventListener("pagehide", close);
    };
  }, [identity]);

  return {
    files: drafts.current,
    uploading,
    downloading,
    add(channel: string, files: File[]) {
      const all = Object.values(drafts.current).flat();
      if (all.length + files.length > MAX_ATTACHMENTS)
        throw new Error("too-many-files");
      if (
        files.some((file) => !file.size || file.size > MAX_FILE_BYTES) ||
        [...all.map((item) => item.file), ...files].reduce(
          (size, file) => size + file.size,
          0,
        ) > MAX_FILE_BYTES
      )
        throw new Error("file-too-large");
      if (files.some((file) => /\.(?:ncryptsec|nsec)$/i.test(file.name)))
        throw new Error("key-in-message");
      drafts.current[channel] = [
        ...(drafts.current[channel] ?? []),
        ...files.map((file) => ({ id: crypto.randomUUID(), file })),
      ];
      refresh();
    },
    remove(channel: string, id: string) {
      drafts.current[channel] = (drafts.current[channel] ?? []).filter(
        (item) => item.id !== id,
      );
      refresh();
    },
    clear(channel: string) {
      delete drafts.current[channel];
      refresh();
    },
    cancel() {
      upload.current?.abort();
    },
    async prepare(channel: string): Promise<Attachment[]> {
      if (!identity) throw new Error("login-required");
      const scope = session.current;
      const operation = new AbortController();
      upload.current = operation;
      const signal = AbortSignal.any([
        scope.signal,
        operation.signal,
        AbortSignal.timeout(120_000),
      ]);
      const files = drafts.current[channel] ?? [];
      try {
        for (const item of files) {
          if (item.uploaded) continue;
          setUploading(item.file.name);
          const result = await uploadAttachment(
            item.file,
            identity,
            relay,
            signal,
          );
          signal.throwIfAborted();
          item.uploaded = result;
          refresh();
        }
        return files.map((item) => item.uploaded as Attachment);
      } finally {
        if (session.current === scope) {
          upload.current = null;
          setUploading("");
        }
      }
    },
    async download(file: Attachment) {
      if (!identity || downloadBusy.current) return;
      const scope = session.current;
      downloadBusy.current = true;
      setDownloading(file.url);
      try {
        const signal = AbortSignal.any([
          scope.signal,
          AbortSignal.timeout(120_000),
        ]);
        const blob = await downloadAttachment(file, identity, relay, signal);
        signal.throwIfAborted();
        saveAttachment(blob, file.filename);
      } finally {
        if (session.current === scope) {
          downloadBusy.current = false;
          setDownloading("");
        }
      }
    },
  };
}
