import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { createGateway, accessVerifier } from "../src/hosting/gateway.js";
import { HostLease } from "../src/hosting/lease_client.js";
import { transition } from "../hosting/coordinator/lease.js";
const team = "https://serafina-test.cloudflareaccess.com";
const hostname = "serafina.milkbar.design";
async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
async function request(
  port,
  { path = "/", token, host = hostname, method = "GET", origin, body } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Host: host,
          ...(token ? { "cf-access-jwt-assertion": token } : {}),
          ...(origin ? { Origin: origin } : {}),
          "cf-access-authenticated-user-email": "fake@milkbar.design",
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
test("public gateway verifies signature, audience, expiry and exact email domain on every route", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const verify = accessVerifier(
    {
      teamDomain: team,
      audience: "serafina-audience",
      allowedDomains: ["milkbar.design", "thewindrivergroup.com"],
    },
    createLocalJWKSet({ keys: [jwk] }),
  );
  const sign = async (
    fields = {},
    audience = "serafina-audience",
    expires = "1h",
  ) =>
    new SignJWT({ email: "person@milkbar.design", ...fields })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("person")
      .setIssuedAt()
      .setIssuer(team)
      .setAudience(audience)
      .setExpirationTime(expires)
      .sign(privateKey);
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls++;
    res.end(
      JSON.stringify({ host: req.headers.host, origin: req.headers.origin }),
    );
  });
  const originPort = await listen(upstream);
  let live = true;
  const gateway = createGateway({
    publicUrl: "https://" + hostname,
    origin: `http://127.0.0.1:${originPort}`,
    verify,
    leaseValid: () => live,
    maxBytes: 32,
  });
  const port = await listen(gateway);
  try {
    for (const path of [
      "/api/reports",
      "/uploads/source.pdf",
      "/api/health",
      "/reports.html",
    ])
      assert.equal((await request(port, { path })).status, 401);
    assert.equal((await request(port, { token: "forged-token" })).status, 403);
    assert.equal(
      (await request(port, { token: await sign({}, "another-app") })).status,
      403,
    );
    assert.equal(
      (await request(port, { token: await sign({}, "serafina-audience", 1) }))
        .status,
      403,
    );
    assert.equal(
      (
        await request(port, {
          token: await sign({
            email: "person@milkbar.design.attacker.example",
          }),
        })
      ).status,
      403,
    );
    assert.equal(calls, 0);
    const token = await sign();
    assert.equal(
      (await request(port, { token, host: `127.0.0.1:${port}` })).status,
      403,
    );
    assert.equal(
      (
        await request(port, {
          token,
          method: "POST",
          origin: "https://attacker.example",
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(port, { token, method: "POST", body: "{}" })).status,
      403,
    );
    assert.equal(
      (
        await request(port, {
          token,
          method: "POST",
          origin: "https://" + hostname,
          body: "x".repeat(100),
        })
      ).status,
      413,
    );
    const response = await request(port, {
      token,
      method: "POST",
      origin: "https://" + hostname,
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(
      JSON.parse(response.text).origin,
      `http://127.0.0.1:${originPort}`,
    );
    assert.equal(response.headers["cache-control"], "private, no-store");
    live = false;
    assert.equal((await request(port, { token })).status, 503);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
test("lease expiry during authentication cannot forward a request", async () => {
  let live = true;
  let called = false;
  const upstream = http.createServer((_req, res) => {
    called = true;
    res.end();
  });
  const originPort = await listen(upstream);
  const gateway = createGateway({
    publicUrl: "https://" + hostname,
    origin: `http://127.0.0.1:${originPort}`,
    verify: async () => {
      live = false;
    },
    leaseValid: () => live,
  });
  const port = await listen(gateway);
  try {
    assert.equal((await request(port, { token: "valid" })).status, 503);
    assert.equal(called, false);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
test("expired, overlapping and stale owners cannot renew or release another host", () => {
  const a = "11111111-1111-1111-1111-111111111111",
    b = "22222222-2222-2222-2222-222222222222";
  const first = transition(null, "claim", a, 1000);
  assert.equal(first.status, 200);
  assert.equal(transition(first.next, "claim", b, 1001).status, 409);
  assert.equal(transition(first.next, "release", b, 1002).status, 409);
  const second = transition(first.next, "claim", b, 62000);
  assert.equal(second.status, 200);
  assert.equal(transition(second.next, "renew", a, 62001).status, 409);
  assert.equal(transition(second.next, "release", a, 62002).status, 409);
  assert.equal(transition(second.next, "release", b, 62003).status, 200);
});
test("late replies and failed renewals fence the local host without trusting wall-clock alignment", async () => {
  let time = 0,
    fail = false;
  const lease = new HostLease({
    url: "https://coordinator.example/lease",
    secret: "s".repeat(32),
    now: () => time,
    fetcher: async () => {
      if (fail) throw Error("network lost");
      return { ok: true, json: async () => ({ ttlMs: 60000 }) };
    },
  });
  await lease.claim();
  assert.equal(lease.valid(), true);
  time = 55000;
  assert.equal(lease.valid(), false);
  time = 100000;
  await lease.claim();
  fail = true;
  await assert.rejects(() => lease.renew(), /network lost/);
  assert.equal(lease.valid(), false);
  const late = new HostLease({
    url: "https://coordinator.example/lease",
    secret: "s".repeat(32),
    now: () => time,
    fetcher: async () => {
      time += 60000;
      return { ok: true, json: async () => ({ ttlMs: 60000 }) };
    },
  });
  await assert.rejects(() => late.claim(), /too late/);
  assert.equal(late.valid(), false);
});

test("suspend time and backwards wall-clock corrections cannot extend hosting authority", async () => {
  let monotonic = 0,
    wall = 100000;
  const lease = new HostLease({
    url: "https://coordinator.example/lease",
    secret: "s".repeat(32),
    now: () => monotonic,
    wallNow: () => wall,
    fetcher: async () => ({ ok: true, json: async () => ({ ttlMs: 60000 }) }),
  });
  await lease.claim();
  // Some platforms suspend their monotonic clock while the laptop is asleep.
  wall += 120000;
  assert.equal(lease.valid(), false);
  await lease.claim();
  wall -= 120000;
  monotonic += 60000;
  assert.equal(lease.valid(), false);
});
