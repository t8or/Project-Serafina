import { randomUUID } from "node:crypto";
/** A conservative local deadline fences requests even when renewal or Cloudflare fails. */
export class HostLease {
  constructor({
    url,
    secret,
    fetcher = fetch,
    now = () => performance.now(),
    wallNow = () => Date.now(),
  }) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:")
      throw Error("Lease coordinator requires HTTPS");
    if (!secret || secret.length < 32) throw Error("Lease secret is missing");
    this.url = endpoint;
    this.secret = secret;
    this.fetcher = fetcher;
    this.now = now;
    this.wallNow = wallNow;
    this.wallDeadline = 0;
    this.owner = randomUUID();
    this.deadline = 0;
  }
  valid() {
    return this.now() < this.deadline && this.wallNow() < this.wallDeadline;
  }
  async request(action) {
    const started = this.now();
    const wallStarted = this.wallNow();
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, owner: this.owner }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok)
      throw Error(result.error || "Coordinator rejected the host lease");
    if (action === "claim" || action === "renew") {
      if (
        !Number.isFinite(result.ttlMs) ||
        result.ttlMs < 10000 ||
        result.ttlMs > 60000
      )
        throw Error("Invalid lease duration");
      // Start at request dispatch, not receipt, to account for latency and clock skew.
      this.deadline = started + result.ttlMs - 5000;
      this.wallDeadline = wallStarted + result.ttlMs - 5000;
      if (!this.valid()) throw Error("Lease response arrived too late");
    }
    return result;
  }
  claim() {
    return this.request("claim");
  }
  async renew() {
    try {
      return await this.request("renew");
    } catch (error) {
      this.deadline = 0;
      throw error;
    }
  }
  async release() {
    this.deadline = 0;
    return this.request("release");
  }
}
