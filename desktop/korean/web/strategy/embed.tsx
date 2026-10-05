import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Room } from "./StrategyRoom";
import { loginApi, type WebAccount } from "../login-api";
import "./embed.css";

function EmbeddedStrategy() {
  const [account, setAccount] = useState<WebAccount | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loginApi<WebAccount>("session")
      .then((value) => {
        if (active) setAccount(value);
      })
      .catch(() => {
        if (active)
          setError("직원 아이디로 로그인한 후 전략실을 다시 열어 주세요.");
      });
    return () => {
      active = false;
    };
  }, []);
  return account ? (
    <Room account={account} embedded />
  ) : (
    <div className="strategy-shell strategy-main">
      <h1>코바 전략실</h1>
      <p role={error ? "alert" : "status"}>
        {error || "기존 Buzz 계정으로 연결 중…"}
      </p>
    </div>
  );
}

// Compatibility mount for existing chat releases: preserve their channels, composer and attachments.
let root: Root | null = null;
let pane: HTMLElement | null = null;
let pinned: HTMLButtonElement | null = null;
function sync() {
  const workspace = document.querySelector<HTMLElement>(".workspace");
  const sidebar = workspace?.querySelector<HTMLElement>(".sidebar");
  document.querySelector('.brand-bar a[href="/chat/strategy.html"]')?.remove();
  if (!sidebar || !workspace) {
    root?.unmount();
    root = null;
    pane = null;
    pinned = null;
    return;
  }
  if (!pinned?.isConnected) {
    pinned = document.createElement("button");
    pinned.type = "button";
    pinned.className = "strategy-pinned-entry";
    pinned.textContent = "▦  전략실";
    pinned.onclick = () => {
      location.hash = "strategy";
    };
    sidebar.querySelector(".workspace-heading")?.after(pinned);
  }
  const open = location.hash === "#strategy";
  pinned.setAttribute("aria-current", open ? "page" : "false");
  if (open) {
    if (!pane?.isConnected) {
      root?.unmount();
      pane = document.createElement("section");
      pane.className = "strategy-web-pane";
      pane.setAttribute("aria-label", "전략실");
      workspace.append(pane);
      root = createRoot(pane);
      root.render(<EmbeddedStrategy />);
    }
    if (!workspace.hasAttribute("data-strategy-open"))
      workspace.setAttribute("data-strategy-open", "");
  } else {
    workspace.removeAttribute("data-strategy-open");
    if (pane) {
      root?.unmount();
      root = null;
      pane.remove();
      pane = null;
    }
  }
}
window.addEventListener("hashchange", sync);
document.addEventListener("click", (event) => {
  if (
    event.target instanceof Element &&
    event.target.closest(".sidebar nav button, .mobile-list-close")
  ) {
    if (location.hash === "#strategy") location.hash = "";
  }
});
let queued = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    sync();
  });
});
observer.observe(document.documentElement, { childList: true, subtree: true });
sync();
