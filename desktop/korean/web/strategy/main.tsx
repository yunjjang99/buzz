import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LoginPanel } from "../LoginPanel";
import { loginApi, type WebAccount } from "../login-api";
import { Room } from "./StrategyRoom";
import "../style.css";
function App() {
  const [account, setAccount] = useState<WebAccount | null>(null);
  if (!account)
    return (
      <div className="strategy-login">
        <a href="/chat/">✦ Buzz</a>
        <h1>코바 전략실</h1>
        <p>기존 Buzz 직원 계정으로 로그인하세요.</p>
        <LoginPanel
          onLogin={async (value) => {
            if (value.mustChangePassword) {
              location.href = "/chat/";
              return;
            }
            setAccount(value);
          }}
        />
      </div>
    );
  return (
    <Room
      key={account.pubkey}
      account={account}
      onLogout={async () => {
        await loginApi("logout", {});
        setAccount(null);
      }}
    />
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("전략실 화면을 열 수 없습니다.");
createRoot(root).render(<App />);
