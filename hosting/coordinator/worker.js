import { transition } from "./lease.js";
export class HostLease {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    const { action, owner } = await request.json();
    return this.state.storage.transaction(async (storage) => {
      const current = await storage.get("lease");
      if (action === "status")
        return Response.json({
          active: Boolean(current && current.expiresAt > Date.now()),
          expiresAt: current?.expiresAt || null,
        });
      const result = transition(current, action, owner, Date.now());
      if (result.status === 200) {
        if (result.next) await storage.put("lease", result.next);
        else await storage.delete("lease");
      }
      return Response.json(
        { error: result.error, ttlMs: result.ttlMs },
        { status: result.status },
      );
    });
  }
}
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/lease" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (
      !env.LEASE_SECRET ||
      request.headers.get("Authorization") !== "Bearer " + env.LEASE_SECRET
    )
      return new Response("Unauthorized", { status: 401 });
    if (Number(request.headers.get("Content-Length")) > 2048)
      return new Response("Too large", { status: 413 });
    const body = await request.text();
    if (body.length > 2048) return new Response("Too large", { status: 413 });
    try {
      JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    return env.HOST_LEASE.get(env.HOST_LEASE.idFromName("serafina")).fetch(
      new Request(request.url, { method: "POST", body }),
    );
  },
};
