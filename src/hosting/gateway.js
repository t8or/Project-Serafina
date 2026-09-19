/** Authenticated public entry point. The existing application remains loopback-only. */
import http from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

export function accessVerifier(
  { teamDomain, audience, allowedDomains },
  keySet,
) {
  const issuer = new URL(teamDomain);
  if (
    issuer.protocol !== "https:" ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname) ||
    issuer.pathname !== "/" ||
    issuer.search ||
    issuer.hash ||
    issuer.username ||
    issuer.password ||
    issuer.port
  )
    throw Error("Invalid Cloudflare Access team domain");
  if (!audience || !allowedDomains?.length)
    throw Error("Access audience and allowed email domains are required");
  const keys =
    keySet ||
    createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer), {
      timeoutDuration: 5000,
    });
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: issuer.origin,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
    });
    const domain =
      typeof payload.email === "string"
        ? payload.email.toLowerCase().split("@")
        : [];
    if (domain.length !== 2 || !allowedDomains.includes(domain[1]))
      throw Error("Email domain is not allowed");
    return { subject: payload.sub, email: payload.email };
  };
}

export function createGateway({
  publicUrl,
  origin,
  verify,
  leaseValid,
  maxBytes = 55 * 1024 * 1024,
  maxConcurrent = 12,
  timeoutMs = 110_000,
}) {
  const publicOrigin = new URL(publicUrl);
  const target = new URL(origin);
  if (
    publicOrigin.protocol !== "https:" ||
    publicOrigin.pathname !== "/" ||
    publicOrigin.search ||
    publicOrigin.hash ||
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.port
  )
    throw Error("Public URL must be an HTTPS origin");
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw Error("Application origin must be loopback HTTP");
  let active = 0;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  };
  const reject = (res, status, error) => {
    res.writeHead(status, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error }));
  };
  const server = http.createServer(async (req, res) => {
    // No path, download, static asset, or forwarded localhost Host bypasses this check.
    if (req.headers.host !== publicOrigin.host)
      return reject(res, 403, "Unknown host");
    if (!leaseValid())
      return reject(res, 503, "This machine is not the active host");
    if (!req.url?.startsWith("/") || req.url.startsWith("//"))
      return reject(res, 400, "Invalid request target");
    const token = req.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length > 16000)
      return reject(res, 401, "Sign in with Cloudflare Access");
    try {
      await verify(token);
    } catch {
      return reject(res, 403, "Access denied");
    }
    if (!leaseValid()) return reject(res, 503, "Host lease expired");
    const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (
      (write && req.headers.origin !== publicOrigin.origin) ||
      (req.headers.origin && req.headers.origin !== publicOrigin.origin)
    )
      return reject(res, 403, "Cross-origin requests are not allowed");
    if (active >= maxConcurrent)
      return reject(res, 429, "Too many active requests; retry shortly");
    if (
      req.headers["content-length"] &&
      (!/^\d+$/.test(req.headers["content-length"]) ||
        Number(req.headers["content-length"]) > maxBytes)
    )
      return reject(res, 413, "Upload exceeds the testing limit");
    active++;
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        active--;
      }
    };
    res.once("close", finish);
    // Strip identity/proxy headers from the browser before supplying a fixed local origin.
    const forwarded = { ...req.headers, host: target.host };
    for (const name of Object.keys(forwarded))
      if (
        name.startsWith("cf-") ||
        name.startsWith("x-forwarded-") ||
        [
          "connection",
          "upgrade",
          "proxy-authorization",
          "proxy-connection",
          "forwarded",
        ].includes(name)
      )
        delete forwarded[name];
    if (req.headers.origin) forwarded.origin = target.origin;
    forwarded.connection = "close";
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: req.url,
        method: req.method,
        headers: forwarded,
      },
      (response) => {
        if (res.destroyed) return response.destroy();
        const outgoing = { ...response.headers, ...headers };
        delete outgoing["connection"];
        res.writeHead(response.statusCode, outgoing);
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    upstream.setTimeout(timeoutMs, () => upstream.destroy(Error("timeout")));
    upstream.on("error", () => {
      if (!res.headersSent) reject(res, 502, "Application unavailable");
      else res.destroy();
    });
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.unpipe(upstream);
        if (!res.headersSent)
          reject(res, 413, "Upload exceeds the testing limit");
        upstream.destroy();
      }
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.on("upgrade", (_req, socket) => socket.destroy());
  return server;
}
