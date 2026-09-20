import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DATA_DIR } from "../config/runtime_paths.js";
export const HOSTNAME = "serafina.milkbar.design";
export const ALLOWED_DOMAINS = ["milkbar.design", "thewindrivergroup.com"];
export const CONNECTION_FILE = path.join(
  DATA_DIR,
  "hosting",
  "connection.json",
);
export const CONTROL_DIR = path.join(os.homedir(), ".serafina-host");
export const CONTROL_SOCKET = path.join(CONTROL_DIR, "control.sock");
export async function readConnection() {
  let value;
  try {
    value = JSON.parse(await fs.readFile(CONNECTION_FILE, "utf8"));
  } catch {
    throw Error(
      `Hosting is not configured. Provision Cloudflare and place its connection file at ${CONNECTION_FILE}`,
    );
  }
  if (
    value.hostname !== HOSTNAME ||
    !value.tunnelId ||
    !value.tunnelToken ||
    !value.leaseSecret ||
    !value.audience ||
    !value.teamDomain
  )
    throw Error("Incomplete hosting connection; run host:doctor");
  const stat = await fs.stat(CONNECTION_FILE);
  if (process.platform !== "win32" && stat.mode & 0o077)
    throw Error("Hosting credentials must have mode 600");
  return value;
}
