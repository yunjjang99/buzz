/** The web messenger connects to the community hosting it; local preview uses the configured home relay. */
export const relayUrl = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "wss://buzz.kovar.kr"
  : `wss://${location.host}`;
