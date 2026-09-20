/** Pure lease transition, shared by the durable coordinator and adversarial tests. */
export const LEASE_MS = 60_000;
export function transition(current, action, owner, now) {
  if (typeof owner !== "string" || !/^[0-9a-f-]{36}$/.test(owner))
    return { status: 400, error: "Invalid owner" };
  const live = current && current.expiresAt > now;
  if (action === "claim") {
    if (live && current.owner !== owner)
      return {
        status: 409,
        error: "Another machine is hosting; stop it before moving",
      };
    return {
      status: 200,
      next: { owner, expiresAt: now + LEASE_MS },
      ttlMs: LEASE_MS,
    };
  }
  if (action === "renew") {
    if (!live || current.owner !== owner)
      return { status: 409, error: "Host lease lost" };
    return {
      status: 200,
      next: { owner, expiresAt: now + LEASE_MS },
      ttlMs: LEASE_MS,
    };
  }
  if (action === "release") {
    if (live && current.owner !== owner)
      return { status: 409, error: "Not the active owner" };
    return { status: 200, next: null };
  }
  return { status: 400, error: "Unknown action" };
}
