# Orkestrimi — baseline dhe ndjekja e planit

Verifikuar më 11 tetor 2026, mbi commit `9e5445e7a9b38af4460e449507beee9363c1b8cc`.
Plani burim: [AGJENTI_ASTRA_PLAN.md](AGJENTI_ASTRA_PLAN.md), kopje e pandryshuar e dokumentit të përdoruesit.
Plani pasues: [AGJENTI_AGENTIC_ORCHESTRATION_PHASE2.md](AGJENTI_AGENTIC_ORCHESTRATION_PHASE2.md), kopje e pandryshuar e dokumentit të përdoruesit, shtuar më 11 tetor 2026. Ruajtja e tij si dokumentim nuk nis implementimin; përpara tij duhen verifikuar kushtet e Phase 1. “Phase 2” në titullin e këtij dokumenti është plani pasues i orkestrimit agentik, jo Faza 2 “Një coordinator” e tabelës më poshtë.
Ky skedar mban progresin dhe korrigjimet ndaj auditimit fillestar; nuk shënon një fazë si të përfunduar vetëm sepse ekziston një pjesë e implementimit.

## Progresi

| Faza | Statusi | Rezultati / hapi pasues |
|---|---|---|
| 0 — Baseline | Përfunduar | Rrugët, shkrimet e state, kushtet dhe kontrollet të dokumentuara më poshtë; pa ndryshim sjelljeje. |
| 1.1 — Migrimi v2 → v3 | Përfunduar, push `a8dda95` | Cursor-i klasifikohet me graph-in e fiksuar dhe ruhet te procesi përkatës. 23 teste të reja; deployment-i i këtij commit-i nuk është verifikuar. |
| 1.2 — Konkurrenca Instagram | Verifikimi përfunduar lokalisht | Korrigjimi i queue është publikuar më herët. Provat e zgjeruara kalojnë për FIFO, revision, cursor, participantë të ndryshëm dhe duplicate webhook; pa ndryshim të motorit. |
| 1.3 — Dështimi i ruajtjes inbound | Push `5c7f0ff` | Ruajtja konfirmohet përpara processor-it; duplicate verifikohet në bisedën përkatëse. 15 teste të reja; deployment-i nuk është verifikuar. |
| Shtesë — Mesazhe të njëpasnjëshme | Migrimi aplikuar në production; push `b5bcc25`, deployment Vercel i konfirmuar | Grupim Instagram 3s/10s/20 mesazhe, ruajtje e origjinaleve dhe njohje më e mirë e emrave. Shih kufijtë e provës më poshtë. |
| 2 — Një coordinator | Unifikimi i përzgjedhjes dhe provat përfunduar lokalisht | Politika e përbashkët ndahet nga autorizimi i efekteve; 1,201 teste kaluan. Piloti dhe bisedat v3 përdorin coordinator-in; rollout-i real mbetet i paekzekutuar. |
| 3 — Konteksti/handoff | Në pritje | Ka suspend/resume dhe retention, por edhe early returns pa finalizim. |
| 3.2A — Përgjigje të shkurtra dhe qëllimi i klientit | Push `d73053a`; verifikimi live dhe fushat sipas përmbushjes mbeten | “OK” pas informacionit nuk nis/rifillon porosi dhe nuk kërkon të dhëna. Specifikimi dhe provat më poshtë; zgjerim i Fazës 3.2 të planit burim. |
| 4 — Delivery/queue | Pjesërisht ekziston | Ka prepared/sending/sent/uncertain; mungojnë pjesë të politikës së gabimeve dhe kontrollit të dërgimit. |
| 5 — Pariteti test/production | Në pritje | Adapterët dhe previews kanë dallime të dokumentuara. |
| 6 — Aftësitë e biznesit | Në pritje | Verifiko dhe ripërdor kontrollet ekzistuese të moduleve/shërbimeve para zgjerimit. |
| 7 — Roadmap | Jashtë implementimit aktual | Kërkon kërkesë dhe miratim të veçantë. |

Ritmi: një fazë ose nënfazë e kufizuar → test që riprodhon problemin → ndryshim minimal → verifikim → përditësim i këtij statusi. Publikimi i korrigjimit të mëparshëm nuk autorizon automatikisht rollout global të coordinator-it.

## Faza 2 — Unifikimi i coordinator-it: rezultat lokal

**Baseline:** Meta tashmë normalizon Instagram dhe WhatsApp në `NormalizedIncomingMessage` dhe i fut në të njëjtën queue. Nuk u shtua një model tjetër eventi ose një motor tjetër. Dallimi ishte në `processConversationMessage`: prania e `bookingGuard` ndikonte në përzgjedhjen e routing-ut. Testi production pa guard dështonte me `workflow_queue_required` për biznesin pilot, kurse testi i laboratorit kalonte.

**Ndryshimi:** `coordinator-policy.ts` përcakton një politikë të vetme për coordinator-in dhe hydration në adapter. WhatsApp, testet, previews vizuale, bizneset në `SHARED_WORKFLOW_BUSINESS_IDS` dhe bisedat tashmë v3 përdorin coordinator-in e përbashkët. Instagram jashtë pilotit mbetet legacy. Routing-u mund të provohet në production-mode pa guard; kjo nuk autorizon efekte. Adapteri real kërkon queue për bisedat e përbashkëta, kurse rezervimi i drejtuar nga coordinator-i refuzon shkrimin pa guard. Linear preview mbetet provë e izoluar e produktit, jo simulim i gjithë bisedës.

**Ruajtja:** ripërdoren migrimi v2→v3, profili sipas biznesit/participantit/kanalit, snapshots e proceseve dhe versionet e fiksuara. Testet provojnë që një rezervim i vjetër rifillon me graph-in e vet pas ndërprerjes nga porosia, edhe kur ekziston publikim tjetër. Mesazhet e njëpasnjëshme vazhdojnë përmes grupimit dhe commit-it me lease/revision ekzistues.

**Gjurmimi:** çdo rezultat i coordinator-it, përfshirë përgjigjet e shkurtra, jep metadata të kufizuara: rruga legacy/shared/preview, kanal, revision hyrës, version workflow, process/action dhe kohë. Adapteri i lidh me correlation ID, biznesin, bisedën dhe job-in. Ky event nuk përmban tekst mesazhi, vlera profili ose lease token. Ky ndryshim nuk është pastrim i të gjithë logging-ut ekzistues.

**Verifikimi:** `vitest run` — **1,201 teste / 150 skedarë** kaluan; `tsc --noEmit` dhe ESLint i skedarëve të ndryshuar kaluan. Testet krahasuese përdorin production-mode Instagram/WhatsApp me dhe pa guard dhe laboratorin: porosi → rezervim → informacion → OK → rifillim → staf. Mbulohen drafti, profili, versioni i fiksuar, heqja e pilotit dhe bllokimi i shkrimit të rezervimit pa guard. Shërbimet/modeli/transporti simulohen në testet automatike; kjo nuk është provë end-to-end me provider real dhe nuk garanton formulim identik të përgjigjeve AI.

**Publikimi dhe kthimi pas:** nuk u bë push, migrim SQL, ndryshim environment apo rollout për këtë fazë. Nuk nevojitet skemë e re. Në publikimin e ardhshëm, bizneset që janë tashmë në pilot ruajnë politikën e tyre. Aktivizimi i bizneseve të tjera bëhet veçmas: internal → pilot → zgjerim gradual. Heqja nga allowlist ndalon migrimet e reja, por ruan coordinator-in për bisedat ekzistuese v3; nuk është downgrade i state. Në problem me bisedat v3, ndalo auto-reply për biznesin përkatës dhe rikthe një version kodi që lexon v3, pa fshirë snapshots apo rindërtuar verbërisht cursor-in legacy. Kthimi te kodi përpara mbështetjes v3 kërkon plan migrimi më vete.

**Të mbetura për pranimin real:** prova e kontrolluar në kanal real, verifikimi i deployment-it, sjellja me AI reale dhe miratimi i zgjerimit të pilotit. Unifikimi i përzgjedhjes nuk shpall të përfunduara fazat pasuese për finalizimin e historikut, handoff-in apo delivery recovery. Dokumenti i ri Agentic Orchestration Phase 2 mbetet plan pasues.

## Faza 3.2A — Përgjigje të shkurtra dhe qëllimi i klientit

**Statusi:** planifikuar më 11 tetor 2026; kontrolli i avancimit u implementua lokalisht pas miratimit të përdoruesit. Zgjeron Fazën 3.2 të dokumentit burim, që ruhet i pandryshuar. Duhet verifikuar përpara rollout-it global të coordinator-it, në bashkërendim me historikun e Fazës 3.1 dhe konfirmimin e dërgimit të Fazës 4.1.

**Rasti i raportuar:** pas informacionit për materialet PDF dhe linkut të Filiz Studio, klienti shkruan “Ok”. Agjenti përgjigjet “Na jepni telefonin, qytetin, adresën.” Përdoruesi sqaron se kishte marrë informacionin dhe nuk dëshironte të vazhdonte. Screenshot-i dëshmon sjelljen; shkaku në kod/state duhet riprodhuar përpara korrigjimit.

**Objektivi:** agjenti dallon marrjen e informacionit, mbylljen e bisedës, pranimin e një propozimi konkret dhe kërkesën për veprim. Një përgjigje e shkurtër interpretohet sipas mesazhit të fundit të dërguar realisht dhe procesit aktiv, jo vetëm sipas fjalës ose cursor-it të mbetur.

### Sjellja e kërkuar

- Pas informacionit, “ok”, “në rregull”, “faleminderit” ose një reagim i shkurtër nuk janë vetvetiu miratim porosie. Agjenti mund ta mbyllë shkurt, p.sh. “Në rregull 😊”, pa kërkuar të dhëna apo duke insistuar për blerje.
- Pas një pyetjeje të drejtpërdrejtë për një veprim të përcaktuar, p.sh. “Ta vazhdojmë porosinë për Aktivitetet Montessori?”, “po”/“ok” mund të pranohet vetëm për atë veprim. Pyetja duhet të jetë ende aktive, e dërguar me sukses dhe të mos jetë zëvendësuar nga një temë/propozim tjetër.
- “Dua ta porosis” është qëllim i qartë: vazhdo procesin ekzistues pa shtuar miratime të panevojshme, duke respektuar kontrollet dhe konfirmimin përfundimtar që ai kërkon.
- “Do ta mendoj”, “jo tani”, “vetëm po pyes” ndalin nxitjen drejt porosisë; ruaj kontekstin dhe draftin sipas politikës ekzistuese. “Anulo” trajtohet veçmas sipas rregullave të anulimit.
- Një pyetje e ndërmjetme për çmimin ose produktin nuk plotëson fushën që pritej dhe nuk miraton porosinë. Një “ok” pas këtij shpjegimi nuk ringjall automatikisht miratimin e vjetër.
- Kur është realisht e paqartë nëse klienti kërkon veprim, bëj vetëm një pyetje neutrale sqaruese. Mos shto pyetje sqaruese pas çdo falënderimi dhe mos e përsërit kërkesën nëse klienti nuk dëshiron të vazhdojë.
- Kërko vetëm të dhënat e nevojshme për mënyrën e përmbushjes së porosisë së konfiguruar. Për PDF ose blerje në website, mos kërko automatikisht adresë fizike; mos supozo se chat-i e kryen porosinë kur procesi real vazhdon në website.

### Hapat e implementimit

1. Riprodho rastin me historikun dhe state-in përkatës; identifiko degën që e trajton “ok” si vazhdim. Kontrollo legacy, coordinator-in dhe rrjedhën vizuale, si edhe dallimet laborator/production.
2. Përcakto një rregull të përbashkët për interpretimin e përgjigjes dhe për lejimin e avancimit. Ripërdor gjendjen ekzistuese për procesin, pyetjen dhe dërgimin; shto vetëm informacionin që mungon, me migrim të sigurt nëse nevojitet.
3. Zbato kontrollin përpara avancimit të workflow-t ose efekteve në server. Udhëzimet për AI ndihmojnë interpretimin; një klasifikim i pasigurt ose dështim i modelit nuk mjafton për të miratuar veprim.
4. Ruaj arsyen e vendimit në trace-in ekzistues, pa kopjuar të dhëna personale të panevojshme. Testo të njëjtët skenarë në laborator dhe rrugën reale të përpunimit.

### Pranimi dhe provat

- Informacion/link → “ok” ose “faleminderit”: asnjë kërkesë të dhënash, nisje/rifillim porosie apo efekt biznesi. Regjistrimi i mesazhit dhe historikut vazhdon normalisht.
- Propozim konkret i dërguar → “po”: avancon vetëm procesin përkatës; një përgjigje e shkurtër e vlefshme nuk humbet.
- Propozim i vjetër, ndryshim teme ose dërgim i dështuar/pasigurt → “ok”: nuk konfirmon veprimin e vjetër.
- “Dua ta porosis” vazhdon; “jo tani” pezullon; “anulo” ndjek anulimin ekzistues. Draftet dhe komponentët ekzistues ruhen.
- Pyetje për çmim gjatë mbledhjes së të dhënave: jep informacionin pa konsumuar fushën dhe pa shtyrë klientin në hapin pasues.
- PDF/website kundrejt dërgesës fizike: të dhënat kërkohen sipas procesit të konfiguruar.
- Provo edhe grupin “ok” + “jo tani” dhe webhook-un e përsëritur: vlerëso gjithë mesazhin e grupuar dhe mos dyfisho avancimin/efektet.
- Testet me AI të simuluar dhe fallback kalojnë; prova e kontrolluar në aplikacion verifikon formulimin. Raporto veçmas kodin lokal, publikimin dhe provën reale; nuk premtohet interpretim pa gabime për çdo përgjigje njerëzore.

**Kufiri:** kjo fazë përmirëson interpretimin dhe kalimet e proceseve ekzistuese. Nuk ridizenjon editorin dhe nuk shton mënyra të reja porosie, pagesash apo rezervimesh. Implementimi u publikua në Git me commit `d73053a`; deployment-i dhe sjellja live e këtij korrigjimi nuk janë verifikuar këtu.

### Rezultati lokal i Fazës 3.2A

- Rasti me produkt të zgjedhur, cursor `collect_customer`, shpjegim PDF/website dhe “Ok” u kthye në test regresioni: përpara korrigjimit mesazhi hynte përsëri në pipeline-in e produktit. Pas korrigjimit, ndalet përpara routing/extraction dhe nuk kërkon të dhëna. Ky riprodhim përdor katalog/model të simuluar; nuk është auditim i state-it të bisedës reale në screenshot.
- `conversation-control.ts` zbaton të njëjtin kontroll në hyrjen e coordinator-it dhe të `processAgentTurn`, përfshirë degën legacy të Instagram-it dhe preview-t. “OK/faleminderit” pas informacionit mbyllen shkurt; shprehjet e njohura të shtyrjes/pasigurisë ruajnë draftin. `conversationPaused` ruhet në JSON-in ekzistues dhe kërkon qëllim të qartë për rifillim; nuk është pauzim administrativ/handoff.
- Një përgjigje e shkurtër vazhdon vetëm kundrejt një propozimi/pyetjeje të njohur ende aktuale. Për production, inbound lexon përgjigjen e fundit outbound dhe tentativën e fundit të queue në të njëjtën bisedë/biznes/lidhje. Ato duhet të jenë `sent` dhe të përputhen me historikun. Gabimi i leximit ndalon përpunimin; një tentativë `prepared/uncertain` nuk justifikohet nga një përgjigje identike e dërguar më herët. Laboratori përdor historikun e vet të shfaqur. Dega legacy e rezervimeve tani regjistron edhe historikun e përgjigjes që prodhon.
- Nuk shtohet thirrje AI për këtë kontroll. Rregullat janë konservative për format e mbuluara shqip/anglisht; nuk garantojnë interpretimin e çdo formulimi ose gjuhe. Një propozim i panjohur mund të kërkojë riformulim të qartë. Njoftimi/trace shënon arsyen pa shtuar të dhëna klientësh.
- Verifikim: **1,182 teste / 150 skedarë** kaluan, si edhe typecheck dhe ESLint i skedarëve të ndryshuar. Më pas u shtuan tre raste pasigurie dhe kaluan të **27 testet** e kontrollit, typecheck dhe lint i modulit të ri. Mbulohen të dyja hyrjet, ruajtja/rifillimi i draftit, konfirmimi i vlefshëm, ndërprerjet informative, emoji, grupi “ok + jo tani”, dërgimi i pasigurt, mesazhi i stafit dhe dështimi i leximit të dëshmisë. Deduplikimi mbetet në queue-n e testuar ekzistuese.
- **Të mbetura:** prova në aplikacion/Instagram dhe verifikimi i deployment-it të `d73053a`. Nuk u ndryshuan rregullat ekzistuese të fushave `customer` ose konfigurimi i biznesit: pas një kërkese eksplicite për porosi, workflow-t që kërkojnë adresë fizike ende e kërkojnë. Dallimi sistematik PDF/website/dërgesë fizike kërkon kontratë të qartë të përmbushjes; nuk u hamendësua nga emri ose përshkrimi i produktit. Prandaj kjo pjesë e pranimit mbetet e hapur dhe faza e plotë nuk shënohet e përfunduar.
- Nuk nevojitet migrim SQL për kontrollin e ri. Ndryshimet e landing-ut mbeten jashtë kësaj pune. Nuk u dërguan mesazhe klientëve dhe nuk u ndryshuan të dhëna production.

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

Pas përfundimit të Fazës 1.1, kodi dhe dokumentacioni u bënë push në `main`, commit `a8dda95`. Shënimet për gjendjen lokale më sipër përshkruajnë momentin e implementimit. Deployment-i nuk është verifikuar.

## Faza 1.2 — Verifikimi i konkurrencës (11 tetor 2026)

- **Statusi:** përfunduar në databazë lokale të izoluar, mbi migrimet aktuale. Nuk u zbulua problem që kërkon ndryshim të kodit të aplikacionit apo migrim të ri SQL. Zgjerimi i testeve dhe ky raport ende nuk janë bërë push.
- **Ndryshimi:** u zgjerua `supabase/tests/instagram_queue_concurrency.py`, duke përdorur sesione të pavarura PostgreSQL dhe funksionet reale të queue. Testi ka afate pritjeje dhe mbyll proceset e provës edhe në dështim.
- **I njëjti participant:** ndërkohë që worker-i i parë mban claim-in hapur, worker-i tjetër nuk merr mesazhin e dytë. Lease-i e ruan këtë kufizim pas commit-it. Mesazhi i dytë lexon fushat dhe cursor-in e ruajtur nga i pari; shkrimi me revision të vjetër refuzohet. Pas përpunimit ruhen të dyja fushat dhe cursor-i i përditësuar me të njëjtin version.
- **Participantë të ndryshëm:** klienti i dytë përfundon prepare/send/finish ndërkohë që claim-i i klientit të parë mbetet i hapur. Tentativa për të shkruar në bisedën e klientit tjetër refuzohet me `invalid_conversation`. Fushat, profili dhe përgjigjet kontrollohen veçmas pas përfundimit të të dy klientëve.
- **Duplicate webhook:** dy sesione tentojnë të njëjtin `connection_id/external_id` me `ON CONFLICT DO NOTHING`, si enqueue në aplikacion. Testi pret konfliktin real të lock-ut para se të lirojë transaksionin e parë. Mbetet një job dhe payload-i origjinal. Ripërsëritja gjatë lease-it dhe pas dërgimit nuk krijon claim të ri: një tentativë përpunimi, një rritje revision, një përgjigje dhe një agent turn.
- **Kontrollet:** `python3 supabase/tests/instagram_queue_concurrency.py --pg-bin /opt/homebrew/opt/postgresql@17/bin` kaloi: të gjitha migrimet nga zero, `shared_workflow_context.sql`, `workflow_message_runtime.sql` dhe provat e zgjeruara. Suite ekzistuese e runtime verifikon edhe që riprovimi pas ruajtjes së booking nuk krijon rezervim të dytë. `npx vitest run src/app/api/webhooks/meta/route.test.ts src/lib/conversations/workflow-queue.test.ts` — **17 teste në 2 skedarë kaluan**. `git diff --check` kaloi.
- **Kufijtë:** rendi është sipas futjes në queue, jo sipas timestamp-it nëse Meta dërgon evente jashtë rendit. Send/finish provohet në DB me ID sintetike; nuk thirret Meta/OpenAI dhe nuk dërgohen mesazhe apo krijohen porosi/rezervime në production. Këto prova nuk përbëjnë garanci të përgjithshme exactly-once për dështime të provider-it ose çdo efekt biznesi; rikuperimi i delivery mbetet te Faza 4. Nuk u përsërit suite e plotë TypeScript/build, sepse ndryshimi është vetëm te testi Python dhe dokumentimi.
- **Hapi pasues:** Faza 1.3 — trajtimi i dështimit të ruajtjes së mesazhit hyrës: duplicate i sigurt, ndalim/riprovim për gabime të tjera DB dhe raportim me identifikues gjurmimi.

## Faza 1.3 — Ruajtja e mesazhit hyrës (11 tetor 2026)

- **Statusi:** implementuar dhe verifikuar lokalisht; pa push/deploy dhe pa migrim SQL.
- **Problemi i riprodhuar:** rruga direkte vazhdonte te processor-i pas gabimit të insert-it. Për më tepër, receipt-i në `webhook_events` krijohej përpara mesazhit; në dështim, redelivery mund të anashkalohej si e trajtuar. Rruga me job ndalonte për shumicën e gabimeve, por pranonte çdo `23505` pa verifikuar mesazhin ekzistues dhe nuk kërkonte ID për konfirmimin e insert-it.
- **Korrigjimi:** `handle-inbound.ts` kërkon një ID të ruajtur përpara leximit/përpunimit të workflow-t. DB errors, timeouts dhe rezultate pa ID hedhin exception; processor-i, përgatitja e përgjigjes dhe dërgimi nuk kryhen. Në `23505`, mesazhi ekzistues duhet të përputhet me biznesin, bisedën, lidhjen e kanalit, external ID, drejtimin inbound dhe burimin customer. Gabimi ose mungesa gjatë verifikimit e ndal përpunimin.
- **Rruga direkte:** receipt-i legacy krijohet vetëm pas ruajtjes/verifikimit të inbound. Një insert i dështuar nuk bllokon riprovimin. Kur inbound ekziston por receipt-i nuk u ruajt, riprovimi mund ta marrë receipt-in dhe të vazhdojë; constraint-i unik lejon vetëm një fitues. Receipt-i ekzistues e ndalon ekzekutimin e dytë. Eventet sintetike të Meta-s ruajnë trajtimin ekzistues.
- **Radha reale:** failure ruan job-in në processing për riprovim me mekanizmin ekzistues (backoff 30 sekonda; kufiri prej 3 tentativash dhe kalimi te stafi mbeten të pandryshuara). Pasi ruajtja konfirmohet në riprovim, përgjigjja përgatitet dhe dërgohet përmes lease-it të ri. Nuk u shtua mekanizëm tjetër radhe apo retry.
- **Diagnostikimi:** `InboundPersistenceError` ruan identifikuesin `workflow-job:<id>` për queue ose UUID për tentativën direkte, fazën (`message_insert`, `duplicate_lookup`, `event_receipt`) dhe kodin DB të filtruar. Log-u i strukturuar lidh gabimin me biznesin/bisedën; queue ruan të njëjtin identifikues. Mesazhi i papërpunuar i gabimit DB nuk kopjohet në këto diagnostikime. Gabimet e tjera të queue ruajnë sjelljen e mëparshme; klasifikimi i plotë mbetet te Faza 4.
- **Testet:** 13 raste të reja në `handle-inbound.test.ts` mbulojnë gabim DB, timeout, insert pa konfirmim, retry direkt/me job, timeout pas ruajtjes, unique violation të paverifikuar, dështim lookup, receipt të dështuar, korrelacion të sigurt dhe lidhjen WhatsApp. Dy raste të reja në `workflow-queue.test.ts` provojnë reschedule pa send/ignore dhe rikuperimin me lease të ri, si edhe mosruajtjen e detajeve arbitrare të exception-it.
- **Kontrollet:** 45 teste të fokusuara në handler/queue/webhook kaluan; suite e plotë **1,117 teste në 146 skedarë** kaloi; `npx tsc --noEmit`, ESLint për pesë skedarët TS të prekur dhe `git diff --check` kaluan. Paralajmërimi ekzistues i konfigurimit Vite mbetet. Provat përdorin adapterë të simuluar; nuk u dërguan mesazhe klientësh dhe nuk u prek production. Nuk u përsëritën migrimet SQL, sepse nuk ndryshuan.
- **Kufijtë/kthimi:** nuk riparon receipt-e historike të pasakta ose mesazhe të humbura më parë. Rruga direkte nuk zëvendëson garancitë e queue pas një crash-i gjatë ekzekutimit; webhook-et reale Instagram/WhatsApp vazhdojnë në queue. Ky ndryshim mbulon kufirin e ruajtjes inbound; dështimet gjatë krijimit të bisedës, gjendjes ose dërgimit mbeten çështje të veçanta. Rollback-u është në kod, pa ndryshim skeme.
- **Hapi pasues:** Faza 2 — unifikimi gradual i coordinator-it sipas planit, duke ruajtur kushtet aktuale të aktivizimit dhe duke provuar paritetin përpara rollout-it.

Faza 1.3, testet e zgjeruara të 1.2 dhe dokumentimi u bënë push me `5c7f0ff`. Nuk është konfirmim deployment-i.

## Shtesë e miratuar — Mesazhet e njëpasnjëshme në Instagram

Rasti i përdoruesit: `Ckemi` → `Si jeni` → `Dua te porosis montesori` → `E keni ne gjendje?`. Serializimi i Fazës 1.2 nuk bashkonte mesazhet: secili job gjeneronte përgjigjen e vet. Ruajtja e state nuk provonte cilësinë e kontekstit bisedor; përgjigjja “Cilin produkt?” kërkonte edhe kontrollin e identifikimit të emrit.

- **Sjellja:** vetëm Instagram-i grupon mesazhet pas 3 sekondash qetësi, me kufi 10 sekonda nga mesazhi i parë dhe maksimum 20 mesazhe. Rendi është sipas futjes në queue. Pas claim-it, grupi është i pandryshueshëm; mesazhet e reja trajtohen në grupin pasues. Nuk anulohen veprime që kanë nisur për të bashkuar mesazhe të ardhura më vonë.
- **Ruajtja:** migrimi `20261011233000_instagram_message_batches.sql` shton një snapshot të mesazheve te job-i kryesor dhe lidh anëtarët me `batch_parent_id`, status `batched`. Rezultati terminal i grupit ndiqet te prindi. Çdo mesazh ruhet individualisht te `messages`, me ID/body/media origjinale, përpara se processor-i të marrë tekstin e bashkuar. Dështimi në mes të ruajtjes ndalon të gjithë turnin; riprovimi verifikon duplicate-t e ruajtura. Lease/revision/effect guards vazhdojnë te job-i kryesor.
- **Zgjimi:** worker-i përdor `claim_workflow_inbound_batch` dhe pret sipas `workflow_inbound_batch_wait_ms` kur dritarja është ende e hapur. Pritja nuk konsumon buxhetin e job-eve dhe respekton kufirin ekzistues 45s. Radha bosh ose një stream që zotërohet nga një worker tjetër nuk shkakton pritje të kotë. WhatsApp ruan përpunimin për mesazh.
- **Korrigjim i zbuluar nga prova e re:** kur dy participantët ishin të dy në radhë përpara claim-it, cursor-i i ciklit SQL me `FOR UPDATE` mund të merrte paraprakisht lock-e për më shumë se një participant. Testi i mëparshëm shtonte participantin e dytë pasi lock-u i parë ishte marrë dhe nuk e mbulonte këtë rast. Migrimi i ri bllokon vetëm kandidatin e zgjedhur, pas advisory lock-ut, dhe rishikon kushtet. Prova me dy sesione reale dështoi përpara korrigjimit dhe kaloi pas tij. Nuk u gjet humbje e të dhënave nga kjo çështje; ndikimi ishte bllokimi i panevojshëm i klientit tjetër.
- **Produkti:** helper-i i përbashkët `matchingCatalogNames` përdoret nga përzgjedhja legacy dhe entity routing vizual. Pranon emër të pjesshëm ose një gabim shkronje në fjalë me të paktën 6 karaktere; SKU/numrat nuk përafrohen. Emrat e plotë kanë përparësi; kandidatët me rezultat të barabartë mbeten të paqartë. Katalogu vazhdon të filtrohet sipas biznesit/aktivizimit dhe rregullave ekzistuese të preview. Një kërkesë e qartë për porosi nuk e humb identifikimin e produktit vetëm sepse mesazhi përfundon me pyetje.
- **Kontrollet:** **1,139 teste / 148 skedarë** kaluan; typecheck dhe ESLint në skedarët e ndryshuar kaluan. Pas një përmirësimi të vogël të llogaritjes së pikëve, kaluan përsëri 9 testet për emrat. PostgreSQL i izoluar kaloi të gjitha migrimet nga zero, testet ekzistuese të shared context/runtime, `instagram_message_batches.sql` dhe provën e dy worker-ave. Mbulohen qetësia, kufiri kohor/madhësia, membership i pandryshueshëm, duplicate/redelivery, recovery prepared, ndarja e participantëve, mbrojtja nga worker-i i vjetër dhe radha bosh. `git diff --check` kaloi.
- **Kufijtë e verifikimit:** testi i handler-it ruan katër origjinalet dhe thërret processor-in një herë; testet e produktit/rrjedhës provojnë shembullin me katalog sintetik dhe AI të simuluar. Nuk është provë live Instagram/OpenAI dhe nuk garanton formulimin e përgjigjes së modelit. Prania në katalog nuk konsiderohet provë stoku; nuk u shtua burim i ri për stokun/disponueshmërinë. Testet SQL simulojnë konfirmimin e provider-it, pa dërguar mesazhe reale.
- **Publikimi:** apliko migrimin përpara kodit që thërret RPC-në e re. Worker-at e vjetër përjashtohen nga batch-et e ngrira; job-et pa batch mbeten të përputhshme. Gjatë kalimit, worker-at e vjetër mund të marrin ende job-e të reja individualisht; sjellja e grupimit kërkon përfundimin e instancave të vjetra. Për rollback, përfundo batch-et me worker të aftë për batch përpara kthimit të kodit; mos e fshi snapshot-in ose rikthe anëtarët në queued, sepse mund të përsëriten veprime. Migrimi u aplikua më 2026-10-11 në projektin production `cvdsapjmibezkzeregrd` përmes SQL Editor (projekti nuk ka tabelë `supabase_migrations.schema_migrations`). Të katër trupat e funksioneve u krahasuan me migrimin përmes MD5; lejet service_role dhe bllokimi anon/authenticated u verifikuan. Kodi është gati për push; deployment-i dhe prova reale mbeten për t’u konfirmuar. Para commit-it u përfshinë pa konflikt ndryshimet remote deri te `d09a269`; typecheck dhe 46 teste për handler/queue/disconnect kaluan sërish.
- **Pas publikimit:** provo rastin e mësipërm në një bisedë reale testimi dhe verifiko një grup/një përgjigje, produktin e identifikuar dhe vazhdimin e bisedës. Pastaj rikthehu te Faza 2; mos e shëno si të realizuar nga ky korrigjim.
