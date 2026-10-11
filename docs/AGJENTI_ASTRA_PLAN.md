# Agjenti.app — Plan implementimi për Astra

**Objektivi:** Një engine i besueshëm për Instagram, WhatsApp dhe Chat Lab, me routing, suspend/resume, ruajtje state dhe delivery të sigurt.

**Evidenca:** Bazuar në auditimin statik të Cursor. Referencat dhe rreshtat duhet të verifikohen në branch-in aktual. Auditimi nuk ka ekzekutuar testet.

## Udhëzime detyruese

Astra: kontrollo `git status`, mos mbishkruaj ndryshime lokale. Për çdo fazë ndiq **inspekto → riprodho me test → implemento ndryshimin minimal → ekzekuto teste → raporto**. Mos bëj push/deploy, migrime destruktive, pagesa, porosi ose mesazhe reale pa miratim. Mos ndrysho `.env`/secrets. Mos rindërto editorin apo engine nga zero. Mos aktivizo schema-v3 globalisht pa migrim të sigurt dhe rollback. Raporto skedarë/rreshta, teste, rreziqe dhe ndryshime të mbetura.

## Arkitektura aktuale (sipas auditimit)

| Mjedisi | Ekzekutimi |
|---|---|
| Chat Lab/Test | schema-v3 coordinator, suspend/resume |
| WhatsApp production | queue + schema-v3 |
| Instagram pilot në `SHARED_WORKFLOW_BUSINESS_IDS` | queue + schema-v3 |
| Instagram jashtë pilotit | legacy single cursor, pa suspend/resume paralel |
| `simulateProductWorkflow` | `linearPreview`, rrugë tjetër |

`process-conversation-message.ts` (~133–137) ka kusht që kalon te `processBookingTurn(...) ?? processAgentTurn(...)`. Ekzistojnë `conversation_states.collected`, `revision` në queue, `context.profile`, `context.order`, `processes`, `recentMessages`, pinned workflow versions. AI bën klasifikim, nxjerrje faktesh dhe përgjigje, por **nuk ka dynamic tool-calling loop**. `order_ready` nuk krijon automatikisht porosi; krijimi bëhet nga stafi.

**Synimi:** Webhook → validation/deduplication → durable queue → serializim për participant → load state/profile → **një schema-v3 coordinator** → workflow executor → prepare reply/state → provider delivery/reconciliation.

## Faza 0 — Verifikimi i baseline

1. Ndiq lifecycle në `src/app/api/webhooks/meta/route.ts`, `handle-inbound.ts`, `process-conversation-message.ts`, `workflow-queue.ts`, `guidance.ts`, visual executor dhe adapters e testit.
2. Verifiko çdo kusht `mode`, `bookingGuard`, `schemaVersion`, `visualPreview`, `SHARED_WORKFLOW_BUSINESS_IDS`.
3. Gjej të gjitha writes në `conversation_states.collected` dhe `revision`.
4. Ekzekuto baseline unit/integration, lint, typecheck sipas skripteve reale.
5. Krijo `docs/orchestration-baseline.md` me call graph, file:line, teste dhe rreziqe.

**Pranimi:** dokumentim i verifikuar, pa ndryshim behavior.

## Faza 1 — P0: Integriteti i state

### 1.1 Migrimi v2 → v3

**Gjetja:** `conversation-processes.ts` (~57–59) e klasifikon çdo visual cursor të papërfunduar si order; booking mund të humbasë `booking.visual`.

- Identifiko llojin real të graph/cursor, jo vetëm statusin.
- Migro vetëm order/product te `processes.order`; ruaj booking cursor, bindings, pending field dhe pinned version te `processes.booking.visual`.
- Bëje migrimin idempotent dhe backward-compatible.
- Testo empty state, pending order, pending booking, handoff, completed, partial state dhe migrim të përsëritur.

**Pranimi:** asnjë booking nuk bëhet order; cursor-i nuk humbet.

### 1.2 Race conditions Instagram legacy

**Gjetja:** `route.ts` (~69–71) përdor `Promise.all`; legacy upsert nuk kontrollon `revision`.

- Riprodho me dy mesazhe njëkohësisht nga i njëjti participant.
- Prefero durable queue me per-participant lock; jo mutex vetëm në memorie.
- Për periudhën tranzitore siguro serializim ndër-instanca ose revision checks/retry idempotent.
- Testo participantë të ndryshëm, duplicate webhook dhe rendin e mesazheve.

**Pranimi:** pa lost updates, cursor overwrite apo duplicate actions.

### 1.3 Inbound insert failure

**Gjetja:** `handle-inbound.ts` (~267–274) në legacy vazhdon pas insert failure.

- Duplicate-key trajtoje idempotentisht; DB failure tjetër ndaloje dhe bëje retryable.
- Shto correlation ID/structured logging.
- Testo duplicate, timeout dhe DB error.

**Pranimi:** pa përgjigje për mesazh hyrës të paruajtur.

## Faza 2 — P1: Unifikimi i coordinator

1. Normalizo inbound event: provider, businessId, participantId, externalMessageId, timestamp, text, attachments.
2. Kalo tenantët e migruar nga queue te schema-v3 coordinator.
3. Ruaj feature flag për rollout/rollback; mos fshi legacy para testimit.
4. Shto **production-mode test** pa `mode: "test"` dhe pa `bookingGuard`: order → booking → resume order.
5. Siguro profile hydration, pinned graph dhe migrim korrekt për thread-et ekzistuese.
6. Shto trace: message ID, channel, workflow version, routing decision, revision, latency; mos ekspozo secrets/PII.
7. Rollout vetëm me miratim: internal → pilot → disa tenantë → global.

**Pranimi:** test dhe production-mode ndajnë logjikën e routing/state; rollback i sigurt.

## Faza 3 — P1: Kontekst dhe handoff

### 3.1 Early returns pa history

**Gjetja:** `process-conversation-message.ts` (~176–179, ~185) kthen `plainResult` pa `rememberTurn`, `lastDecision`, `conversationRouting`.

- Centralizo finalizimin në `finish`/helper ekuivalent, pa regjistrim të dyfishtë.
- Testo disambiguation → “ku?”, stale confirmation → follow-up.

**Pranimi:** çdo turn përfshihet në recentMessages/trace sipas retention policy.

### 3.2 Context-aware routing

- Dallo `continue`, `clarify`, `switch`, `suspend`, `resume`, `cancel`, `handoff`.
- Në pending prompt dallo përgjigje të fushës, pyetje sqaruese dhe intent të ri.
- `clarify` nuk konsumon pending field; `switch` ruan snapshot; `resume` kërkon sinjal të qartë.
- Një `Po` i shkëputur nuk konfirmon porosi të pezulluar; ruaj përgjigjet e shkurtra kur prompt aktiv i zotëron.
- Testo me model mock dhe fallback pa `OPENAI_API_KEY`.

**Skenar:** “Dua rezervim nesër” → “Për cilin shërbim?” → “Çfarë shërbimesh keni?” duhet të japë sqarim dhe të ruajë procesin. Nëse biznesi nuk ka rezervime, mos premto rezervim.

### 3.3 Handoff

**Gjetja:** engine përdor `advisoryHandoff: true`; `advanceVisualWorkflow` ndalon në status `handoff`.

- Përcakto semantikën `advisory` vs `pausing`.
- Testo mesazh pas handoff, rikthim nga stafi, reaktivizim dhe failure.
- Mos thuaj “stafi do t'ju kontaktojë” pa krijuar/konfirmuar handoff real.

**Pranimi:** asnjë mesazh nuk humbet në handoff.

## Faza 4 — P1: Delivery dhe queue reliability

### 4.1 Cursor avancon para delivery

- Projekto outbox/pending transition me status `prepared`, `sent`, `failed`, `uncertain` dhe provider message ID.
- Mos e konsidero pyetjen të marrë nga klienti para konfirmimit të dërgimit.
- Mos bëj rollback naiv të side effects të kryera; reconciliation dhe retries duhet të jenë idempotentë.
- Testo send timeout, failure, duplicate worker, crash pas prepare.

### 4.2 WhatsApp enqueue

**Gjetja:** `route.ts` (~49–53) injoron `enqueueWorkflowMessage === false`.

- Dallo Meta test/disconnected number nga transient errors.
- Shto log, retry/dead-letter dhe acknowledgement të saktë, pa retry të pafund për payload invalid.

### 4.3 Instagram messaging window

- Verifiko politikat aktuale Meta sipas kanalit dhe llojit të mesazhit.
- Apliko validator të përbashkët në momentin e send, edhe për delayed jobs.
- Testo brenda/jashtë dritares; mos supozo rregull universal 24-orësh.

### 4.4 Queue failure policy

**Gjetja:** `runWorkflowQueue` (~83–86) ruan gabim gjenerik dhe lease extension; pas disa claims mund të pauzojë bisedën.

- Kategorizo `retryable`, `permanent`, `uncertain`.
- Shto backoff, dead-letter/manual recovery, structured errors dhe metrika.
- Mos ridërgo automatikisht reply potencialisht të dërguar.

### 4.5 `unread_count`

**Gjetja:** vendoset në `1` në çdo inbound.

- Përcakto nëse është count apo boolean; nëse count, increment atomik dhe reset pas leximit.
- Testo mesazhe konkurrente.

## Faza 5 — P1: Pariteti test/production

1. Ndaj core routing/execution nga adapters për side effects.
2. Simulation nuk bën writes reale për bookings/orders/messages/payments.
3. Test order status sot është përgjigje fikse; përdor fixtures për statuse të ndryshme.
4. `simulateVisualWorkflow` përdor draft graph/hash, production pinned published version; dokumento dhe testo dallimin.
5. `simulateProductWorkflow` përdor `linearPreview`; unifiko ose etiketo si legacy preview.
6. Production attachments nuk interpretohen realisht (kryesisht `hasPhoto`); mos premto analizë fotoje.
7. Krahaso transkripte identike me fixtures në test dhe production-mode.

**Pranimi:** të njëjtat input/state/graph prodhojnë të njëjtat routing/state transitions; side effects janë të mock-uara në test.

## Faza 6 — P2: Business capabilities (përmirësim, jo bug)

1. Konfiguro `knowledge`, `products`, `order_status`, `booking`, `handoff`, `restock_notifications` për çdo biznes.
2. Mos route te workflow joaktiv ose pa integrim real.
3. Për biznes vetëm me PDF, mos ofro rezervime nëse nuk ekzistojnë shërbime.
4. Log action requested/executed/succeeded/failed dhe external ID; mos premto sukses pa rezultat real.
5. Në editor shto “Kur aktivizohet”, shembuj, input fields, fallback dhe execution trace.

## Faza 7 — Roadmap i veçantë, JO pjesë e bugfix

Dynamic tool-calling me permissions/audit; krijim automatik porosish dhe pagesa; anulim/riplanifikim rezervimesh; attachment understanding në production; AI workflow editing me diff, validation, simulation dhe approval. **Mos i implemento pa kërkesë dhe miratim të veçantë.**

## Testet minimale të pranimit

| ID | Skenari | Pritshmëria |
|---|---|---|
| T01 | Dy mesazhe njëkohësisht | Pa lost updates |
| T02 | Duplicate webhook | Një ekzekutim |
| T03 | Booking legacy → v3 | Ruhet cursor |
| T04 | Order → booking → resume | Rikthehet order snapshot |
| T05 | `Po` pa pending prompt | Kërkon sqarim |
| T06 | Pyetje sqaruese në booking | Ruhet pending booking |
| T07 | Disambiguation → “ku?” | Kontekst i plotë |
| T08 | Handoff → mesazh | Nuk humbet |
| T09 | DB insert failure | Nuk përgjigjet pa persistencë |
| T10 | Send timeout | Pa duplicate / state i sigurt |
| T11 | WhatsApp enqueue false | Error i kontrolluar |
| T12 | Instagram delayed send | Policy e respektuar |
| T13 | 3 unread messages | Counter i saktë |
| T14 | Test vs production-mode | Routing/state parity |
| T15 | Booking disabled | Nuk premtohet rezervim |

## Raporti që duhet të japë Astra pas çdo faze

```markdown
### Faza X — Rezultati
- Statusi: completed / partial / blocked
- Gjetjet e verifikuara: file:line
- Skedarët e ndryshuar dhe arsyeja
- Testet e shtuara / ekzekutuara dhe rezultatet
- Ndikimi në compatibility dhe migration
- Rreziqet e mbetura / rollback
- Hapi tjetër dhe çfarë kërkon miratim
```

**Rendi:** Faza 0 → 1 (P0) → 2 → 3 → 4 → 5 (P1) → 6 (P2). Ndal rollout-in nëse migrimi, concurrency ose delivery nuk kalojnë testet. Faza 7 është vetëm roadmap.

**Kriteri final i suksesit:** Një mesazh, një coordinator, një state i besueshëm për të gjitha kanalet e migruara; suspend/resume i testuar; pa lost updates, përgjigje të dyfishta apo premtime për veprime të pakryera; observability dhe rollback funksional.
