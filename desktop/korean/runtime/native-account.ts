import { setNativeLoginTransport, type WebAccount } from "../web/login-api";
const ORIGIN = "https://buzz.kovar.kr";
let token = "";
let generation = 0;
/** Whether this process already holds a desktop login session. */
export function hasNativeSession() {
  return Boolean(token);
}
/** Desktop session credentials live only in memory, never localStorage. */
export async function nativeApi<T>(route: string, input?: object): Promise<T> {
  const attempt = ["desktop/login", "setup", "logout", "mfa/confirm"].includes(
    route,
  )
    ? ++generation
    : generation;
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
  if (!response.ok)
    throw Object.assign(new Error(value.error ?? "login-service-unavailable"), {
      retryAfter: value.retryAfter,
    });
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
