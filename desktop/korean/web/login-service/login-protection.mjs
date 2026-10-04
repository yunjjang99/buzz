import { hashToken } from "./store.mjs";

const DELAYS = [60_000, 300_000, 3_600_000, 86_400_000];
const RETENTION = 48 * 60 * 60 * 1000;
const key = (name) => hashToken(name);

/** Persistent, bounded attempt state shared by web and desktop login. */
export function checkLogin(state, name, time) {
  const record = state.loginFailures?.[key(name)];
  if (record?.until > time) {
    const error = new Error("login-locked");
    error.status = 429;
    error.retryAfter = Math.ceil((record.until - time) / 1000);
    throw error;
  }
}

/** Commit before returning a failed attempt; never retain credentials in the journal. */
export function failLogin(state, name, time) {
  state.loginFailures ??= {};
  for (const [id, record] of Object.entries(state.loginFailures)) {
    if (record.updated + RETENTION <= time && record.until <= time)
      delete state.loginFailures[id];
  }
  const id = key(name);
  if (
    !state.loginFailures[id] &&
    Object.keys(state.loginFailures).length >= 2048
  )
    throw Object.assign(new Error("rate-limited"), { status: 429 });
  const record = state.loginFailures[id] ?? { failures: 0, level: 0, until: 0 };
  record.updated = time;
  record.failures += 1;
  if (record.failures >= 5) {
    record.until = time + DELAYS[Math.min(record.level, DELAYS.length - 1)];
    record.level = Math.min(record.level + 1, DELAYS.length);
    record.failures = 0;
    state.loginAudit ??= [];
    state.loginAudit.push({
      at: time,
      subject: id,
      action: "locked",
      until: record.until,
    });
    state.loginAudit = state.loginAudit.slice(-200);
  }
  state.loginFailures[id] = record;
}

/** Successful login or administrator password recovery starts a fresh sequence. */
export function clearLogin(state, name) {
  if (state.loginFailures) delete state.loginFailures[key(name)];
}
