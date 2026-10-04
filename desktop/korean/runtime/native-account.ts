import { setNativeLoginTransport, type WebAccount } from "../web/login-api";
const ORIGIN = "https://buzz.kovar.kr";
let token = "";
let generation = 0;
/** Desktop session credentials live only in memory, never localStorage. */
export async function nativeApi<T>(route: string, input?: object): Promise<T> {
  const attempt =
    route === "desktop/login" || route === "setup" ? ++generation : generation;
  const response = await fetch(`${ORIGIN}/chat-api/${route}`, {
    method: input ? "POST" : "GET",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(40000),
    headers: {
      ...(input ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "login-service-unavailable");
  if (attempt !== generation) throw new Error("계정 연결이 취소되었습니다.");
  if (value.token || value.desktopToken)
    token = value.token ?? value.desktopToken;
  if (route === "logout") token = "";
  return value as T;
}
setNativeLoginTransport(nativeApi);
export type NativeLogin = {
  account: WebAccount;
  backup: string;
  token: string;
};
