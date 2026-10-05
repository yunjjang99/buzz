import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import { SidebarMenuButton } from "@/shared/ui/sidebar";
import { CalendarDays } from "lucide-react";
import { useCommunities } from "@/features/communities/useCommunities";
import { getIdentity } from "@/shared/api/tauriIdentity";
import { signRelayEvent } from "@/shared/api/tauri";
import { Room } from "../web/strategy/StrategyRoom";
import type { WebAccount } from "../web/login-api";
import { checkedEvent, type Signer } from "../web/signer";

function nativeSigner(account: WebAccount): Signer {
  let active = true;
  return {
    pubkey: account.pubkey,
    async sign(template) {
      if (!active) throw new Error("연결이 닫혔습니다.");
      const event = await signRelayEvent({
        kind: template.kind,
        content: template.content,
        tags: template.tags,
        createdAt: template.created_at,
      });
      if (!active) throw new Error("연결이 닫혔습니다.");
      return checkedEvent(template, event, account.pubkey);
    },
    dispose() {
      active = false;
    },
  };
}

/** Render strategy within the existing right-hand content surface. */
export function NativeStrategy() {
  const { activeCommunity } = useCommunities();
  const [account, setAccount] = useState<WebAccount | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getIdentity()
      .then((identity) => {
        if (!active) return;
        if (identity.locked || identity.lost || identity.resetFailed)
          throw new Error("앱 계정 잠금을 해제한 다음 다시 열어 주세요.");
        setAccount({
          pubkey: identity.pubkey,
          name: identity.displayName || "Buzz 사용자",
          username: "",
          role: "member",
          mustChangePassword: false,
          status: "ready",
          provisioningError: "",
        });
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "계정을 확인하지 못했습니다.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  if (activeCommunity?.relayUrl?.replace(/\/$/, "") !== "wss://buzz.kovar.kr")
    return (
      <p className="p-4 text-sm">KOVAR 커뮤니티에서 전략실을 열어 주세요.</p>
    );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Delegated native anchors emit click on keyboard activation too.
    <section
      className="strategy-native-pane"
      aria-label="코바 전략실"
      onClick={(event) => {
        const anchor =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>('a[target="_blank"]')
            : null;
        if (!anchor) return;
        event.preventDefault();
        void openUrl(anchor.href).catch(() =>
          setError("원본 메일을 열지 못했습니다. 다시 눌러 주세요."),
        );
      }}
    >
      {account && error && (
        <p role="alert" className="strategy-error">
          {error}
        </p>
      )}
      {account ? (
        <Room account={account} signerFactory={nativeSigner} embedded />
      ) : (
        <div className="strategy-shell strategy-main">
          <p role={error ? "alert" : "status"}>
            {error || "앱 계정으로 전략실에 연결하고 있습니다…"}
          </p>
        </div>
      )}
    </section>
  );
}

/** Route state shared by the pinned entry and the Inbox selection indicator. */
export function useStrategySelected() {
  const location = useLocation();
  return (
    location.pathname === "/" &&
    new URLSearchParams(location.searchStr).get("strategy") === "true"
  );
}

/** Use normal app navigation so channels and history remain available. */
export function StrategyLauncher() {
  const { activeCommunity } = useCommunities();
  const selected = useStrategySelected();
  const navigate = useNavigate();
  if (activeCommunity?.relayUrl?.replace(/\/$/, "") !== "wss://buzz.kovar.kr")
    return null;
  return (
    <div className="mt-2">
      <SidebarMenuButton
        type="button"
        tooltip="전략실"
        isActive={selected}
        aria-current={selected ? "page" : undefined}
        onClick={() => {
          if (allowNavigation({ kind: "route", href: "/?strategy=true" }))
            void navigate({ to: "/", search: { strategy: true } });
        }}
      >
        <CalendarDays aria-hidden="true" />
        <span>전략실</span>
      </SidebarMenuButton>
    </div>
  );
}
