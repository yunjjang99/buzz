import { useEffect, useRef, useState } from "react";
import type { Event } from "nostr-tools/pure";
import type { Signer } from "../signer";
import { Relay } from "../relay";
import { accountSigner, type WebAccount } from "../login-api";
import {
  foldTasks,
  MAIL_CHANNEL,
  TASK_TAG,
  taskContent,
  type Task,
} from "./model";
import { acknowledged, journal, pending, readHistory } from "./data";

export const relayUrl = ["localhost", "127.0.0.1", "tauri.localhost"].includes(
  location.hostname,
)
  ? "wss://buzz.kovar.kr"
  : `wss://${location.host}`;
/** One authenticated stream overlaps the history scan; each connection owns its async results. */
export function useStrategy(
  account: WebAccount,
  signerFactory: (account: WebAccount) => Signer = accountSigner,
) {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [limited, setLimited] = useState(false);
  const [updated, setUpdated] = useState("");
  const [version, setVersion] = useState(0);
  const [retry, setRetry] = useState<Event | null>(null);
  const [saving, setSaving] = useState(false);
  const connection = useRef<Relay | null>(null);
  const generation = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => {
    void version;
    const current = ++generation.current;
    const isCurrent = () => current === generation.current;
    const identity = signerFactory(account);
    const records = new Map<string, Event>();
    let cancel = () => {};
    let flush: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    const fail = (failure: unknown) => {
      if (isCurrent()) {
        setError(
          `연결 또는 조회에 실패했습니다. 새로고침으로 다시 연결하세요. (${failure instanceof Error ? failure.message : "오류"})`,
        );
        setLoading(false);
      }
    };
    const client = new Relay(relayUrl, identity, fail);
    connection.current = client;
    setEvents([]);
    setError("");
    setLoading(true);
    setLimited(false);
    const publish = () => {
      if (isCurrent()) {
        setEvents([...records.values()]);
        setUpdated(new Date().toISOString());
      }
    };
    void (async () => {
      try {
        setRetry(pending(relayUrl, account.pubkey));
        await client.ready;
        if (!isCurrent()) return;
        // Relay authorization remains authoritative; no shared mail-service credentials are used.
        cancel = client.subscribe(
          {
            kinds: [9],
            "#h": [MAIL_CHANNEL],
            since: Math.floor(Date.now() / 1000) - 5,
            limit: 250,
          },
          (event) => {
            if (!isCurrent()) return;
            if (records.size >= 12000 && !records.has(event.id)) {
              setLimited(true);
              cancel();
              return;
            }
            records.set(event.id, event);
            if (ready && !flush)
              flush = setTimeout(() => {
                flush = undefined;
                publish();
              }, 200);
          },
          () => {},
          fail,
        );
        const result = await readHistory(client);
        if (!isCurrent()) return;
        for (const event of result.events) records.set(event.id, event);
        ready = true;
        publish();
        setLimited(result.limited);
        setLoading(false);
      } catch (failure) {
        fail(failure);
      }
    })();
    return () => {
      ++generation.current;
      clearTimeout(flush);
      cancel();
      client.dispose();
      identity.dispose();
      connection.current = null;
    };
  }, [account, version, signerFactory]);

  async function deliver(event: Event) {
    const client = connection.current;
    if (!client || savingRef.current) return;
    const current = generation.current;
    savingRef.current = true;
    setSaving(true);
    try {
      try {
        await client.deliver(event);
      } catch (failure) {
        const found = await client.query({
          kinds: [9],
          ids: [event.id],
          "#h": [MAIL_CHANNEL],
          limit: 1,
        });
        if (!found.some((row) => row.id === event.id)) throw failure;
      }
      acknowledged(relayUrl, event);
      if (current === generation.current) {
        setRetry(null);
        setError("");
        setVersion((v) => v + 1);
      }
    } catch (failure) {
      if (current === generation.current)
        setError(
          `저장 확인을 받지 못했습니다. 입력은 보관되어 있습니다. ‘저장 재시도’를 누르세요. (${failure instanceof Error ? failure.message : "오류"})`,
        );
      throw failure;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function save(task: Task) {
    const client = connection.current;
    if (!client || savingRef.current || loading || retry)
      throw new Error("연결과 저장 대기 상태를 먼저 확인하세요.");
    const current = generation.current;
    // Avoid accidentally overwriting edits already visible on another device.
    const latest = foldTasks(
      await client.query({
        kinds: [9],
        authors: [account.pubkey],
        "#h": [MAIL_CHANNEL],
        "#t": [TASK_TAG],
        "#d": [task.id],
        limit: 1000,
      }),
    );
    if (current !== generation.current)
      throw new Error("연결이 변경되었습니다. 다시 시도하세요.");
    if (latest.length && latest[0].revision >= task.revision)
      throw new Error(
        "다른 화면에서 업무가 변경되었습니다. 새로고침 후 다시 수정하세요.",
      );
    const signed = await client.prepare({
      kind: 9,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["h", MAIL_CHANNEL],
        ["t", TASK_TAG],
        ["d", task.id],
      ],
      content: taskContent(task),
    });
    if (current !== generation.current)
      throw new Error("연결이 변경되었습니다. 다시 시도하세요.");
    journal(relayUrl, signed);
    setRetry(signed);
    await deliver(signed);
  }
  return {
    events,
    loading,
    limited,
    updated,
    error,
    retry,
    saving,
    save,
    retrySave: () => (retry ? deliver(retry) : Promise.resolve()),
    refresh: () => setVersion((v) => v + 1),
  };
}
