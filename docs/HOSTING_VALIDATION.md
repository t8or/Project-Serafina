# Hosting validation — 2026-09-19

Validated on the Mac running the existing `Project Serafina Audit` workspace.
The original source checkout and its uncommitted files were left unchanged.

## Cloudflare deployment

- `serafina.milkbar.design` resolves through the named `serafina-testing` tunnel.
- Access application protects the whole hostname. Its only Allow policy includes
  email domains `milkbar.design` and `thewindrivergroup.com`; one-time email PIN
  login was completed by the owner.
- Authenticated browser loaded the public reports page and dashboard, with all
  three existing properties and 17 retained report revisions.
- A public POST question returned the expected Serafina 3-mile median household
  income, `$80,544`, after JWT and Origin verification.
- Anonymous requests to the reports page, report API, original PDF, JSON export,
  and health route each returned a 302 to the Cloudflare Access login page.
- The live Durable Object accepted exactly one of 12 simultaneous ownership
  claims and rejected the other 11 with HTTP 409. A second claim was also refused
  while the managed application was actively hosting.

## Workspace and lifecycle drill

Exported 264 files / 595,406,132 uncompressed bytes to an encrypted archive
(approximately 59 MB). Restored into a new local directory with the connection
credentials intact and no runtime lock or model weights copied.

The restored application passed `scripts/verify-local.js` on port 3013:
127-page Hawks Landing and 152-page Serafina report coverage, complete source-PDF
hash checks, table cells, report search, known table answers, the unfamiliar
scanned-report local-model answer with source citations, and independently
reopened workbook drafts. The restored workspace was then served through the
same public hostname, and a browser question succeeded.

Managed hosting was stopped and restarted, including a switch back to the
original audit workspace. Final status reports `running`, `leaseValid`, and
`tunnelReady` as true. Cloudflare's transient 1033 error occurred during the
intentional connector stops; the signed-in reports page and dashboard both
loaded after restart. Machine handoff necessarily includes downtime.

Wrong encryption keys and altered ciphertext were refused without creating a
restore destination. Existing output archives and keys were preserved on repeat
export attempts. Stop waits for supervised children and ownership release;
process groups terminate Python workers along with the application. Startup
waits for the connector's `/ready` response before announcing availability.

## Automated checks

- `npm test`: **31 Node + 31 Python tests passed**.
- `npm run build`: production build passed.
- `npm audit`: **0 vulnerabilities** at validation time.
- `npm run host:doctor`: local runtime and coordinator checks passed.
- `git diff --check`: passed.

New failure-oriented cases include invalid JWT signatures/audiences/expiry,
email-domain suffix spoofing, unknown Host, foreign or missing write Origin,
oversized requests, lease loss during asynchronous verification, competing and
stale owners, slow renewal replies, network failure, laptop sleep and backward
clock changes, archive traversal/symlinks/checksum changes, encrypted archive
corruption/wrong keys, and overwrite refusal.

## Limits of this evidence

The workspace move was exercised between two directories on this machine, not
on a second physical computer. The destination machine still needs compatible
Node/Python/Ollama and provisioned model artifacts. Source code and workspace
snapshots must be moved explicitly; the tunnel does not synchronize data.

This is a shared tester workspace with no per-client tenant isolation. The host
must remain awake and online. The setup is foreground-managed and does not
install a boot service. Authentication and extraction checks do not certify the
semantic correctness of every possible PDF or every generated interpretation.
