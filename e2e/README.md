# Isolated local acceptance environment

Status (2026-10-23): **Package 2B local acceptance PASS after service routing correction; full C1 model planning UNVERIFIED**.
This is test infrastructure, not a replacement workflow/runtime implementation.

## Package 2B final correction — local, not deployed

Verified on `main` based on `c3bb863`, using the retained
`recovery-20261023` disposable instance, not the original local stack.

- Reproduced the earlier service-relative failure before runtime changes. The
  owner clarified that a bare service reference must remain informational;
  process tests now supply explicit intent, while retaining ID/cursor assertions
  and adding negative assertions for bare references.
- The coordinator preserves explicit `service` intent and a one-turn, expiring
  selection prompt bound to tenant, delivered reply, candidate IDs and version.
  It reuses catalog/module/runtime guards and never treats that prompt as approval.
- Also reproduced/fixed `vazhdo` after an information interruption being consumed
  as numeric budget input. Resume now re-prompts the pinned cursor without
  consuming navigation or restoring old confirmations.
- Final local browser gate: 14/14 application scenarios and 4/4 service cases.
  The pending-selection case additionally passed with a real selected-service
  session transplanted to another tenant: authentication/session validation denied it.
- The exact browser-returned pending/selected states round-trip through the real
  PostgreSQL `prepare_workflow_reply` RPC; stale revision is rejected. This SQL
  check rolls back. Test Chat itself persists sealed sessions, not channel DB rows.
- PostgreSQL 17.11 Package 1 transport/concurrency regressions pass. Focused
  Vitest: 479 tests; full suite: 2,195 tests in 209 files. TypeScript passes;
  ESLint has zero errors and seven existing warnings. No new migration.
- Service fixtures use a unique pair per run and are deactivated afterward;
  historical fixtures/immutable versions are retained. `Landing page` is used
  as field input because `Website` also matches older synthetic catalog entries;
  ambiguous catalog references still require clarification, not arbitrary selection.

Private evidence: `2b-final-reproduced.log`, `2b-service-final.log`,
`2b-service-tenant-final.log`, `2b-application-final.log`, their result JSON,
`2b-final-postgres.log`, `2b-final-targeted.log`, `2b-final-vitest.log` and
`2b-final-database.log` under the instance directory. Earlier failure logs are
retained. Never commit session tokens or fixture credentials.

This closes the local routing/continuity gate, not live Instagram/WhatsApp,
LLM answer quality, external date extraction or provider execution certification.
C1 is unchanged. No Package 3 implementation, commit, push or deployment.

## Recovery gate — 2026-10-23

Checkout: `main`, `3834a65`. Application source and migrations were not changed.
The original stack, volumes, `.e2e-local/migrations.json`, `.env.local`, and
unrelated audit documents were preserved. Only test infrastructure/scenarios changed.

### Migration diagnosis

Original manifest: 60 files, all recorded hashes match the repository. Current
chain: 64 files. The four missing names are:

- `20261020104503_migo_private_conversations.sql`
- `20261020112745_assistant_identity_neutralization.sql`
- `20261021150000_mobile_notifications.sql`
- `20261022221309_conversation_transport_reliability.sql`

The manifest timestamp is October 18, before those changes. The first two migrations'
effects nevertheless exist in the old database: all 32 selected schema-dump blocks
for the assistant tables, compatibility views, writers, constraints, policies and
ACLs match the fresh chain. They were not recorded by this runner; how/when they
were installed is not established. Mobile tables and Package 1 helpers were absent.
This is unrecorded schema drift, not four conclusively unapplied migrations.
Neither stack has a `supabase_migrations.schema_migrations` ledger: this runner
uses direct transactional SQL and a hash manifest, not the CLI migration writer.
No historical records were fabricated or repaired.

### Separate disposable instance

`E2E_INSTANCE=recovery-20261023` selects project
`agjenti-e2e-local-recovery-20261023`, network
`agjenti_e2e_isolated_recovery-20261023` and private files under
`.e2e-local/instances/recovery-20261023/`. The original default remains unchanged.
The fresh stack applied all 64 files, retaining W0-B's rejection/acknowledgement
checks. All 64 SHA-256 hashes matched. PostgreSQL 17.11, Auth and PostgREST ran
locally; network, RLS and RPC checks passed. No hosted project was linked.

The same fixed loopback ports remain protected by the existing network guard.
Only ONE transport/app instance may run at once; a port conflict must stop startup,
never kill an unrelated listener. Container networks and volumes are separate.
App startup now rechecks the complete migration manifest, not just its existence.

For a new recovery run, choose a NEW `recovery-*` instance name (lowercase, max
32 characters), export it in each terminal, and use the existing commands:

1. `node e2e/transport.mjs`
2. `node e2e/local.mjs up`, then `node e2e/fixtures.mjs`
3. `node e2e/local.mjs app`
4. `node_modules/.bin/playwright test --config e2e/playwright.config.mjs e2e/application.spec.mjs --max-failures=1`
5. Immediately before the C1 gate, run
   `node_modules/.bin/vitest run --config e2e/vitest.recovery.config.mjs`, then
   `node_modules/.bin/playwright test --config e2e/playwright.config.mjs e2e/recovery-gate.spec.mjs --max-failures=1`.
6. Stop only this app, then `node e2e/local.mjs down`, then its transport.
   Volumes and evidence are retained. Never delete an old manifest to force replay.

C1 proposal preparation uses the actual server validator and real database, but
an explicitly synthetic intent instead of LLM planning. Tickets expire normally;
the preparer refuses to overwrite prior ticket evidence. Use a fresh instance for
a clean rerun, not replays or hand-edited revisions on old fixtures.

### Verified results and boundaries

- Application suite: 12 scenarios passed, plus appointment fail-closed and Chat
  Lab passed in a targeted run (14 unique scenarios). Original bare-name inputs
  incorrectly assumed automatic order/booking intent after 2A/2B. The corrected
  inputs explicitly request ordering/booking; expected field/state behavior was
  retained, and bare references are asserted not to start those processes.
- Covered real login, tenant/RLS rejection, draft preview, size/quantity,
  interruption/resume/cancel, stale preview/session, missing binding, module OFF,
  immutable A/B pinning, quote fields, information-only handling and real SQL RPC
  authorization/revision rejection. Test-chat persistence is sealed browser state,
  not a claim of live inbound-channel persistence.
- C1: 5 checks passed. The actual authenticated confirmation API saved inactive
  and active instructions plus durable receipts; replay, stale and cross-tenant
  requests were rejected/recovered correctly. Runtime hashes and draft/published/
  pinned provenance matched actual reads. `behaviorVerified` remained false.
- The complete natural-language Owner Assistant → approval-card flow is NOT
  certified: without an AI key, the actual planner returns its configuration
  error. No API interception or model response was substituted as real E2E.
- New confirmed failing boundary: a quote catalog with `E2E Website` and
  `E2E Website Plus` presents two real services and persists their display order.
  Replying `shërbimin e dytë` returns the informational fallback instead of
  `project_type A?`; no service process/binding is established. The regression
  remains failing; service interruption/resume after that point was not executed.
  Source inspection identifies the conflicting routing rule in
  `process-conversation-message.ts:349–364`: a resolved service reference sets
  `informationRequest: !booking`. Non-booking custom service flows therefore enter
  `ordinaryQuestion` at line 493 and skip service entity execution at line 609.
  This explains the observed information route; no application fix was made.
- Package 1 real PostgreSQL tests passed on a separate fresh Unix-socket-only
  17.11 cluster: 64-file replay, atomic resume, stale revision/worker rejection,
  concurrent claims, retry exhaustion, receipt/replay and tenant boundaries.
  `shared_workflow_context.sql` also passed on the fresh full Supabase stack.
- Full application Vitest: 2171/208 PASS. Infrastructure: 17 PASS. TypeScript
  PASS. ESLint: 0 errors, 7 existing warnings. No orders, bookings, messages,
  inbound jobs or real integrations were created by the application E2E.

Evidence is private/ignored under the instance directory: `bootstrap.log`,
`migrations.json`, `schema-acl.log`, schema dumps, `transport-postgres.log`,
`application-e2e.log`, `appointment-lab.log`, `recovery-gate.log`, saved result
JSON and browser traces. Original failures are retained separately. These files
can contain synthetic sessions; do not publish them or commit fixture credentials.

Environment recovery: PASS. Package 2B certification: FAIL at the relative
service selection boundary. Package C1: PARTIAL (real persistence/provenance pass,
model planning/behavior unverified). Package 3: NO-GO pending review of that failure.

## Historical evidence — before this recovery

## Resumed preflight — stop before E2E

The current checkout is `main`, HEAD/local origin-main ref
`483c6e5a9e4eae2a8d0576ed8fd5af52665415af`, with unrelated staged/unstaged work
preserved. The existing Docker stack is local and isolated; no app or transport
was listening on 3103/55321/55322 at this check. No stack reset was performed.

The local migration manifest contains 60 entries; the repository contains 63.
All recorded file checksums match. These files are absent from the manifest:

- `20261020104503_migo_private_conversations.sql`
- `20261020112745_assistant_identity_neutralization.sql`
- `20261021150000_mobile_notifications.sql`

Read-only catalog inspection found `assistant_conversations`, `assistant_messages`,
`assistant_plan_snapshots`, their legacy `migo_*` views, and both conversation
writers. Existence alone does **not** prove that the first two files were fully
applied with their intended grants/policies. The `mobile_*` objects and notification
functions are absent. Do not reapply the first two migrations or extend the
manifest based only on object existence. `replay()` correctly refuses this
manifest mismatch; `app()` must not be used to bypass that prerequisite.

Required next gate: reconcile the existing local schema against execution evidence,
or review a fresh disposable stack with all 63 migrations while preserving the
current stack used by other work. Do not delete its volumes or invent migration
history. No external database or new migration was touched in this resumed check.

## Verified bootstrap recovery

- Docker Engine 29.7.2 is available. Dependencies are pinned to Supabase CLI
  2.121.0 and Playwright 1.64.1 in `package.json` / `yarn.lock`.
- PostgreSQL image `public.ecr.aws/supabase/postgres:17.11.0.004` starts healthy
  on the internal-only Docker network.
- On this Docker Desktop installation, the internal network has no published
  host port even though `HostConfig.PortBindings` requests port 55322.
- The old per-connection `docker inspect` takes about 3 seconds on this daemon.
  Supabase CLI's local DB bootstrap has a 2-second connection timeout; the
  PostgreSQL startup packet arrived before the forwarder was ready. PostgreSQL
  itself was healthy, listening on 5432, with no default egress route.
- `transport.mjs` now uses the local Docker Unix API: filtered container identity,
  project label and internal network checks, then real TCP via non-TTY exec `nc`.
  It decodes Docker's stdout frames without mocking database/API responses.
  Observed forwarding setup: 9–45 ms; real psql with a 2-second timeout: 158 ms.
  No bridge with external routing or production credentials was introduced.
- Migration replay now wraps files without their own transaction in BEGIN/COMMIT.
  Without that wrapper, `20261004130000_product_types_manage.sql` lost its
  `ON COMMIT DROP` temporary table between statements. The historical SQL is
  unchanged. All 59 migrations subsequently applied on a fresh local volume.
- Email login requires `[auth.email].enable_signup=true` in this CLI, which maps
  to `GOTRUE_EXTERNAL_EMAIL_ENABLED`. Global `[auth].enable_signup=false` keeps
  public registration disabled; fixture users are created by local Auth admin.
- The app/browser use one origin, `http://localhost:3103`. Next's dev redirect
  normalized 127.0.0.1 to localhost, dropping the host-only Auth cookie when the
  browser started on 127.0.0.1. The app still binds only to 127.0.0.1; the local
  Supabase API remains `http://127.0.0.1:55321`. No runtime code was changed.

Do not switch to a hosted URL, add real keys, remove internal-network checks,
or omit migrations to make startup appear successful.

## Intended reproducible commands

Prerequisites: Node/Yarn, Docker Desktop, the committed dependencies, and local
Chromium (`yarn playwright install chromium`). Image/browser downloads require
Internet during setup; no application credentials are used for downloads.

1. Terminal 1: `yarn e2e:transport` (loopback-only listeners; keep running).
2. Terminal 2: `yarn e2e:up` (full migration replay and synthetic fixture setup).
3. Only after successful replay/fixtures: `yarn e2e:app` in Terminal 2.
4. Terminal 3: `yarn e2e:isolation`, then `yarn e2e:test`.
5. Stop the app, run `yarn e2e:down`, then stop the transport with Ctrl-C.

All Docker operations target project `agjenti-e2e-local` and network
`agjenti_e2e_isolated`. Never stop or reset other Docker projects. `down` retains
data; there is no wildcard cleanup or automatic database reset. A partial
migration failure stops startup and requires review before creating a fresh
local stack; it does not retry partial SQL blindly.

## Isolation contract

- `.env.local` is never loaded or overwritten by this runner. A fresh source copy
  under ignored `.e2e-local/app-*` is used, including uncommitted application code.
- Child environment variables are allow-listed. Supabase URLs and disposable keys
  come only from the exact local CLI stack; any unexpected URL aborts.
- Containers must be attached only to the labeled internal Docker network. The
  transport accepts only 127.0.0.1 and forwards only three fixed local services.
- Application Node TCP/fetch accepts only local API 55321 and app 3103. TLS,
  external HTTP, other DB ports, named Unix sockets and UDP are refused. Chromium
  intercepts external HTTP and WebSocket routes; service workers are disabled.
- This preload guards the inspected Node application code; it is not a hostile
  native-code sandbox. Any future subprocess/native networking requires review.
- Fixture passwords, local keys/session evidence, app copies and browser results
  stay in ignored `.e2e-local` (private fixture file). Do not commit that directory.
- No production Meta, Google, OpenAI or provider credentials are supplied.

## Migration policy

The runner replays **all** repository migrations in filename order, unchanged,
and records SHA-256 hashes locally. A hash mismatch stops reuse. It does not run
`supabase db push`, link a project, or fabricate hosted migration history.

W0-B is not skipped. Before its local-only acknowledgement, the runner checks the
isolated network and empty Auth/orders/submissions/queue/integrations, captures
the ACL snapshot using the existing script, and proves that the original
unacknowledged SQL is rejected. Only this fresh private database has no legacy
deployments/dependencies. Its existing guard then runs unchanged. This is **not**
permission or evidence for applying W0-B to any external database.

All 59 files replayed successfully on PostgreSQL 17.11, including W4, W4-SEC,
W0-B and Package A. Do not manually delete volumes while retaining the private
migration/fixture manifests. If replay hits a schema/security dependency, report
the exact file/error instead of disabling guards or inventing a new baseline.

## Synthetic fixtures and coverage

| Tenant | Configured behavior | Auth boundary |
| --- | --- | --- |
| Retail | Product, text size, numeric quantity | Independent owner |
| Appointment | Booking service using existing booking node | Independent owner |
| Quote | Service custom flow, text project_type, numeric budget | Independent owner |
| Information | Knowledge flow, no order/booking modules | Independent owner |

There is a separate explicit platform-admin user for Chat Lab. Auto replies are
off and no channel/provider connections are seeded. Historical migration seeds,
if any, are newly created local data, not copies of an existing business.

`application.spec.mjs` targets real login, tenant dashboard and PostgREST/RPC
rejection, published retail, multi-turn collection, interruption/resume/cancel,
private draft preview, missing binding, stale preview, pinned A/B versions,
module deactivation, quote field ownership, information-only behavior, and Chat
Lab. Responses are checked alongside the application's real encrypted session
state. These are not mocked HTTP handlers. Publishing A/B in fixture setup uses
the SQL RPC and is not a claim of UI publication verification.

Test chat stores sealed state in browser session storage, not live conversation
rows. Reload tests cover only that persistence contract. The existing
`supabase/tests/shared_workflow_context.sql` passed against this real local stack,
covering state/profile atomicity, revision rejection, leases and tenant boundaries
(all fixtures rolled back). Independent-session queue concurrency and live
inbound persistence were not rerun through this stack.

The booking date extractor currently depends on an external LLM. With no API key
the only honest offline assertion is fail-closed behavior. Positive service/date
collection, cross-process switching and natural-language answer quality remain
UNVERIFIED. A future deterministic provider adapter must be labeled simulated,
not presented as real provider E2E. External order, booking and messaging
integrations remain deliberately outside this environment.

## Verification on the resumed checkout (2026-10-22)

- Infrastructure/Flight regression tests: 16/16 PASS, including attempted network
  calls blocked before IO. No actual provider requests were made.
- Application full suite: 204 files / 2060 tests PASS; these retain their existing
  mocked boundaries and do not constitute authenticated E2E.
- Targeted conversation/workflow/agent regressions: 44 files / 853 tests PASS.
- TypeScript: PASS. Changed-file ESLint: PASS.
- Repository-wide ESLint: 0 errors, 7 existing warnings.
- E2E-scoped staged/unstaged diff checks: PASS. Global staged diff check flags
  existing trailing whitespace in `docs/qa-audit/evidence/*.tap`; left unchanged.
- Docker local identity/internal-network checks: PASS. Existing PostgreSQL/Auth/
  gateway/storage/mail containers are healthy; PostgREST is running. Local counts:
  5 businesses, zero orders/messages/inbound jobs/integrations.
- `.env.local` remains unchanged (SHA-256
  `85138cda8678096cebfacb14f19c8180452214cc72a76aa3f60df6344e3e6eab`).
- Current migration/manifest agreement: FAIL. Authenticated UI/API/state on this
  checkout: UNVERIFIED; smoke and prepared suite were not started past that gate.
- The 59-file replay and PostgreSQL state regression described above are historical
  evidence from the earlier recovery, not verification of the current 63-file chain.

Package B acceptance remains **PARTIAL**. Do not promote this harness to a
Package C acceptance prerequisite until its bootstrap and real browser results
have been verified.
