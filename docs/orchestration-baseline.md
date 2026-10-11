# Orkestrimi — baseline dhe ndjekja e planit

Verifikuar më 11 tetor 2026, mbi commit `9e5445e7a9b38af4460e449507beee9363c1b8cc`.
Plani burim: [AGJENTI_ASTRA_PLAN.md](AGJENTI_ASTRA_PLAN.md), kopje e pandryshuar e dokumentit të përdoruesit.
Ky skedar mban progresin dhe korrigjimet ndaj auditimit fillestar; nuk shënon një fazë si të përfunduar vetëm sepse ekziston një pjesë e implementimit.

## Progresi

| Faza | Statusi | Rezultati / hapi pasues |
|---|---|---|
| 0 — Baseline | Përfunduar | Rrugët, shkrimet e state, kushtet dhe kontrollet të dokumentuara më poshtë; pa ndryshim sjelljeje. |
| 1.1 — Migrimi v2 → v3 | Përfunduar lokalisht | Cursor-i klasifikohet me graph-in e fiksuar dhe ruhet te procesi përkatës. 23 teste të reja; shih raportin më poshtë. Pa push/deploy. |
| 1.2 — Konkurrenca Instagram | Korrigjimi publikuar | Queue për të gjitha lidhjet reale; revision/lease/FIFO verifikuar. Mbetet zgjerimi i provës me participantë të ndryshëm për mbulimin e plotë të planit. |
| 1.3 — Dështimi i ruajtjes inbound | Pjesërisht e mbuluar | Rruga me job ndalon në DB error; rruga direkte dhe raportimi i gabimeve kërkojnë trajtim/teste. |
| 2 — Një coordinator | Në pritje | Siguria e queue nuk nënkupton kalim global në schema-v3. |
| 3 — Konteksti/handoff | Në pritje | Ka suspend/resume dhe retention, por edhe early returns pa finalizim. |
| 4 — Delivery/queue | Pjesërisht ekziston | Ka prepared/sending/sent/uncertain; mungojnë pjesë të politikës së gabimeve dhe kontrollit të dërgimit. |
| 5 — Pariteti test/production | Në pritje | Adapterët dhe previews kanë dallime të dokumentuara. |
| 6 — Aftësitë e biznesit | Në pritje | Verifiko dhe ripërdor kontrollet ekzistuese të moduleve/shërbimeve para zgjerimit. |
| 7 — Roadmap | Jashtë implementimit aktual | Kërkon kërkesë dhe miratim të veçantë. |

Ritmi: një fazë ose nënfazë e kufizuar → test që riprodhon problemin → ndryshim minimal → verifikim → përditësim i këtij statusi. Publikimi i korrigjimit të mëparshëm nuk autorizon automatikisht rollout global të coordinator-it.

## Rruga reale e mesazhit

```text
Meta webhook POST
  → verifikim firme + parse sipas kanalit
  → enqueueWorkflowMessage (deduplikim connection_id/external_id)
  → ACK; after/runWorkflowQueue ose rikuperimi nga cron
  → claim_workflow_inbound(NULL): një mesazh për participant/lidhje
  → handleInboundMessage: lidhja, biseda, ruajtja inbound, state + revision
  → processConversationMessage
      → legacy booking/agent për Instagram-in ende jashtë migrimit
      → coordinator schema-v3 për rrugët e migruara
  → prepare_workflow_reply: kontroll lease/revision, state + reply atomik
  → begin_workflow_send: kontroll pronësie dhe gjendje sending
  → adapter Instagram/WhatsApp
  → finish_workflow_send: sent ose uncertain; ruajtje rezultati
```

Referencat janë relative ndaj root-it të repository-t; numrat u kontrolluan në baseline-in e sipërm.

- `src/app/api/webhooks/meta/route.ts:32`: firma, parse, queue, ACK dhe 503 për dështim. Në `:68` vetëm eventi sintetik i Meta-s anashkalon queue. `Promise.all` i mesazheve legacy është hequr.
- `src/lib/conversations/workflow-queue.ts:18`: kërkon lidhje connected, ruan job me upsert idempotent. `false` nënkupton event sintetik ose lidhje të pagjetur; DB error hedh exception. `:65` kërkon job për të gjithë tenantët, pavarësisht pilotit.
- `supabase/migrations/20261011220000_instagram_durable_queue.sql:5`: claim me FIFO sipas ID-së së futjes në queue, lease, row/advisory locks; sending me afat të skaduar bëhet uncertain. Ky rend nuk është garanci për rendin e timestamp-eve nëse provider-i i dorëzon eventet jashtë rendit.
- `src/lib/conversations/handle-inbound.ts:253`: ruajtja e mesazhit; `:292` lexon state dhe revision; `:302` hydration sipas kanalit/pilotit/context; `:320` thërret coordinator-in; `:334` përgatit rezultatin për queue.
- `src/lib/conversations/process-conversation-message.ts:83`: hyrja e përbashkët; `:139` migrimi i proceseve; `:142` versioni i graph-it; `:236` finalizimi normal dhe trace.
- `src/lib/workflows/guidance.ts:13`: ruan 10 mesazhet e fundit, maksimumi 1,200 karaktere secili; `:42` zgjedh navigimin, jo ekzekutimin e veprimeve.
- `src/lib/workflows/visual/runtime.ts:5`: avancon cursor-in; `:16` kontrollon versionin e fiksuar; `:17` ndalon në handoff. `visual/execute.ts:290` dhe `:320` përcaktojnë edhe handoff advisory.
- `supabase/migrations/20261011120000_whatsapp_channel.sql:112`: implementimi aktual i prepare; `:128` shkruan state dhe rrit revision. `:135` begin-send dhe `:151` finish-send kontrollojnë dërgimin. Funksionet e vjetra në migrimet e mëparshme zëvendësohen nga ky migrim.
- `src/lib/conversations/channel.ts:4`: zgjedh tabelën, identitetin dhe dërguesin sipas kanalit. Nuk është coordinator i dytë.

## Kushtet që duhen ruajtur gjatë ndryshimeve

| Kushti | Sjellja e verifikuar |
|---|---|
| `linearPreview` | `process-conversation-message.ts:132` delegon direkt te processAgentTurn. Preview i produktit e thërret vetë atë funksion. |
| `mode === "test"` | Anashkalon degën legacy në `:134`; laboratori përdor coordinator-in. Nuk provon vetvetiu rrugën production. |
| `bookingGuard` | Dëshmi e job/lease/revision për efektet në DB. Nuk duhet shpikur për të detyruar një rrugë testi. |
| `source === "instagram"` jashtë pilotit | Në `:133–137`, state ende jo-v3 vazhdon te booking/agent legacy edhe kur ka queue guard. |
| `schemaVersion === 3` | Nuk hyn në degën legacy, edhe nëse hiqet biznesi nga lista e pilotit. Heqja e flag-ut vetëm nuk është rollback i plotë i state të migruar. |
| `visualPreview` | Përdor draft graph dhe ID hash, anashkalon degën legacy; production lexon versionet e publikuara/fiksuara. |
| `SHARED_WORKFLOW_BUSINESS_IDS` | `context.ts:30` dhe coordinator-i kontrollojnë migrimin e sjelljes; queue tashmë është globale për lidhjet reale. |

## Shkrimet në state dhe revision

- `handle-inbound.ts:216`: inicializimi i një bisede; `:297`: krijim idempotent nëse state mungon, pa mbishkrim të ekzistuesit.
- `handle-inbound.ts:340`: upsert legacy pa revision. Mbetet në kod, por webhook-u aktual nuk e përdor për mesazhe reale Instagram/WhatsApp.
- `20261011120000_whatsapp_channel.sql:126–128`: prepare kontrollon revision nën lock dhe ruan `collected`, `workflow_id`, `step_key`, status dhe revision + 1 në të njëjtën transaksion me reply.
- `20261010143000_shared_workflow_context.sql:14`: shton revision; `:48` plotëson linearSnapshot gjatë migrimit historik.
- `src/lib/instagram/meta-compliance.ts:129`: fshin përmbajtjen e state për kërkesë privatësie pa rritur revision. Duhet kontrolluar ndërveprimi me worker-at në planin e integritetit; kjo fazë nuk e riprodhoi si race.
- `src/app/api/businesses/[id]/conversations/[conversationId]/orders/route.ts:146`: ndryshon vetëm statusin në submitted. Leximi për klientin në rrugën `customer/route.ts:58` nuk shkruan `collected`.

## Gjetjet dhe korrigjimet ndaj planit fillestar

1. **1.1 mbetet problem i konfirmuar në kod:** `conversation-processes.ts:57–60` konsideron çdo visual cursor jo-completed/handoff si porosi. `:61` krijon booking nga draft/nonce pa kopjuar visual/versionId. `bookingAdapterState` në `:74` lexon vetëm `processes.booking.visual`, prandaj cursor-i i migrimit duhet testuar dhe ruajtur shprehimisht. Riprodhimi me test negativ është puna e parë e Fazës 1.1.
2. **1.2 nuk duhet riimplementuar:** commit `9e5445e` kaloi të gjitha mesazhet reale Instagram në queue. Prova PostgreSQL me dy sesione konfirmoi FIFO, bllokimin e claim-it konkurrues, refuzimin e revision të vjetër dhe ruajtjen kumulative. Nuk pretendohet exactly-once për çdo efekt të jashtëm ose përgjigje AI.
3. **1.3 kërkon dallimin job/direkt:** `handle-inbound.ts:275` hedh error për job në çdo insert error përveç `23505`. Rruga direkte ende vazhdon. Deduplikimi kryesor është job unik; retry i job-it mund të gjejë inbound të ruajtur më parë.
4. **3.1 konfirmohet:** `process-conversation-message.ts:180` dhe `:186` kthejnë plainResult përpara helper-it finish, pa rememberTurn/lastDecision/conversationRouting në ato degë.
5. **4.1 nuk nis nga zero:** prepared reply dhe state ruhen atomikisht, por state avancon përpara konfirmimit të delivery. Ka uncertain dhe pauzim; nevojitet verifikim i semantikës së pending prompt dhe rikuperimit, jo një outbox paralel.
6. **4.3 konfirmohet si boshllëk në send:** `workflow-queue.ts:50` e kryen kontrollin e dritares vetëm për WhatsApp; kushti lejon Instagram pa atë kontroll. Politika aktuale e Meta-s nuk u verifikua online në këtë fazë; kjo bëhet para implementimit të 4.3.
7. **4.4/4.5 mbeten:** catch në `workflow-queue.ts:82` ruan mesazh gjenerik; claim ka kufi tentativash. `handle-inbound.ts:204` dhe `:233` vendosin unread_count në 1, jo increment.
8. **5 ka dallime reale:** Chat Lab (`agents/test-chat/actions.ts:107`) përdor mode test; visual preview (`workflows/visual/test-actions.ts:21`) përdor draft/hash; product preview (`workflows/linear-test-actions.ts:31`) përdor rrugën lineare. `orders/customer-status.ts:104` në izolim kthen shpjegim prove, jo fixtures me statuse. Production inbound kalon tekst dhe hasPhoto (`handle-inbound.ts:326`), ndërsa Lab përgatit attachmentContext (`agents/test-chat/actions.ts:94`).
9. **6 ka kontrolle ekzistuese:** `calendar/agent.ts:65` kontrollon modulin bookings dhe `:82` filtrin booking_enabled. Testi i coordinator-it në `process-conversation-message.test.ts:162` mbulon heqjen e aftësisë së rezervimit nga graph v2. Mos i zëvendëso pa arsye me një sistem tjetër konfigurimi.

## Kontrollet dhe kufijtë e provës

Ekzekutuar gjatë Fazës 0 mbi checkout-in aktual:

- `npm test`: **145 skedarë, 1,079 teste kaluan**. Paralajmërim ekzistues Vite për formatin e konfigurimit.
- `npx tsc --noEmit`: kaloi.
- `npm run lint`: **0 gabime, 7 paralajmërime ekzistuese** (6 për img dhe 1 variabël e papërdorur).
- Dokumenti burim kopjohet pa ndryshim; ndryshimet e kësaj faze janë vetëm dokumentim.

Integrimi PostgreSQL u verifikua gjatë korrigjimit 1.2 në të njëjtin commit dhe nuk u përsërit pa ndryshim kodi: `python3 supabase/tests/instagram_queue_concurrency.py --pg-bin /opt/homebrew/opt/postgresql@17/bin`. Kaluan migrimet në DB të izoluar, `shared_workflow_context.sql`, `workflow_message_runtime.sql` dhe prova me dy worker-a. Nuk janë ekzekutuar të gjitha SQL suites e repository-t.

Këto teste nuk provojnë automatikisht çdo kriter T01–T15 të planit. Veçanërisht mbeten testi negativ i migrimit booking, pariteti i plotë production/test, dritarja e dërgimit dhe rikuperimi nga dështime reale të provider-it. Nuk u dërguan mesazhe klientësh dhe nuk u krijuan porosi/rezervime reale gjatë Fazës 0.

Në turnin e mëparshëm u konfirmuan migrimi `20261011220000`, push-i `9e5445e` dhe deployment Production në Vercel. Mbrojtja e përkohshme e kalimit u hoq dhe funksioni u krahasua me migrimin. Ky është rezultat i atij publikimi, jo një kontroll i ri live nga Faza 0.

Ndryshimet lokale në `src/app/landing.css`, `src/app/page.tsx` dhe `src/components/landing/landing-interactive.tsx` ekzistonin përpara kësaj faze; nuk janë pjesë e këtij plani apo këtij ndryshimi. Kontrollet e plota u ekzekutuan me ato ndryshime të pranishme.

## Plani i Fazës 1.1 (i realizuar më poshtë)

1. Shto fixtures për gjendje legacy booking/order, handoff, completed dhe state të pjesshme.
2. Riprodho me test që dështon humbjen/keqklasifikimin e booking visual, përfshirë binding, pending field dhe version të fiksuar.
3. Korrigjo migrimin sipas evidencës së llojit të rrjedhës; për rastet e paqarta ruaj të dhënat dhe mos hamendëso order.
4. Verifiko migrimin e përsëritur, suspend/resume dhe regresionet ekzistuese.
5. Përditëso këtë raport me rezultatin. Pa aktivizim global schema-v3; push/migrimi/rollout trajtohen veçmas pas rishikimit.


## Faza 1.1 — Rezultati (11 tetor 2026)

- **Statusi:** completed në kodin lokal; pa commit/push/deploy në këtë fazë.
- **Riprodhimi:** suite e re e migrimit fillimisht dha 8 dështime / 3 kalime në implementimin e vjetër. Testet e coordinator-it riprodhuan edhe migrimin pa draft dhe ndërprerjen për status porosie. Një test shtesë riprodhoi booking të futur brenda një flow me etiketë order.
- **Ndryshimi:** `src/lib/workflows/conversation-processes.ts` pranon versionin e fiksuar të graph-it dhe klasifikon cursor-in sipas nyjës/flow-t, jo thjesht pranisë së një visual state. Ruan booking draft/nonce, visual, versionId, binding, vlerat, awaiting, forceCollect dhe branchPorts. Porosia e veçantë nuk merr cursor-in e rezervimit. Completed/handoff nuk riaktivizohen gjatë migrimit. State i panjohur ruhet pa shpikur porosi vetëm nga cursor-i; draft-i i pavlefshëm nuk krijon proces aktiv.
- **Integrimi:** `src/lib/conversations/process-conversation-message.ts` lexon versionin e ruajtur përpara migrimit, si në hyrjen normale, ashtu edhe në ndërprerjen për status porosie. `bookingAdapterState` kopjon cursor-in që ndryshimet e adapter-it të mos prekin snapshot-in e rezervimit.
- **Testet:** `conversation-processes.test.ts` ka 19 raste: bosh/partial, booking me/pa draft, visual V1/V2, pending collect që vazhdon realisht në runtime, binding/version, porosi e pavarur, completed/handoff, service jo-bookable, graph i paqartë dhe idempotencë. `process-conversation-message.test.ts` shton 4 raste për production me guard dhe pa mode test, status interruption, switch dhe resume me versionin origjinal.
- **Kontrollet finale:** `npm test` — 146 skedarë, **1,102 teste kaluan**; `npx tsc --noEmit` kaloi; ESLint në katër skedarët e prekur pa gabime/paralajmërime; `git diff --check` kaloi. Paralajmërimi i konfigurimit Vite mbetet i njëjtë.
- **Compatibility:** migrimi është në aplikacion, kur biseda hyn te coordinator-i; nuk kërkon migrim SQL. Nuk ndryshon queue, feature flags, API publike, editorin apo aktivizimin global schema-v3. State me `processes` ekzistuese mbetet i pandryshuar gjatë një migrimi të përsëritur.
- **Kufijtë:** nuk rikonstrukton të dhëna që janë humbur përpara këtij korrigjimi dhe nuk riparon automatikisht state v3 të migruar gabim më herët. Kur lloji nuk mund të përcaktohet nga evidenca, ruhet visual origjinal; nuk pretendohet vazhdim automatik për graph të paqartë. Versioni i munguar/refuzuar nuk zëvendësohet me publikimin më të fundit. Testet përdorin të dhëna sintetike; nuk ka porosi, rezervime apo mesazhe reale.
- **Publikimi/kthimi:** ndryshimi mbetet lokal për rishikim. Nuk nevojitet kthim skeme DB; pas një publikimi, rikthimi i kodit nuk zhbën state që tashmë është ruajtur nga bisedat. Mos e përdor heqjen e pilot flag-ut si pretendim për rollback të plotë.
- **Hapi pasues:** plotëso verifikimin e mbetur të 1.2 për participantë të ndryshëm/deduplikim, pastaj vazhdo 1.3 (dështimi i ruajtjes inbound). Korrigjimi i queue i publikuar nuk duhet riimplementuar.
