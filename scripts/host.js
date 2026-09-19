/** One foreground owner supervises the application, authenticated gateway, and tunnel. */
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  readConnection,
  HOSTNAME,
  ALLOWED_DOMAINS,
  CONTROL_DIR,
  CONTROL_SOCKET,
  CONNECTION_FILE,
} from "../src/hosting/config.js";
import { createGateway, accessVerifier } from "../src/hosting/gateway.js";
import { HostLease } from "../src/hosting/lease_client.js";
import { DATA_DIR } from "../src/config/runtime_paths.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.cwd() !== root)
  throw Error("Run hosting commands from this checkout root");
const command = process.argv[2] || "status";
async function control(action) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(CONTROL_SOCKET);
    let text = "";
    socket.setTimeout(3000, () => socket.destroy(Error("Control timed out")));
    socket.on("connect", () => socket.end(JSON.stringify({ action })));
    socket.on("data", (chunk) => (text += chunk));
    socket.on("end", () => {
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Error("Invalid host response"));
      }
    });
    socket.on("error", reject);
  });
}
async function available(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", () =>
      reject(
        Error(
          `Port ${port} is in use. Stop the existing local app before host:start.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function main() {
  if (command === "stop" || command === "status") {
    try {
      const result = await control(command);
      if (command === "stop") {
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          try {
            await control("status");
          } catch (error) {
            if (["ENOENT", "ECONNREFUSED"].includes(error.code)) {
              console.log(
                "Serafina hosting stopped. Workspace can now be exported.",
              );
              return;
            }
            throw error;
          }
        }
        throw Error("Host is still stopping; inspect host:status");
      }
      console.log(result);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        console.log("No managed Serafina host is running on this machine.");
        return;
      }
      throw error;
    }
    return;
  }
  const config = await readConnection();
  if (command === "doctor") {
    const verifier = accessVerifier({
      teamDomain: config.teamDomain,
      audience: config.audience,
      allowedDomains: ALLOWED_DOMAINS,
    });
    const lease = new HostLease({
      url: config.coordinatorUrl,
      secret: config.leaseSecret,
    });
    console.log({
      url: "https://" + HOSTNAME,
      credentials: CONNECTION_FILE,
      coordinator: await lease.request("status"),
      accessVerification: Boolean(verifier),
      data: DATA_DIR,
    });
    return;
  }
  if (command !== "start")
    throw Error("Use host:start, host:stop, host:status, or host:doctor");
  const port = Number(process.env.PORT || 3000);
  const gatewayPort = Number(config.gatewayPort);
  const metricsPort = Number(process.env.SERAFINA_TUNNEL_METRICS_PORT || 3014);
  if (gatewayPort !== 3012)
    throw Error(
      "The named tunnel must target the authenticated gateway on port 3012",
    );
  for (const p of [port, gatewayPort, metricsPort])
    if (!Number.isInteger(p) || p < 1024 || p > 65535)
      throw Error("Invalid hosting port");
  if (new Set([port, gatewayPort, metricsPort]).size !== 3)
    throw Error("Gateway, application, and tunnel metrics ports must differ");
  await available(port);
  await available(gatewayPort);
  await available(metricsPort);
  await fs.mkdir(CONTROL_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(CONTROL_DIR, 0o700);
  try {
    await control("status");
    throw Error("A managed host is already running on this machine");
  } catch (error) {
    if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error;
  }
  await fs.rm(CONTROL_SOCKET, { force: true });
  const lease = new HostLease({
    url: config.coordinatorUrl,
    secret: config.leaseSecret,
  });
  await lease.claim();
  let stopping = false,
    renewing = false;
  let gateway, controller, heartbeat;
  let tunnelReady = false;
  const children = new Set();
  const groups = new Set();
  const signalGroup = (pid, signal) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    gateway?.closeAllConnections();
    gateway?.close();
    // The application launches Python workers. Signal the entire owned process
    // group so an orphan cannot keep writing while a workspace is exported.
    for (const pid of groups) signalGroup(pid, "SIGTERM");
    await Promise.all(
      [...children].map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode) return resolve();
            const timer = setTimeout(() => {
              signalGroup(child.pid, "SIGKILL");
            }, 8000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
    for (const pid of groups) signalGroup(pid, "SIGKILL");
    groups.clear();
    await lease.release().catch(() => {});
    controller?.close();
    await fs.rm(CONTROL_SOCKET, { force: true });
    await fs.rm(path.join(CONTROL_DIR, "tunnel.token"), { force: true });
    process.exitCode = code;
  };
  const child = (bin, args, options = {}) => {
    const proc = spawn(bin, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
      detached: true,
    });
    if (proc.pid) groups.add(proc.pid);
    children.add(proc);
    proc.on("error", () => {
      children.delete(proc);
      console.error(`Could not run ${bin}`);
      void stop(1);
    });
    proc.on("exit", (code) => {
      children.delete(proc);
      if (!stopping) {
        console.error(`${bin} exited (${code}); stopping public hosting`);
        void stop(1);
      }
    });
    return proc;
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  try {
    heartbeat = setInterval(async () => {
      if (renewing || stopping) return;
      renewing = true;
      try {
        await lease.renew();
      } catch (error) {
        console.error(error.message);
        await stop(1);
      } finally {
        renewing = false;
      }
    }, 15000);
    const instance = randomUUID();
    child(process.execPath, ["server.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        SERAFINA_HOST: "127.0.0.1",
        SERAFINA_INSTANCE_ID: instance,
      },
    });
    let ready = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && !stopping) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        const health = await response.json();
        if (response.ok && health.instanceId === instance) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw Error("The application did not become ready");
    const verify = accessVerifier({
      teamDomain: config.teamDomain,
      audience: config.audience,
      allowedDomains: ALLOWED_DOMAINS,
    });
    gateway = createGateway({
      publicUrl: "https://" + HOSTNAME,
      origin: `http://127.0.0.1:${port}`,
      verify,
      leaseValid: () => lease.valid() && !stopping,
    });
    await new Promise((resolve, reject) => {
      gateway.once("error", reject);
      gateway.listen(gatewayPort, "127.0.0.1", resolve);
    });
    // Token files avoid leaking connector credentials in process arguments or logs.
    const tokenFile = path.join(CONTROL_DIR, "tunnel.token");
    await fs.writeFile(tokenFile, config.tunnelToken, { mode: 0o600 });
    await fs.chmod(tokenFile, 0o600);
    child(process.env.SERAFINA_CLOUDFLARED || "cloudflared", [
      "tunnel",
      "--no-autoupdate",
      "--metrics",
      `127.0.0.1:${metricsPort}`,
      "run",
      "--token-file",
      tokenFile,
    ]);
    controller = net.createServer({ allowHalfOpen: true }, (socket) => {
      let input = "";
      socket.setTimeout(3000, () => socket.destroy());
      socket.on("data", (chunk) => {
        input += chunk;
        if (input.length > 1024) socket.destroy();
      });
      socket.on("end", () => {
        try {
          const { action } = JSON.parse(input);
          socket.end(
            JSON.stringify({
              running: !stopping,
              leaseValid: lease.valid(),
              tunnelReady,
              url: "https://" + HOSTNAME,
              data: DATA_DIR,
              checkout: root,
            }),
          );
          if (action === "stop") void stop();
        } catch {
          socket.destroy();
        }
      });
    });
    await new Promise((resolve, reject) => {
      controller.once("error", reject);
      controller.listen(CONTROL_SOCKET, resolve);
    });
    await fs.chmod(CONTROL_SOCKET, 0o600);
    const tunnelDeadline = Date.now() + 60000;
    while (Date.now() < tunnelDeadline && !stopping) {
      try {
        const response = await fetch(`http://127.0.0.1:${metricsPort}/ready`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          tunnelReady = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!tunnelReady)
      throw Error("Cloudflare tunnel did not connect within 60 seconds");
    console.log(
      `Serafina hosting at https://${HOSTNAME}; run npm run host:stop to move machines.`,
    );
  } catch (error) {
    await stop(1);
    throw error;
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
