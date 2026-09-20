/** Encrypted, offline transfer. Credentials travel only inside the authenticated archive. */
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import {
  DATA_DIR,
  LOCAL_PYTHON_PATH,
  assertLocalStatePath,
} from "../src/config/runtime_paths.js";
import { acquireRuntimeLock } from "../src/services/runtime_lock.js";
const MAGIC = Buffer.from("SERAFINA1\n");
const [command, file, destination] = process.argv.slice(2);
async function run() {
  if (!["export", "import"].includes(command) || !file)
    throw Error(
      "workspace:export -- /path/transfer.saf OR workspace:import -- /path/transfer.saf /new/data/directory",
    );
  const archive = path.resolve(file);
  const keyFile = archive + ".key";
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "serafina-transfer-"),
  );
  await fs.chmod(temporary, 0o700);
  let release;
  let createdKey = false,
    createdArchive = false,
    completed = false;
  const python = (args) => {
    const result = spawnSync(
      LOCAL_PYTHON_PATH,
      ["scripts/workspace_archive.py", ...args],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0)
      throw Error(
        result.stderr || result.error?.message || "Workspace transfer failed",
      );
    return JSON.parse(result.stdout);
  };
  try {
    if (command === "export") {
      if (archive === DATA_DIR || archive.startsWith(DATA_DIR + path.sep))
        throw Error("Export outside the workspace data directory");
      for (const output of [archive, keyFile]) {
        try {
          await fs.lstat(output);
          throw Error("Transfer output already exists: " + output);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      release = await acquireRuntimeLock(); // Refuses a running writer, including another checkout.
      const zip = path.join(temporary, "workspace.zip");
      const summary = python(["export", DATA_DIR, zip]);
      const key = randomBytes(32),
        iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(MAGIC);
      await fs.writeFile(keyFile, key, { flag: "wx", mode: 0o600 });
      createdKey = true;
      const staged = path.join(temporary, "encrypted.saf");
      const output = createWriteStream(staged, { flags: "wx", mode: 0o600 });
      output.write(Buffer.concat([MAGIC, iv]));
      await pipeline(createReadStream(zip), cipher, output);
      await fs.appendFile(staged, cipher.getAuthTag());
      await fs.copyFile(staged, archive, 1);
      createdArchive = true;
      await fs.chmod(archive, 0o600);
      completed = true;
      console.log({
        ...summary,
        archive,
        keyFile,
        note: "Copy both files privately. Models and machine-specific .env settings are not included. Hosting credentials are encrypted inside the archive.",
      });
    } else {
      if (!destination)
        throw Error("Supply a new local data directory for restore");
      const target = assertLocalStatePath(destination, "Restore destination");
      const key = await fs.readFile(keyFile);
      if (key.length !== 32) throw Error("Invalid transfer key");
      const handle = await fs.open(archive);
      const size = (await handle.stat()).size;
      if (size < MAGIC.length + 12 + 16) {
        await handle.close();
        throw Error("Truncated archive");
      }
      const header = Buffer.alloc(MAGIC.length + 12);
      await handle.read(header, 0, header.length, 0);
      const tag = Buffer.alloc(16);
      await handle.read(tag, 0, 16, size - 16);
      await handle.close();
      if (!header.subarray(0, MAGIC.length).equals(MAGIC))
        throw Error("Unknown archive format");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        header.subarray(MAGIC.length),
      );
      cipher.setAAD(MAGIC);
      cipher.setAuthTag(tag);
      const zip = path.join(temporary, "workspace.zip");
      await pipeline(
        createReadStream(archive, { start: header.length, end: size - 17 }),
        cipher,
        createWriteStream(zip, { flags: "wx", mode: 0o600 }),
      );
      console.log(python(["import", zip, target]));
      console.log(
        `Set SERAFINA_DATA_DIR=${target} in this machine's .env before starting.`,
      );
    }
  } finally {
    if (!completed && createdKey) await fs.rm(keyFile, { force: true });
    if (!completed && createdArchive) await fs.rm(archive, { force: true });
    if (release) await release();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
