export function failStatus(previous, message) {
  const failures = (previous.failures || 0) + 1;
  return { ...previous, state: failures >= 5 ? 'attention' : 'retrying', failures, message,
    nextAt: Date.now() + Math.min(1800000, 60000 * 2 ** Math.min(failures - 1, 5)),
    updated: new Date().toISOString() };
}
