import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Event } from "nostr-tools/pure";
import { npubEncode } from "nostr-tools/nip19";
import { getLocale, setLocale, useLocale } from "../runtime/locale";
import { copy, errorText } from "./copy";
import { backupSigner, extensionSigner, type Signer } from "./signer";
import {
  readAccount,
  saveAccount,
  forgetAccount,
  type SavedAccount,
} from "./account";
import { LoginPanel } from "./LoginPanel";
import { AccountPanel } from "./AccountPanel";
import { accountSigner, loginApi, type WebAccount } from "./login-api";
import { Relay } from "./relay";
import { acknowledgeOutbox, readOutbox, saveOutbox } from "./outbox";
import {
  KINDS,
  MESSAGE_KINDS,
  memberChannels,
  messageTemplate,
  newestByAddress,
  retainEvent,
  tag,
  threadRoot,
  timeline,
  type Channel,
  type ChatMessage,
} from "./protocol";
import { AttachmentPicker, MessageAttachments } from "./AttachmentList";
import { useAttachments } from "./useAttachments";
import {
  attachmentMarkdown,
  attachmentTag,
  messageText,
} from "./media-protocol";
import "./style.css";
import "./strategy/embed";

import { relayUrl } from "./config";
document.documentElement.lang = getLocale();

function LanguageControl() {
  const language = useLocale();
  const [error, setError] = useState("");
  return (
    <div className="language">
      <label>
        <span className="sr-only">{copy[language].language}</span>
        <select
          aria-label={copy[language].language}
          value={language}
          onChange={(event) => {
            try {
              setLocale(event.target.value === "en" ? "en" : "ko");
              setError("");
            } catch (failure) {
              setError(errorText(failure, language));
            }
          }}
        >
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
      </label>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

function App() {
  const language = useLocale();
  const text = copy[language];
  const [webAccount, setWebAccount] = useState<WebAccount | null>(null);
  const [accountPanel, setAccountPanel] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [identity, setIdentity] = useState<Signer | null>(null);
  const attachments = useAttachments(identity, relayUrl);
  const sendLock = useRef<symbol | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reply, setReply] = useState<Event | undefined>();
  const [thread, setThread] = useState<ChatMessage | null>(null);
  const [pending, setPending] = useState<Event | null>(null);
  const [savedState] = useState(() => {
    try {
      return { account: readAccount(relayUrl), error: null as unknown };
    } catch (error) {
      return { account: null, error };
    }
  });
  const [savedAccount, setSavedAccount] = useState<SavedAccount | null>(
    savedState.account,
  );
  const [accountError, setAccountError] = useState<unknown>(savedState.error);
  const [useSaved, setUseSaved] = useState(Boolean(savedState.account));
  const [remember, setRemember] = useState(false);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mobileList, setMobileList] = useState(false);
  const client = useRef<Relay | null>(null);
  const signer = useRef<Signer | null>(null);
  const generation = useRef(0);
  const channelGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const timelineBottom = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const close = () => {
      ++generation.current;
      ++channelGeneration.current;
      ++loadGeneration.current;
      client.current?.dispose();
      signer.current?.dispose();
      client.current = null;
      signer.current = null;
      setIdentity(null);
      setConnected(false);
    };
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  async function loadChannels(
    connection: Relay,
    account: Signer,
    currentGeneration: number,
  ) {
    const load = ++loadGeneration.current;
    setChannelsLoading(true);
    try {
      const memberships = await connection.query({
        kinds: [KINDS.members],
        "#p": [account.pubkey],
        limit: 1000,
      });
      const ids = newestByAddress(memberships)
        .map((event) => tag(event, "d"))
        .filter(Boolean);
      const metadata = ids.length
        ? await connection.query({
            kinds: [KINDS.metadata],
            "#d": ids,
            limit: 1000,
          })
        : [];
      if (
        currentGeneration !== generation.current ||
        load !== loadGeneration.current
      )
        return;
      const found = memberChannels(memberships, metadata, account.pubkey);
      setChannels(found);
      setChannelId((previous) =>
        found.some((channel) => channel.id === previous)
          ? previous
          : (found[0]?.id ?? ""),
      );
      const authors = [
        ...new Set([
          account.pubkey,
          ...memberships.flatMap((event) =>
            event.tags
              .filter((parts) => parts[0] === "p")
              .map((parts) => parts[1]),
          ),
        ]),
      ].slice(0, 1000);
      const profiles = await connection.query({
        kinds: [KINDS.profile],
        authors,
        limit: 1000,
      });
      if (
        currentGeneration !== generation.current ||
        load !== loadGeneration.current
      )
        return;
      const nextNames: Record<string, string> = {};
      for (const profile of [...profiles].sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      )) {
        if (nextNames[profile.pubkey]) continue;
        try {
          const value = JSON.parse(profile.content);
          const name = value.display_name || value.name;
          if (typeof name === "string" && name.trim())
            nextNames[profile.pubkey] = name.slice(0, 100);
        } catch {
          /* Malformed optional profile text falls back to the public key. */
        }
      }
      setNames(nextNames);
    } finally {
      if (
        currentGeneration === generation.current &&
        load === loadGeneration.current
      )
        setChannelsLoading(false);
    }
  }

  async function connect(account: Signer) {
    const currentGeneration = ++generation.current;
    ++channelGeneration.current;
    ++loadGeneration.current;
    client.current?.dispose();
    setConnected(false);
    setBusy(true);
    setError(null);
    const connection = new Relay(relayUrl, account, (failure) => {
      if (currentGeneration !== generation.current) return;
      setConnected(false);
      setError(failure);
    });
    client.current = connection;
    try {
      await connection.ready;
      if (currentGeneration !== generation.current) return;
      const unsent = readOutbox(relayUrl, account.pubkey);
      setPending(unsent);
      setConnected(true);
      await loadChannels(connection, account, currentGeneration);
    } catch (failure) {
      if (currentGeneration === generation.current) {
        setError(failure);
        setConnected(false);
        connection.dispose();
      }
    } finally {
      if (currentGeneration === generation.current) setBusy(false);
    }
  }

  async function login(kind: "backup" | "extension") {
    const currentGeneration = ++generation.current;
    setBusy(true);
    setError(null);
    let account: Signer | null = null;
    try {
      if (kind === "backup") {
        if (!useSaved && (!file || file.size > 4096))
          throw new Error("encrypted-backup-required");
        const backup =
          useSaved && savedAccount
            ? savedAccount.backup
            : await (file as File).text();
        account = await backupSigner(backup, password);
        if (currentGeneration !== generation.current) {
          account.dispose();
          return;
        }
        if (useSaved && account.pubkey !== savedAccount?.pubkey)
          throw new Error("saved-account-invalid");
        if (!useSaved && remember) {
          setSavedAccount(saveAccount(relayUrl, account.pubkey, backup));
          setUseSaved(true);
          setAccountError(null);
        }
      } else account = await extensionSigner();
      if (currentGeneration !== generation.current) {
        account.dispose();
        return;
      }
      signer.current = account;
      setIdentity(account);
      setPassword("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await connect(account);
    } catch (failure) {
      account?.dispose();
      if (currentGeneration === generation.current) {
        setError(failure);
        setBusy(false);
      }
    } finally {
      setPassword("");
    }
  }

  function removeSavedAccount() {
    try {
      forgetAccount();
      setSavedAccount(null);
      setUseSaved(false);
      setAccountError(null);
      setError(null);
      setPassword("");
      setFile(null);
    } catch (failure) {
      setAccountError(failure);
    }
  }

  async function employeeLogin(account: WebAccount) {
    ++generation.current;
    signer.current?.dispose();
    client.current?.dispose();
    const next = accountSigner(account);
    signer.current = next;
    setWebAccount(account);
    setIdentity(next);
    setAccountPanel(account.mustChangePassword);
    await connect(next);
  }

  async function logout() {
    if (webAccount) {
      try {
        await loginApi("logout", {});
      } catch (failure) {
        if (
          !(failure instanceof Error) ||
          failure.message !== "login-required"
        ) {
          setError(failure);
          return;
        }
      }
    }
    setWebAccount(null);
    setAccountPanel(false);
    ++generation.current;
    ++channelGeneration.current;
    ++loadGeneration.current;
    client.current?.dispose();
    signer.current?.dispose();
    client.current = null;
    signer.current = null;
    setIdentity(null);
    setConnected(false);
    setBusy(false);
    setSending(false);
    sendLock.current = null;
    setLoading(false);
    setChannels([]);
    setChannelId("");
    setNames({});
    setEvents([]);
    followLatest.current = true;
    setDrafts({});
    setReply(undefined);
    setThread(null);
    setPending(null);
    setError(null);
  }

  useEffect(() => {
    const connection = client.current;
    if (!identity || !connected || !connection || !channelId) return;
    const currentGeneration = generation.current;
    const selected = ++channelGeneration.current;
    setEvents([]);
    followLatest.current = true;
    setReply(undefined);
    setThread(null);
    setLoading(true);
    let active = true;
    try {
      const cancel = connection.subscribe(
        { kinds: MESSAGE_KINDS, "#h": [channelId], limit: 200 },
        (event) => {
          if (
            active &&
            selected === channelGeneration.current &&
            currentGeneration === generation.current
          )
            setEvents((previous) => retainEvent(previous, event));
        },
        () => {
          if (active && selected === channelGeneration.current)
            setLoading(false);
        },
        (failure) => {
          if (
            active &&
            selected === channelGeneration.current &&
            currentGeneration === generation.current
          ) {
            setLoading(false);
            setError(failure);
          }
        },
      );
      return () => {
        active = false;
        cancel();
      };
    } catch (failure) {
      setLoading(false);
      setError(failure);
    }
  }, [channelId, identity, connected]);

  useEffect(() => {
    if (events.length > 0 && followLatest.current)
      timelineBottom.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const connection = client.current;
    const account = identity;
    if (!connection || !account || !connected || sendLock.current) return;
    if (
      !pending &&
      !(drafts[channelId] ?? "").trim() &&
      !attachments.files[channelId]?.length
    )
      return;
    const sendingOperation = Symbol();
    sendLock.current = sendingOperation;
    const currentGeneration = generation.current;
    const target = pending ? tag(pending, "h") : channelId;
    const selectedGeneration = channelGeneration.current;
    setSending(true);
    setError(null);
    try {
      const files = pending ? [] : await attachments.prepare(target);
      if (currentGeneration !== generation.current) return;
      let signed = pending;
      if (!signed) {
        const template = messageTemplate(
          target,
          [drafts[target] ?? "", ...files.map(attachmentMarkdown)]
            .filter(Boolean)
            .join("\n\n"),
          reply,
        );
        template.tags.push(...files.map(attachmentTag));
        signed = await connection.prepare(template);
      }
      if (currentGeneration !== generation.current) return;
      saveOutbox(relayUrl, signed);
      setPending(signed);
      await connection.deliver(signed);
      acknowledgeOutbox(signed.id);
      if (currentGeneration !== generation.current) return;
      setPending(null);
      attachments.clear(target);
      setDrafts((previous) => ({ ...previous, [target]: "" }));
      if (
        target === channelId &&
        selectedGeneration === channelGeneration.current
      ) {
        setEvents((previous) => retainEvent(previous, signed));
        setReply(undefined);
      }
    } catch (failure) {
      if (currentGeneration === generation.current) setError(failure);
    } finally {
      if (sendLock.current === sendingOperation) {
        setSending(false);
        sendLock.current = null;
      }
    }
  }

  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const messages = timeline(events, channelId);
  const roots = messages.filter(
    (message) =>
      threadRoot(message) === message.id || tag(message, "broadcast") === "1",
  );
  const supported =
    selectedChannel && ["stream", "dm"].includes(selectedChannel.type);
  const name = (pubkey: string) =>
    names[pubkey] ?? `${npubEncode(pubkey).slice(0, 14)}…`;
  function renderMessage(message: ChatMessage, isThread = false) {
    return (
      <article
        className={`message ${message.pubkey === identity?.pubkey ? "own" : ""}`}
        key={message.id}
        data-message-id={message.id}
      >
        <div className="avatar" aria-hidden="true">
          {name(message.pubkey).slice(0, 1)}
        </div>
        <div className="message-body">
          <div className="message-meta">
            <strong>{name(message.pubkey)}</strong>
            <time dateTime={new Date(message.created_at * 1000).toISOString()}>
              {new Date(message.created_at * 1000).toLocaleTimeString(
                language === "ko" ? "ko-KR" : "en-US",
                { hour: "2-digit", minute: "2-digit" },
              )}
            </time>
            {message.edited && !message.deleted && <span>{text.edited}</span>}
          </div>
          <p className={message.deleted ? "deleted" : ""}>
            {message.deleted ? text.deleted : messageText(message, relayUrl)}
          </p>
          {!message.deleted && (
            <MessageAttachments
              message={message}
              relay={relayUrl}
              language={language}
              downloading={attachments.downloading}
              onDownload={(file) => {
                const currentGeneration = generation.current;
                void attachments.download(file).catch((failure) => {
                  if (currentGeneration === generation.current)
                    setError(failure);
                });
              }}
            />
          )}
          {!message.deleted && supported && (
            <button
              className="reply-button"
              type="button"
              onClick={() => {
                const root = messages.find(
                  (candidate) => candidate.id === threadRoot(message),
                );
                setThread(root ?? message);
                setReply(message);
                composer.current?.focus();
              }}
            >
              {text.reply}
              {!isThread &&
              messages.filter(
                (candidate) =>
                  candidate.id !== message.id &&
                  threadRoot(candidate) === message.id,
              ).length > 0
                ? ` · ${messages.filter((candidate) => candidate.id !== message.id && threadRoot(candidate) === message.id).length}`
                : ""}
            </button>
          )}
        </div>
      </article>
    );
  }

  const attachmentsDisabled = !supported || Boolean(pending) || sending;
  function addFiles(files: File[]) {
    if (attachmentsDisabled || !files.length) return;
    try {
      attachments.add(channelId, files);
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <div className="app">
      <header className="brand-bar">
        <a className="brand" href="/chat/" aria-label="Buzz">
          <span aria-hidden="true">✦</span> Buzz <small>{text.title}</small>
        </a>
        <LanguageControl />
      </header>
      {webAccount && accountPanel && (
        <AccountPanel
          account={webAccount}
          onChange={setWebAccount}
          onClose={() => setAccountPanel(false)}
        />
      )}
      {!identity ? (
        <main className="login-layout">
          <section className="login-intro">
            <span className="eyebrow">KOVAR · TEAM WORKSPACE</span>
            <h1>{text.subtitle}</h1>
            <p>{text.intro}</p>
            <div className="illustration" aria-hidden="true">
              <div className="bubble">안녕하세요! 👋</div>
              <div className="bubble second">Hello, team.</div>
              <div className="bee">✦</div>
            </div>
            <p className="feature-note">{text.limitations}</p>
          </section>
          <section className="login-card" aria-labelledby="welcome">
            <h2 id="welcome">{text.welcome}</h2>
            <p className="server">buzz.kovar.kr</p>
            <LoginPanel onLogin={employeeLogin} restore={!legacyOpen} />
            <details
              className="legacy-login"
              onToggle={(event) => setLegacyOpen(event.currentTarget.open)}
            >
              <summary>
                {language === "ko"
                  ? "기존 백업·서명 확장으로 로그인"
                  : "Sign in with a backup or browser signer"}
              </summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void login("backup");
                }}
              >
                {useSaved && savedAccount ? (
                  <div className="saved-account">
                    <strong>{text.savedAccount}</strong>
                    <span>{npubEncode(savedAccount.pubkey).slice(0, 20)}…</span>
                    <p className="help">{text.savedHelp}</p>
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      value={savedAccount.pubkey}
                      readOnly
                      hidden
                    />
                  </div>
                ) : (
                  <>
                    <label htmlFor="backup-file">{text.backup}</label>
                    <input
                      ref={fileInput}
                      id="backup-file"
                      type="file"
                      accept=".ncryptsec,.txt"
                      disabled={busy}
                      onChange={(event) =>
                        setFile(event.target.files?.[0] ?? null)
                      }
                    />
                    <p className="help">{text.backupHelp}</p>
                    <label className="remember-account">
                      <input
                        type="checkbox"
                        checked={remember}
                        disabled={busy}
                        onChange={(event) => setRemember(event.target.checked)}
                      />
                      <span>{text.remember}</span>
                    </label>
                    <p className="help">{text.rememberHelp}</p>
                  </>
                )}
                <label htmlFor="backup-password">{text.password}</label>
                <input
                  id="backup-password"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || (!useSaved && !file) || !password}
                >
                  {busy
                    ? text.connecting
                    : useSaved
                      ? text.signIn
                      : text.unlock}
                </button>
              </form>
              {Boolean(savedAccount || accountError) && (
                <div className="account-actions">
                  {savedAccount && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setUseSaved(!useSaved);
                        setPassword("");
                        setFile(null);
                        setError(null);
                      }}
                    >
                      {useSaved ? text.otherAccount : text.backToSaved}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={removeSavedAccount}
                  >
                    {text.forget}
                  </button>
                </div>
              )}
              {Boolean(accountError) && (
                <p className="error" role="alert">
                  {errorText(accountError, language)}
                </p>
              )}
              <div className="divider">
                <span>{language === "ko" ? "또는" : "or"}</span>
              </div>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void login("extension")}
              >
                {text.extension}
              </button>
              <p className="privacy">{text.privacy}</p>
            </details>
            {Boolean(error) && (
              <p className="error" role="alert">
                {errorText(error, language)}
              </p>
            )}
          </section>
        </main>
      ) : (
        <main className={`workspace ${mobileList ? "show-list" : ""}`}>
          <aside
            className="sidebar"
            aria-label={text.members}
            id="channel-list"
          >
            <button
              className="mobile-list-close"
              type="button"
              onClick={() => setMobileList(false)}
            >
              {language === "ko" ? "대화로 돌아가기" : "Back to conversation"}
            </button>
            <div className="workspace-heading">
              <span className="workspace-icon">K</span>
              <div>
                <strong>KOVAR</strong>
                <small>buzz.kovar.kr</small>
              </div>
            </div>
            <div className="connection" role="status">
              <span className={`status-dot ${connected ? "online" : ""}`} />
              {busy
                ? text.connecting
                : connected
                  ? text.connected
                  : text.disconnected}
              {!connected && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void connect(identity)}
                >
                  {text.reconnect}
                </button>
              )}
            </div>
            <div className="channel-heading">
              <h2>{text.channels}</h2>
              <button
                type="button"
                aria-label={text.refresh}
                disabled={!connected || channelsLoading}
                onClick={() => {
                  setError(null);
                  void loadChannels(
                    client.current as Relay,
                    identity,
                    generation.current,
                  ).catch(setError);
                }}
              >
                ↻
              </button>
            </div>
            <nav>
              {channels
                .filter((channel) => channel.type !== "dm")
                .map((channel) => (
                  <button
                    className={channel.id === channelId ? "active" : ""}
                    aria-current={channel.id === channelId ? "page" : undefined}
                    type="button"
                    key={channel.id}
                    onClick={() => {
                      setChannelId(channel.id);
                      setMobileList(false);
                    }}
                  >
                    <span aria-hidden="true">#</span>
                    {channel.name}
                  </button>
                ))}
            </nav>
            {channels.some((channel) => channel.type === "dm") && (
              <>
                <h2>{text.direct}</h2>
                <nav>
                  {channels
                    .filter((channel) => channel.type === "dm")
                    .map((channel) => (
                      <button
                        className={channel.id === channelId ? "active" : ""}
                        aria-current={
                          channel.id === channelId ? "page" : undefined
                        }
                        type="button"
                        key={channel.id}
                        onClick={() => {
                          setChannelId(channel.id);
                          setMobileList(false);
                        }}
                      >
                        <span aria-hidden="true">○</span>
                        {channel.name}
                      </button>
                    ))}
                </nav>
              </>
            )}
            <div className="account">
              <div>
                <span className="avatar" aria-hidden="true">
                  {name(identity.pubkey).slice(0, 1)}
                </span>
                <div>
                  <strong>{name(identity.pubkey)}</strong>
                  <small>{text.identity}</small>
                </div>
              </div>
              {webAccount && (
                <button type="button" onClick={() => setAccountPanel(true)}>
                  {language === "ko" ? "계정 관리" : "Account management"}
                </button>
              )}
              <button type="button" onClick={() => void logout()}>
                {text.logout}
              </button>
            </div>
          </aside>
          <section
            className="conversation"
            aria-label={selectedChannel?.name ?? text.choose}
          >
            <div className="conversation-heading">
              <button
                className="mobile-back"
                type="button"
                aria-controls="channel-list"
                aria-expanded={mobileList}
                onClick={() => setMobileList(true)}
              >
                {text.back}
              </button>
              <div>
                <h1>
                  {selectedChannel
                    ? `${selectedChannel.type === "dm" ? "" : "# "}${selectedChannel.name}`
                    : text.choose}
                </h1>
                <p>{selectedChannel?.about || text.history}</p>
              </div>
            </div>
            {Boolean(error) && (
              <div className="error" role="alert">
                {errorText(error, language)}
              </div>
            )}
            {pending && (
              <div className="outbox" role="status">
                <p>{text.outbox}</p>
                <p className="pending-preview">{pending.content}</p>
                <button
                  type="button"
                  disabled={!connected || sending}
                  onClick={() => void send()}
                >
                  {sending ? text.loading : text.retry}
                </button>
              </div>
            )}
            <div
              className="timeline"
              onScroll={(event) => {
                const element = event.currentTarget;
                followLatest.current =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  100;
              }}
              role="log"
              aria-label={selectedChannel?.name ?? text.channels}
              aria-live="polite"
              aria-busy={loading}
            >
              {loading || channelsLoading ? (
                <p className="empty">{text.loading}</p>
              ) : !channels.length ? (
                <p className="empty">{text.noChannels}</p>
              ) : !supported ? (
                <p className="empty">{text.readOnly}</p>
              ) : !roots.length ? (
                <p className="empty">{text.empty}</p>
              ) : (
                roots.map((message) => renderMessage(message))
              )}
              <div ref={timelineBottom} />
            </div>
            {thread && (
              <section className="thread" aria-label={text.thread}>
                <header>
                  <h2>{text.thread}</h2>
                  <button
                    type="button"
                    aria-label={text.closeThread}
                    onClick={() => {
                      setThread(null);
                      setReply(undefined);
                    }}
                  >
                    ×
                  </button>
                </header>
                {messages
                  .filter((message) => threadRoot(message) === thread.id)
                  .map((message) => renderMessage(message, true))}
              </section>
            )}
            <form
              className="composer"
              onSubmit={(event) => void send(event)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files"))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                  addFiles(Array.from(event.dataTransfer.files));
                }
              }}
            >
              <AttachmentPicker
                files={attachments.files[channelId] ?? []}
                disabled={attachmentsDisabled}
                uploading={attachments.uploading}
                language={language}
                onAdd={addFiles}
                onRemove={(id) => attachments.remove(channelId, id)}
                onCancel={attachments.cancel}
              />
              {reply && (
                <div className="reply-preview">
                  <span>
                    {text.reply}: {reply.content.slice(0, 90)}
                  </span>
                  <button
                    type="button"
                    aria-label={text.cancel}
                    onClick={() => setReply(undefined)}
                  >
                    ×
                  </button>
                </div>
              )}
              <label className="sr-only" htmlFor="message">
                {text.input}
              </label>
              <textarea
                ref={composer}
                id="message"
                placeholder={supported ? text.placeholder : text.readOnly}
                value={drafts[channelId] ?? ""}
                disabled={!supported || Boolean(pending) || sending}
                maxLength={64 * 1024}
                onChange={(event) =>
                  setDrafts((previous) => ({
                    ...previous,
                    [channelId]: event.target.value,
                  }))
                }
                onPaste={(event) => {
                  if (event.clipboardData.files.length) {
                    event.preventDefault();
                    addFiles(Array.from(event.clipboardData.files));
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-footer">
                <small>{text.newLine}</small>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    !connected ||
                    !supported ||
                    sending ||
                    Boolean(pending) ||
                    (!(drafts[channelId] ?? "").trim() &&
                      !attachments.files[channelId]?.length)
                  }
                >
                  {sending ? text.loading : text.send}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            </form>
            <p className="workspace-note">{text.limitations}</p>
          </section>
        </main>
      )}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
