# Online testing and moving machines

The testing site is **https://serafina.milkbar.design/reports.html**. Cloudflare
Access sends a login code to verified addresses at `milkbar.design` or
`thewindrivergroup.com`. These testers share one workspace and its editing and
upload permissions. This is a private testing deployment, not a multi-tenant
production service.

The active machine performs all extraction and inference. It must remain awake,
connected to the Internet, with Ollama running. Reports travel over HTTPS through
Cloudflare to that machine; no report processing runs in Workers or Pages.
Closing the hosting process takes the site offline. The hostname remains fixed.

## Get the code on another machine

The complete implementation is on the GitHub branch
`codex/serafina-cloudflare-testing`, including the extraction and model improvements.
Clone that branch explicitly; the default branch may contain the older runtime:

```sh
git clone --branch codex/serafina-cloudflare-testing https://github.com/t8or/Project-Serafina.git
cd Project-Serafina
npm ci
cp .env.example .env
```

For an existing clean clone:

```sh
git fetch origin
git switch codex/serafina-cloudflare-testing
git pull --ff-only
npm ci
```

Git contains the source, dependency locks, tests, and setup instructions. Your
`.env`, workspace, Cloudflare credentials, Python environment, and model weights
are intentionally separate. Complete **Move the existing workspace** below
before starting on the destination machine. Import restores the named tunnel's
credentials, so the second machine does not need a new tunnel or Cloudflare login.

## Start and stop

Run from this branch's checkout after provisioning the local runtime:

```sh
npm ci
npm run host:doctor
npm run host:start
```

`host:start` builds the interface and supervises the app, authenticated gateway,
and tunnel in the foreground. It refuses occupied ports, another local runtime
using the same data, or another public host's lease. Use another terminal for:

```sh
npm run host:status
npm run host:stop
```

Stop the ordinary `npm start` process before `host:start`. The core app uses
`PORT` from `.env` (3011 on the current machine); the protected gateway always
uses loopback port 3012. The tunnel readiness endpoint binds loopback port 3014
(override with `SERAFINA_TUNNEL_METRICS_PORT` if needed). Startup waits for a
connected tunnel before announcing readiness. No router port-forwarding is needed. Do not run a raw
cloudflared connector or install this tunnel as a separate system service:
those bypass the supervisor's ownership checks.

Use the same branch on both machines. The older original checkout does not
contain these hosting commands.

## Move the existing workspace

There is **no background synchronization** between machines. Always move the
latest snapshot forward; starting an older snapshot will serve older results.
Finish active extraction jobs first. Otherwise shutdown interrupts them and they
must be resumed after import using the same file's extraction action.

On the old machine:

```sh
npm run host:stop
npm run workspace:export -- /absolute/path/serafina-transfer.saf
```

Export refuses a running application writer. It includes SQLite, original
uploads, retained extraction evidence, generated workbooks, reference settings,
and the hosting connection credentials. It excludes models and runtime locks.
The archive is authenticated AES-256-GCM; every restored file also has a SHA-256
inventory check, followed by SQLite integrity and foreign-key checks.

Copy the `.saf` file and matching `.saf.key` privately to your other machine.
Keep the key separate from the archive in backups; possession of both grants
access to reports and the tunnel credentials. Never commit either file. Export
refuses an existing output. Archives support at most 20 GB of uncompressed data.

On the new machine:

1. Check out the same code and run `npm ci` with Node 26.
2. Install `cloudflared` from Cloudflare/Homebrew, Python 3.11 with the pinned
   `requirements.txt`, Tesseract, and Ollama. Provision Docling artifacts using
   [the local runtime instructions](LOCAL_RUNTIME.md). Pull `gemma4:12b` (or the
   same configured model as the source machine). Large model caches are not
   included in workspace transfers.
3. Copy `.env.example` to `.env`. Set `SERAFINA_PYTHON`,
   `SERAFINA_DOCLING_ARTIFACTS_PATH`, and `SERAFINA_DATA_DIR` to **this machine's**
   local paths. Keep `SERAFINA_OCR_ENGINE=easyocr` and
   `SERAFINA_DOCLING_BATCH_PAGES=32` for the benchmarked configuration. Models
   should live outside the new restore destination until import is complete.
4. Restore into a **new, nonexistent, non-synced** directory:

   ```sh
   npm run workspace:import -- /absolute/path/serafina-transfer.saf /absolute/local/path/Serafina-Restored
   ```

5. Point `SERAFINA_DATA_DIR` at that restored directory, then run
   `npm run host:doctor` and `npm run host:start`.
6. Open the same public URL. Verify the latest report and export before retiring
   the old snapshot. Retain the old machine's data for rollback, but keep it
   stopped. If the former host crashed instead of stopping, lease expiry takes
   up to 60 seconds.

Import never overwrites an existing workspace. It validates into a temporary
sibling directory and publishes only after all checks succeed. Original
extraction metadata retains historical absolute artifact locations as provenance;
active downloads and report/workbook operations use the restored local storage.

## Why two machines cannot both serve

A dedicated Cloudflare Worker and Durable Object serialize ownership claims.
The supervisor renews its 60-second lease every 15 seconds. Its local deadline
expires five seconds early (checking both monotonic and wall clocks across sleep), and a failed renewal immediately blocks requests and
stops the app/tunnel. An accidental second managed start is refused instead of
load-balancing requests across two SQLite copies. Coordinator failure therefore
causes downtime rather than divergent public writes.

The gateway independently verifies Access JWT signatures, issuer, audience,
expiry, and exact email domain on **every route**, including PDFs, exports, and
static assets. It also checks the public Host, write Origin, request size, and
concurrency. The application remains bound to loopback. Cloudflare's Access
policy alone cannot expose the underlying app if it is accidentally relaxed.
Trusted local processes can still access the ordinary loopback app.

Long extraction runs already use durable asynchronous jobs. The gateway bounds
individual HTTP requests; model questions can still time out if local inference
is overloaded. A timed-out question can be retried. Extraction progress remains
available through its job ID.

## Provisioned Cloudflare resources

- Account: MilkBar Design (`27056753e897167d832be68e9d347972`).
- Tunnel: `serafina-testing` (`b710c8e1-39fb-4a4c-be09-9d81f8899987`).
- Proxied CNAME: `serafina.milkbar.design` → the tunnel's `cfargotunnel.com` name.
- Remote ingress: hostname → `http://127.0.0.1:3012`, fixed HTTP Host;
  unmatched traffic returns 404.
- Access application: `Serafina testing`
  (`3dfeaca6-ab23-454d-aa01-5874d15352d4`), team `milkbarstudio`.
- Access policy: `Serafina testing approved domains`; 24-hour session.
- Coordinator: `https://serafina-host-coordinator.josh-270.workers.dev/lease`.

`hosting/coordinator/wrangler.jsonc` records the coordinator deployment.
`npm run host:deploy-coordinator` requires Cloudflare deployment credentials.
Its `LEASE_SECRET` Worker secret must match the local connection file. Ordinary
hosting requires neither Wrangler login nor account-wide Cloudflare credentials.

`SERAFINA_DATA_DIR/hosting/connection.json` is a mode-600 file containing
`hostname`, `accountId`, `tunnelId`, `tunnelToken`, `coordinatorUrl`, `leaseSecret`,
`teamDomain`, `audience`, `accessAppId`, and `gatewayPort: 3012`. It is encrypted
inside transfers and is never checked into Git. Rotate tunnel/coordinator secrets
if a transfer key and archive are exposed; revoke Access sessions separately.
Do not change the Access audience without updating this connection file.

## Testing boundary

Automated tests cover forged and expired logins, incorrect audiences/domains,
Host and Origin bypass attempts, lease loss during login validation, competing
owners, late renewals, archive traversal, symlinks, corruption, and existing
restore destinations. See [the hosting validation record](HOSTING_VALIDATION.md)
for deployment and real-workspace restore checks. Tests cannot prove every
unknown PDF layout correct; the existing evidence/review limitations still apply.
