# Plani i zëvendësimit të bërthamës së Agjenti.app

Data: 5 nëntor 2026. Status: drejtim i miratuar, implementimi ka nisur. Përparimi konkret dhe kufijtë e verifikimit janë në seksionin 9; zëvendësimi i platformës nuk ka përfunduar.

## 1. Drejtimi dhe kufiri i punës

1. Zëvendësojmë orkestrimin e bisedave me një bërthamë agentike: AI interpreton dhe propozon hapa/mjete; serveri zotëron gjendjen, validimin, autorizimin dhe ekzekutimin.
2. Proceset, fushat dhe pyetjet në pritje bëhen të përgjithshme dhe të identifikueshme. Nuk përdorim kategorinë `order` si mbajtëse për regjistrime ose procese të tjera.
3. Ruajmë aftësitë ekzistuese të editorit, versionimit, publikimit, aksesit manual, katalogut, integrimeve dhe transportit, duke përshtatur kontratat e tyre. Ripërdorimi kushtëzohet nga testet, jo nga ekzistenca e kodit.
4. Platforma nuk ka përdorim real. Nuk kërkohet migrim i bisedave historike ose rollout me dy motorë. Lejohet projektim i freskët i skemës dhe reset i të dhënave të vjetra kur nevojitet. Nuk shtojmë pagesa, dërgesa ose integrime të pambështetura vetëm për të demonstruar përgjithësinë.
5. Pranimi kërkon rrjedha të plota për disa lloje biznesesh, paritet ndërmjet kanaleve, ekzekutim të kontrolluar dhe rikuperim pas dështimeve. Suksesi i një shembulli ose i testeve me model të simuluar nuk mjafton.

Ky dokument është plani aktual për këtë zëvendësim. Dokumentet e tetorit, përfshirë `AGJENTI_ASTRA_PLAN.md`, `AGJENTI_AGENTIC_ORCHESTRATION_PHASE2.md` dhe `orchestration-baseline.md`, mbeten referenca historike; statuset e tyre nuk provojnë gjendjen aktuale dhe nuk përcaktojnë detyrim për të ruajtur rrugët legacy.

## 2. Evidenca dhe vendimi arkitekturor

Biseda e provës në browser: `3c7071fe-821f-4f6a-a641-4337a8c9cc2b`, konfigurim i publikuar, mënyra PROVË, 10 mesazhe. Regjistrimi nuk u propozua pas kuptimit të nevojave; kërkesa eksplicite e nisi si `order`; emaili u kërkua dy herë; dy pranime nuk kaluan nyjën e konfirmimit.

Fakte të verifikuara:

- Modeli mori nevojat e deklaruara dhe `flow_registration`, por ktheu `processOffer: null`. Në hapin e tretë propozoi sërish një pyetje për një fushë tashmë të njohur. Zgjedhja e hapit tjetër është pjesë e gjenerimit të tekstit dhe mund të mbetet pa rezultat pas filtrimit.
- `orderRequest` dhe rezultati numerik i nxjerrjes së fakteve mund të vendosin `inputAvailable: false` për gjithë mesazhin. Prova me të njëjtën gjendje dhe pranim semantik tregoi konfirmim të bllokuar me flamurin dhe avancim pa të.
- Fusha e paplotësuar `email_registration` mungon nga kontrata e interpretimit kryesor, ndërsa `email` i profilit lejohet. Skema e hapit aktiv nuk furnizohet në mënyrë autoritative përpara interpretimit.
- Një graf `custom` i vlefshëm që vetëm mbledh të dhëna nuk hyn te `availableProcessOffers`, sepse filtri kërkon nyjë `action`.
- `ConversationProcesses` ka pronësi dhe snapshots të ndryshme për order, booking, service dhe actionFlow. `ActionBinding` pranon vetëm `business.provision`; ekzekutimet e porosisë dhe rezervimit janë rrugë të tjera.
- Transporti ka lease, revision, ruajtje të përgjigjes përpara dërgimit dhe trajtim të dërgimit të pasigurt. Veprimet dhe operacionet e pronarit kanë mekanizma të vlefshëm autorizimi dhe dëftesash, por jo një kontratë universale ekzekutimi për klientët.

Verifikimet e hetimit: 5 prova diagnostikuese riprodhuan kufizimet; 133 teste ekzistuese për runtime/propozime/politikën semantike dhe 36 për transport/veprime/izolim kaluan. Provat diagnostikuese konfirmojnë mekanizmin e gabimit, jo korrigjimin. Testet me shërbime të simuluara nuk provojnë sjelljen e production. Nuk është kryer audit i plotë sigurie apo matje krahasuese e një bërthame të re.

Vendim: rindërtojmë bërthamën dhe kontratat e saj. Korrigjimet lokale lënë të paprekura kufizimet; rishkrimi i gjithë aplikacionit nuk justifikohet nga evidenca. Nuk shtojmë menjëherë një platformë të jashtme workflow ose framework agentik: fillojmë me TypeScript, Postgres/Supabase dhe transportin ekzistues, dhe kërkojmë provë konkrete për çdo varësi të re.

## 3. Arkitektura e synuar

Rrjedha e një eventi:

`Kanal → event i qëndrueshëm → kontekst i autorizuar → interpretim/plan agentik → validim serveri → kalim gjendjeje ose mjet → rezultat i ruajtur → përgjigje dhe dëftesë dërgimi`

### 3.1 Kufiri i eventit dhe kontekstit

- Instagram, WhatsApp, paneli dhe ChatLab përdorin të njëjtën hyrje të orkestrimit. Adapteri i kanalit normalizon eventin dhe ndërton identitetin e besuar; modeli nuk cakton tenant, actor ose execution mode.
- Eventi ka ID të qëndrueshme, biznes, bisedë, burim, aktor dhe rend. Eventet e jashtme korrelohen me execution/wait përkatës, jo me tekstin e përgjigjes.
- Konteksti ngarkohet përpara interpretimit: proceset e lejuara, versionet e fiksuara, prompt-et e dorëzuara, skema e plotë e fushës së pritshme, faktet e nevojshme dhe rezultatet e verifikuara të mjeteve.
- Informacioni i biznesit, historia dhe rezultatet e mjeteve janë të dhëna të pabesueshme si udhëzime. Konteksti kufizohet sipas nevojës dhe lejeve; nuk eksportohen pa nevojë kontaktet, sekretet ose konfigurimet e aktorëve të tjerë.

### 3.2 Planifikuesi agentik

- Merr aftësitë aktualisht të lejuara dhe gjendjen; propozon lexim, sqarim, propozim procesi, nisje, vazhdim, korrigjim, pezullim, rifillim, anulim ose përgatitje veprimi.
- Referon ID reale të proceseve, instancave, fushave, propozimeve dhe prompt-eve. Çdo interpretim që ndryshon progresin përmban evidencë nga mesazhi dhe versionin e gjendjes ku u mbështet.
- Një mesazh mund të përmbajë disa pjesë: përgjigje fushe, pyetje dhe korrigjim. Nuk kërkojmë një etiketë të vetme që humbet pjesën tjetër të mesazhit.
- Një cikël mund të përdorë disa lexime për të gjetur përgjigjen. Leximet e pavarura mund të bashkohen; shkrimet dhe varësitë ekzekutohen në rend. Çdo hap rivlerësohet kundrejt rezultateve dhe gjendjes së re.
- Ka buxhet eksplicit thirrjesh, kohe dhe token-ash. Konfigurimi fillestar duhet të përfundojë ose të ruajë një checkpoint përpara afatit të worker-it ekzistues; nuk mbajmë procese të gjata në kujtesën e një request-i. Shterimi i buxhetit është rezultat i kontrolluar, jo sukses.
- Nuk ka regex/lista frazash, degë sipas gjuhës ose emrit të biznesit për të kuptuar klientin. Në dështim të modelit ruhet progresi dhe raportohet dështimi; nuk shpiket miratim.
- Gjenerimi i përgjigjes përdor vendimin e validuar dhe rezultatet e ekzekutimit. Nuk shton propozime veprimesh pa identitet ose premtime jashtë planit.

### 3.3 Proceset dhe workflow editor-i

- `ProcessDefinition` përshkruan qëllimin, hyrjet, rezultatin, fushat, kushtet, veprimet dhe politikën e propozimit. Identiteti i procesit nuk barazohet me një kategori të mbyllur intent-esh.
- Grafi i versionuar është përfaqësimi i ekzekutueshëm i të njëjtit përkufizim që redakton pronari; nuk krijojmë një graph për UI dhe një plan paralel të fshehur për runtime.
- Grafi shpreh kufizimet, varësitë dhe miratimet. Nuk imponon që çdo fushë të pyetet në rend kur klienti e ka dhënë tashmë. Navigimi nuk lejohet të anashkalojë kushtet e biznesit ose konfirmimet.
- Fushat deklarojnë tipin, subjektin, detyrueshmërinë, validimin dhe lejimin e ripërdorimit. Përfshihen tekst, email, telefon, numër, boolean, datë/orë, zgjedhje dhe referenca/struktura të kufizuara sipas aftësive konkrete; jo shprehje arbitrare të ekzekutueshme.
- Mbështeten disa instanca, përfshirë dy kërkesa të të njëjtit proces. Vetëm prompt-i/propozimi i identifikuar mund të konsumojë një përgjigje. Paqartësia sqarohet.
- Për çdo biznes mund të konfigurohet kur propozohet një hap i përshtatshëm dhe kur ndalohet propozimi. Nuk detyrojmë regjistrim pas çdo interesimi ose pyetësor pas çdo përshëndetjeje.
- Procesi vetëm për mbledhje të dhënash është i vlefshëm pa veprim të jashtëm. Regjistrimi i rezultatit, krijimi i një lead-i dhe dërgimi te stafi janë aftësi të dallueshme; nuk shpallen të implementuara nga prania e grafit.

### 3.4 Gjendja, faktet dhe pritjet

- `ProcessInstance`: ID, tenant, conversation, definition/version, revision, progres dhe status. Statuset dallojnë ekzekutim, pritje inputi, pritje miratimi, pritje eventi, pezullim, staf, përfundim, anulim dhe dështim.
- `Fact`: subject + instance/scope + field ID + vlerë e tipizuar + provenance/evidence reference + revision + status validimi. Nuk kopjojmë emrin e organizatës në emrin e personit.
- Ripërdorimi mes fushave ose proceseve deklarohet me lidhje dhe qëllim; modeli mund ta propozojë, por nuk mund të ndryshojë pronësinë e faktit.
- `Wait/Prompt`: ID, instance, lloj, schema/target, afat, aktorë të lejuar dhe dëftesë paraqitjeje. Sqarimi nuk e shuan automatikisht pritjen. Prompt-et nuk identifikohen vetëm nga teksti i fundit.
- `Proposal/Approval`: target i saktë, revision/hash i të dhënave të paraqitura, afat dhe evidencë pranimi. Propozimi për të nisur procesin nuk është konfirmim i shkrimit përfundimtar.
- Konsumimi lidhet me event + target + rol të përgjigjes. Heqim flamurin global `inputConsumed` si autoritet mes shtresave.
- Tranzicionet validon serveri me revision/lock. Një plan i bazuar në gjendje të vjetër rivlerësohet; nuk riluhet verbërisht.

### 3.5 Mjetet dhe ekzekutimi

- Zgjerojmë regjistrin ekzistues të aftësive në kontratë të versionuar: input/output schema, aktorë të lejuar, scope, leje, readiness, effect class, approval policy, timeout, retry/reconciliation dhe executor.
- Mjetet ekspozojnë operacione biznesi, jo SQL, HTTP arbitrar ose shkrim të lirë në state. Një mjet read-only kontrollon gjithashtu të drejtën e leximit dhe pronësinë e të dhënave.
- Readiness e llogarit serveri. Mjet i njohur nuk do të thotë mjet i lejuar ose integrim i disponueshëm.
- Operacionet manuale, asistenti i pronarit dhe asistenti i klientit ripërdorin shërbimet ku është e mundur. Identitetet dhe lejet e tyre mbeten të ndara; klienti nuk merr automatikisht katalogun e mjeteve të pronarit.
- Çdo veprim përgatitet me `actionInstanceId`, input të pandryshueshëm dhe kontekst autorizimi. Çelësi i riprovimit lidhet me instancën e veprimit; dy procese të reja me të njëjtat vlera nuk ngatërrohen me një retry.
- Shkrimet lokale përdorin transaksion/dëftesë. Për shërbime të jashtme ruhet kërkesa përpara dispatch-it, provider reference dhe statusi `unknown` kur mungon konfirmimi. Nuk premtojmë exactly-once kur provider-i nuk e mbështet; bëjmë reconciliation ose kërkojmë ndërhyrje.
- Crash pas efektit dhe përpara ruajtjes së progresit rikuperohet nga dëftesa, pa përsëritur efektin. Kompensimi është aftësi eksplicite e adapterit, jo rollback imagjinar midis sistemeve.
- Test mode përdor të njëjtën kontratë dhe adapterë shkrimi të izoluar. Rezultatet shënohen si simulim, dhe mungesa e adapterit nuk lejon kalimin në live.

## 4. Ruajtja e të dhënave dhe reset-i

Projektimi logjik përfshin: conversation events, process definitions/immutable versions, process instances, typed facts, waits/prompts, proposals/approvals, action executions, reply outbox dhe trace events. Emrat fizikë përfundohen në fazën e skemës. Nuk krijojmë tabela të dyta për të njëjtin rol kur tabela ekzistuese mund të bëhet burimi autoritativ.

- Snapshots me revision janë gjendja autoritative; eventet/dëftesat mbështesin deduplikimin, auditimin dhe recovery. Nuk kërkohet event-sourcing i plotë për gjithë platformën.
- Proceset dhe faktet nuk duplikohen si gjendje të shkrueshme te `fields`, `visual.values`, `context.order` dhe snapshots të kategorive. UI merr projections të lexueshme nga burimi autoritativ.
- Specifikojmë tenant foreign keys, unique keys, RLS, indekset e lookup/claim dhe transaksionet e commit-it. Kontrollet zbatohen edhe kur përdoret service role.
- Versionet e publikuara janë të pandryshueshme. Ndryshimi i draftit nuk ndryshon një proces aktiv.

Procedura e reset-it, përpara çdo ekzekutimi destruktiv:

1. Identifikojmë environment/projektin konkret, varësitë SQL/storage/auth dhe listën e saktë të objekteve që fshihen. Ndalojmë worker-at dhe hyrjet gjatë zëvendësimit.
2. Ndajmë çfarë hidhet poshtë: biseda, queues, sesione prove, instanca dhe rezultate sintetike. Vendosim shprehimisht fatin e bizneseve, përdoruesve, katalogut, njohurive, faturimit dhe lidhjeve të integrimeve; nuk përfshihen automatikisht te fshirja e historikut.
3. Ruajmë eksport të rikthyeshëm të konfigurimit/të dhënave që duhen ruajtur dhe një snapshot të mjedisit për rikthim. Sekretet nuk kopjohen në Git ose fixtures.
4. Ndërtojmë dhe provojmë skemën nga zero në DB të izoluar. Migrimet përfundimtare mbulojnë edhe tabelat, funksionet dhe politikat e moduleve që ruhen, jo vetëm runtime-in e ri.
5. Nëse ripërdorim DB ekzistuese, përdorim migrim reset të qartë. Nëse zgjedhim projekt/DB të freskët, përdorim baseline të ri; historia e migrimeve të aplikuara nuk rishkruhet duke pretenduar se skema u ndryshua vetë.
6. Ekzekutojmë reset-in e përcaktuar në fazën e kalimit, ngarkojmë fixtures/config të kontrolluar, verifikojmë lejet dhe vetëm pastaj nisim worker-at. Ky plan nuk ekzekuton fshirje ose publikim.

## 5. Pjesët ekzistuese dhe destinacioni i tyre

- `src/lib/conversations/process-conversation-message.ts`, `turn-decision.ts`, `conversation-control.ts`: zëvendësohen nga hyrja e vetme, vendimet e tipizuara dhe transition service. Nuk mbeten klasifikues konkurrues në zinxhirin e ri.
- `src/lib/conversations/understanding/*`, `src/lib/workflows/extract-facts.ts`, `customer-question.ts`, `process-offer.ts`: kontratat unifikohen rreth kontekstit dhe target-eve; hiqen nxjerrjet që shkruajnë në state nga disa shtresa.
- `src/lib/workflows/visual/{types,model,runtime,execute}.ts`: përkufizim/runtime i ri i versionuar; ruhen aftësitë reale të authoring-ut. Motori determinist merr komanda të validuara, jo flamuj të përgjithshëm të qëllimit.
- `src/lib/workflows/conversation-processes.ts` dhe snapshots legacy: zëvendësohen nga instancat e përgjithshme dhe projections. Nuk ndërtojmë migrues të bisedave të vjetra kur bëhet reset.
- `src/lib/capabilities/*`, `src/lib/actions/*`, `src/lib/orders/*`, `src/lib/calendar/*`: bashkojmë metadata/kontratat e ekzekutimit, ripërdorim validuesit dhe shërbimet që kalojnë testet. Vlerësimet statike të aftësive dhe lejet e pronarit nuk bëhen autorizim klienti.
- `src/lib/conversations/{handle-inbound,workflow-queue}.ts`, adapterët e kanaleve dhe RPC-të: ruajmë garancitë e verifikuara të transportit; përshtatim lidhjen me proceset, action receipts dhe outbox. Verifikohen crash boundaries, jo vetëm forma e API-së.
- `src/lib/agents/test-chat/*`, real panel chat dhe ChatLab: i njëjti runtime, mënyrë server-owned, gjurmë të strukturuara dhe rezultat i saktë. Ndryshimet lokale ekzistuese të UI-së ruhen dhe integrohen pa mbishkrim.
- Asistenti i pronarit dhe editori manual: përdorin të njëjtin përkufizim/validim/publikim të proceseve. Nuk bëhet ridizenjim i përgjithshëm i panelit ose i aplikacionit mobile; konsumatorët e kontratave të ndryshuara verifikohen.

## 6. Rendi i implementimit dhe daljet e kërkuara

Fazat janë hapa ndërtimi dhe verifikimi, jo rollout me dy motorë në përdorim. Asnjë fazë nuk shënohet e përfunduar vetëm sepse kalon typecheck.

### Faza 0 — Kontratat dhe prova e ruajtur e regresioneve

- Kthejmë evidencën e browser-it në fixtures të sanitizuara dhe teste të sjelljes së dëshiruar. Testet duhet të dështojnë ndaj kontratave të gabuara, jo t'i certifikojnë ato si pritshmëri të re.
- Inventarizojmë hyrjet, konsumatorët, shkrimet dhe kontrollet ekzistuese; përcaktojmë tipat e procesit/faktit/wait/action/result dhe transaksionet.
- Përcaktojmë politikat e propozimit dhe përfundimit me konfigurime biznesesh të ndryshme. Paqartësia dhe mbyllja normale e bisedës janë rezultate të vlefshme.
- Dalje: kontrata të rishikueshme, raste pranimi dhe inventari konkret i reset-it. Nuk fshihen të dhëna.

### Faza 1 — Skema dhe shërbimi determinist i gjendjes

- Implementojmë skemën në DB të izoluar, identitetet, revision/CAS, waits, approvals, action receipts dhe lidhjen me outbox.
- Implementojmë tranzicionet pa model: input i strukturuar → validim → commit; statuset dhe failure reasons janë të tipizuara.
- Dalje: instalim nga zero dhe prova SQL/integrimi për tenant isolation, konkurrencë, deduplikim, skadim dhe rollback të transaksionit. Një instance ka vetëm një ekzekutues.

### Faza 2 — Një rrjedhë e plotë me AI, herët

- Ndërtojmë context builder, interpretim/planifikim, validim komande, tool executor dhe gjenerim përgjigjeje.
- Lidhim ChatLab me rrjedhën e plotë të regjistrimit: informacion → propozim sipas politikës → të dhëna → sqarim/korrigjim → konfirmim → rezultat i simuluar.
- Në të njëjtën fazë provojmë një proces tjetër vetëm për mbledhje të dhënash përmes konfigurimit, që API-të të mos projektohen rreth regjistrimit.
- Dalje: provë e dukshme në browser me model real dhe trace për çdo vendim. Nuk investohet në zbukurim UI përpara këtij kontrolli.

### Faza 3 — Përgjithësimi dhe integrimi me editorin

- Shtojmë porosi, rezervim, informacion dhe staf në të njëjtat kontrata; përshtatim adapterët ekzistues.
- Editor/pronar krijojnë, validojnë, testojnë dhe publikojnë të njëjtin process definition. Ruajmë nyjet, kushtet, lidhjet, korrigjimet dhe aksesin manual.
- Testojmë dy instanca të të njëjtit proces, ndryshim teme, ndryshim procesi, fakte për persona/organizata të ndryshme dhe përgjigje me disa fusha.
- Dalje: shtimi i një procesi të ri me aftësi ekzistuese bëhet me konfigurim, pa degë të reja sipas biznesit në engine. Aftësitë e pambështetura raportohen qartë.

### Faza 4 — Kanalet, durabiliteti dhe dështimet

- Lidhim Instagram, WhatsApp dhe panelin me hyrjen e re; përshtatim queue/commit/delivery dhe ekspozimin e prompt receipts.
- Implementojmë pritje eventi/timer/miratimi me korrelacion dhe afate. Një timer minimal provohet pa shtuar integrime biznesi të panevojshme.
- Provojmë crash para/pas efektit, përgjigje provider-i të humbur, retry, revokim lejesh, staf që merr bisedën dhe ndryshim versioni workflow.
- Dalje: teste me DB reale të izoluar dhe adapterë që simulojnë dështimin në kufijtë përkatës; nuk dyfishohen efektet logjike dhe pasiguria nuk shpallet sukses.

### Faza 5 — Observueshmëria dhe vlerësimi me model real

- ChatLab paraqet event ID, vendimin semantik, proceset kandidate, arsyen e zgjedhjes/mospropozimit, fushat e pranuara/refuzuara, wait/approval target, mjetin, rezultatin dhe afatet.
- Gjurmët kanë lidhje mes fazave dhe redaktim të të dhënave sensitive. Mungesa e një eventi nuk paraqitet si provë që nuk pati thirrje.
- Dallojmë kohën nga klikimi te përgjigjja, kohën e queue, modelit, mjeteve dhe dërgimit. Matim thirrjet/token-at dhe ciklet pa progres.
- Dalje: suite e përbashkët e seksionit 7, raport me dështime të hapura dhe prova në browser. Model timeout/invalid output provohen veçmas nga gabimet e biznesit.

### Faza 6 — Zëvendësimi përfundimtar dhe heqja e legacy

- Kryejmë reset-in e përcaktuar, ose kalimin në DB të freskët nëse është alternativa e zgjedhur. Gjithë konsumatorët kalojnë në kontratat e reja në një lëshim të koordinuar.
- Heqim koordinatorin e vjetër, flamujt dhe snapshots e tij, pyetësorët paralelë dhe fallbacks që mund ta rikthejnë rrugën e vjetër. Nuk mbajmë dual writes ose përzgjedhje të heshtur motori.
- Kalojmë testet e plota, typecheck, lint, build, migrimet nga zero dhe kontrollin e heuristikave gjuhësore. Verifikojmë rrugët manuale dhe integrimet që ruhen.
- Dalje: një runtime dhe një model gjendjeje. Për rikthim, restaurohen kodi dhe skema/snapshot-i i përputhshëm me worker-at të ndalur; kodi i vjetër nuk lidhet me skemën e re. Integrimet e jashtme kontrollohen veçmas.

## 7. Kriteret e pranimit

### Përvoja dhe përgjithësia

- Gjashtë konfigurime sintetike: dyqan produktesh, sallon me rezervime, shërbim B2B me kërkesë të strukturuar, regjistrim biznesi, biznes vetëm informues dhe mbështetje me kalim te stafi. Mungesa e një adapteri nuk maskohet si integrim real.
- Për secilin: rrjedhë normale, pyetje ndërmjetëse, korrigjim, refuzim, paqartësi, ndërprerje/rifillim dhe mesazhe të njëpasnjëshme. Përgjigjet nuk varen nga një listë formulimesh të njohura.
- Regjistrimi nuk bëhet porosi; emri i organizatës nuk bëhet emri i personit; fusha e pritshme ekziston në kontratën semantike para plotësimit.
- Një email i vlefshëm pranohet në target-in e duhur pa kërkesë të panevojshme të përsëritur. Konfirmimi i vlefshëm avancon vetëm propozimin e duhur. Pyetja sqaruese nuk e shuan progresin.
- Mbyllja informative është e lejueshme kur është zgjedhja e duhur; nuk imponojmë workflow në çdo mesazh. Politika e biznesit mund të kërkojë propozim të përshtatshëm pas sqarimit të nevojës.

### Siguria dhe qëndrueshmëria

- Zero shkrime të paautorizuara në rastet e testuara; zero kalime mes tenant-ëve; zero pretendime suksesi pa rezultat të konfirmuar.
- Konfirmimet e skaduara, për objekt tjetër, me të dhëna të korrigjuara ose të paparaqitura nuk ekzekutojnë veprim.
- Duplicate event, dy worker-a dhe retry pas humbjes së përgjigjes nuk dyfishojnë efektin. Rezultati i panjohur shkon në reconciliation, jo ridërgim të verbër.
- Prompt injection në mesazh, njohuri, etiketa ose tool output nuk zgjeron lejet ose katalogun e mjeteve.
- Test mode nuk shkruan te adapterët realë. Pariteti kontrollohet me të njëjtat evente/kontrata, duke dalluar me qëllim delivery dhe simulimin e efekteve.

### Vlerësimi i modelit dhe cilësia

- Suite bazë: gjashtë rrjedha × katër gjuhë (shqip, anglisht, italisht, gjuhë e katërt e zgjedhur për provë jashtë formulimeve të zhvillimit) × tre përsëritje = 72 episode, me model të fiksuar dhe konfigurim të regjistruar. Skenarët negativë/kufitarë shtohen veçmas.
- Pragu fillestar i propozuar: të paktën 95% rezultat i saktë në episodet normale; të gjitha invariantat deterministe duhet të kalojnë. Çdo dështim kategorizohet; mesatarja nuk fsheh dështime sigurie ose një rrjedhë bazë të bllokuar vazhdimisht.
- Matim koston dhe kohën reale kundrejt baseline-it për të njëjtat episode. Kufiri numerik i p95/kostos vendoset pas baseline-it në fazën 0; nuk shpiket tani pa matje. Buxheti teknik i worker-it është i detyrueshëm që nga faza 2.
- Testet përdorin fixtures semantike për tranzicionet dhe model real për interpretimin; njëra kategori nuk zëvendëson tjetrën. Provat SQL të konkurrencës nuk zëvendësohen me mocks.
- Kontrollojmë heuristikat në gjithë rrjedhën e zëvendësuar. Regex për formate/ID dhe kërkimi i evidencës lejohen; frazat që interpretojnë qëllimin jo. Çdo mbetje jashtë scope-it identifikohet shprehimisht.

## 8. Çfarë duhet të dalë nga implementimi

- Bërthamë e vetme, kontrata të tipizuara, skemë e riprodhueshme dhe procedurë reset/recovery e provuar.
- Editor, asistenti i pronarit, proceset e klientit dhe kanalet të lidhura me të njëjtin model procesi dhe kontrolle të përbashkëta shërbimi.
- Gjurmë të përdorshme në ChatLab dhe raste pranimi të riprodhueshme, pa sekrete.
- Lista konkrete e legacy të hequr, aftësive të ruajtura, kufizimeve të mbetura dhe integrimeve të paprovuara.
- Ndarje e qartë në dorëzim: kod lokal, prova me model real, prova me DB të izoluar, lidhje reale integrimesh dhe publikim. Asnjëra nuk nënkupton automatikisht tjetrën.

Rreziqet kryesore janë migrimi i editorit/authoring-ut në skemën e re, përzierja e lejeve të pronarit me ato të klientit, rezultatet e pasigurta të shërbimeve të jashtme dhe kostoja/vonesa e ciklit agentik. Fazat dhe provat e mësipërme i trajtojnë këto përpara zëvendësimit përfundimtar.

## 9. Përparimi i implementimit — 5 nëntor 2026

Drejtimi i rikonfirmuar: runtime-i i vjetër do të zëvendësohet dhe hiqet, jo të mbahet si motor paralel ose shtresë kompatibiliteti. `schemaVersion: 4` është vetëm identifikues formati. Kriteri i dorëzimit mbetet një hyrje dhe një motor për të gjitha kanalet, me aftësitë ekzistuese të zhvendosura. Fshirja e rekordeve është anuluar nga përdoruesi; zëvendësimi i kodit nuk autorizon reset të të dhënave. Fallback-et që mbeten gjatë ndërtimit janë punë e papërfunduar, jo pjesë e arkitekturës përfundimtare.

E implementuar në kod lokal, ende pa zëvendësuar hyrjen ekzistuese të bisedave:

- `src/lib/orchestration/`: kontrata v4, validim përkufizimesh dhe vlerash, tranzicione atomike, instanca të ndara, oferta, fakte sipas subjektit, konfirmime me dëftesë paraqitjeje, pezullim/rifillim/anulim, pritje eventi dhe rezultate veprimesh. Korrigjimet para efektit rivlerësojnë kushtet dhe zhvlerësojnë konfirmimin e mëparshëm.
- Kontrata semantike përfshin fushat e paplotësuara, të dhënat e paraqitura për konfirmim dhe ID-të konkrete. Modeli merr skemë strikte; dështimi, paqartësia dhe përgjigjja e paplotë nuk prodhojnë miratim alternativ me fraza.
- Ekzekutuesi ruan pretendimin e ekzekutimit përpara adapterit, ndan simulimin nga veprimi real dhe ruan pasigurinë pas humbjes së rezultatit. Identiteti i veprimit dallon dy instanca me input të njëjtë. Adapterët realë të domain-eve ende nuk janë lidhur me këtë ekzekutues.
- Migrimi `20261105220000_process_checkpoints.sql` ruan snapshot-in te `conversation_states` dhe përgjigjen te queue ekzistuese, me journal deduplikimi, CAS/revision, lease dhe kontroll pronësie. Paraqitja e prompt-it regjistrohet vetëm nga queue me status të konfirmuar `sent`. Migrimi është provuar lokalisht; nuk është aplikuar në databazën e projektit.

Verifikimi i kryer:

- Kaluan 52 teste njësie për tranzicionet, kontratat, gabimet e modelit dhe kufirin e ekzekutimit: `yarn vitest run src/lib/orchestration`. Kaluan edhe kontrolli TypeScript dhe lint për skedarët e rinj.
- PostgreSQL real, i përkohshëm, pa lidhje TCP dhe pa lexuar env të projektit: `node e2e/process-checkpoints.mjs`. Provohen konkurrenca, deduplikimi, rollback, tenant/role isolation, lease/pronësia, ndarja test/live dhe dëftesat e paraqitjes. Skema e varësive është fixture minimale; kjo **nuk** është ende provë e baseline-it të plotë të Supabase nga zero ose e transportit real.
- Model real `gpt-5.6-luna`: katër raste gjuhësore (shqip, anglisht, italisht, turqisht), secili me email të personalizuar, pyetje ndërmjetëse, moskonfirmim dhe konfirmim. Prova e parë zbuloi konfirmim shqip të trajtuar si paqartësi; pas plotësimit të kontekstit të review-t dhe udhëzimit semantik të përgjithshëm, kaluan të katër rastet. Dy prova shtesë verifikuan ofertën për proces collection-only pas nevojave të deklaruara dhe mbylljen normale pa proces. Këto janë gjashtë raste diagnostikuese, jo suite-a e 72 episodeve dhe jo provë në browser.
- Thirrja eksplicite për modelin: `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config e2e/process-model.vitest.config.ts`. Suite-a normale nuk bën thirrje modeli. Sekretet nuk ruhen në fixtures ose rezultate.

Puna e mbetur përpara zëvendësimit:

- Lidhja e përkufizimit me editorin e versionuar dhe e bërthamës me hyrjen e përbashkët, ChatLab-in, sesionet e provës dhe kanalet; rrjedha e dukshme me model real mbetet e paprovuar për motorin e ri.
- Adapterët e regjistrimit/porosisë/rezervimit, leximi agentik i njohurive/katalogut, gjenerimi i përgjigjes nga rezultatet e validuara, recovery i veprimeve pas restart-it dhe gjurmët në UI. Korrigjimi i fakteve pas një efekti aktualisht refuzohet; nuk ka kompensim të implementuar.
- Inventari përfundimtar i reset-it, replay i plotë SQL, vlerësimi i gjerë dhe heqja e runtime-it të vjetër. Nuk është fshirë asnjë rekord.
- Kontrolli i heuristikave te moduli i ri gjeti vetëm kontrolle skeme/ID/enum/formati dhe verifikim literal evidence. Rrjedha legacy mbetet në përdorim dhe nuk pretendohet e pastruar.

Fazat 0–1 janë ende në zhvillim; provat semantike të fazës 2 filluan herët për të kontrolluar kontratat. Ky status nuk deklaron të përfunduar ndonjë fazë të plotë.

Përditësim i integrimit: përkufizimet tani përpilohen nga grafiku ekzistues i editorit dhe hyrja e provave përdor v4 për grafiqet e mbështetura. Kushtet semantike kanë rezultat të strukturuar me version/hap/instancë dhe evidencë; kushtet e fushave mbeten deterministe. Inspektori shfaq hapat, revision-in dhe faktet e ndara sipas instancës. Sesionet v4 nuk lejohen të bien në ruajtjen legacy. Porositë, rezervimet, fotot dhe transporti live ende presin integrimin përfundimtar; ky nuk është cutover i plotë.

Kontrollet e fundit: 296 teste të përzgjedhura dhe TypeScript kaluan. Sipas kërkesës së përdoruesit, provat në browser u ndaluan dhe testet e gjera shtyhen. Migrimi kaloi sërish në PostgreSQL lokal të përkohshëm. Aplikimi në Supabase është bllokuar nga kredencialet: `.env.local` ka URL/anon/service-role për API, por jo lidhje SQL ose access token të menaxhimit; CLI nuk është autentikuar. Asnjë migrim nuk është deklaruar si i aplikuar në projektin remote.

Përditësim database-i: pasi u konfigurua `SUPABASE_ACCESS_TOKEN`, migrimi `20261105220000_process_checkpoints.sql` u aplikua në projektin Supabase të `.env.local`, bashkë me regjistrimin atomik në `supabase_migrations.schema_migrations`. U verifikuan tabela me RLS, të dy RPC-të, mungesa e lejes EXECUTE për authenticated dhe prania e saj për service_role. Nuk u fshinë rekordet ekzistuese. Kjo zgjidh bllokimin e aksesit të përmendur më sipër; transporti live dhe adapterët mbeten ende për t'u lidhur.

Përditësim — 6 nëntor 2026: migrimi `20261105233000_process_transport_receipts.sql` u aplikua në Supabase dhe u verifikuan të dy trigger-at aktivë. Paraqitja e propozimit tani regjistrohet atomikisht kur transporti konfirmon statusin `sent`; marker-i i procesit shmang krijimin automatik legacy të porosisë për këto jobs. Porta e queue pranon envelope-in e procesit, kontrollon scope/revision/mode dhe ruan përgjigjen përmes checkpoint-it, duke rilexuar tekstin autoritativ në replay. Ende nuk ka prodhues live të këtij envelope-i në koordinator; ky është integrim i transportit, jo cutover i përfunduar.

U shtua adapteri `businessProvisionAdapter`: simulimi mbetet i izoluar; ekzekutimi live kërkon scope të serverit, version të instancës dhe revision-in e claim-it të ruajtur, dhe ripërdor RPC-në ekzistuese me kontroll lease/pronësie/lejesh/kuote. Request ID lidhet me action ID që kërkesat identike të dallohen. Adapteri përdoret nga prova; lidhja live pret koordinatorin durabël dhe recovery.

Paneli dhe inbound tani lexojnë snapshot-in e ruajtur v4 pa e zëvendësuar me gjendje bosh dhe pa kopjuar faktet në profilin legacy. Kaluan TypeScript, lint i skedarëve të kontrolluar, 31 teste të adapterit/leximit/queue dhe 89 kontrolle ekzistuese inbound/transport. Nuk u përdor browseri dhe nuk u krijua biznes real gjatë këtyre testeve. Koordinatori live, panel commit, recovery dhe adapterët e porosisë/rezervimit ende kërkojnë zëvendësim; heuristikat legacy jashtë rrugës së re ende ekzistojnë.

Lejet u përditësuan: përdoruesi lejoi sërish provat në browser dhe fshirjen e rekordeve kur nevojitet për kalimin. Ende nuk u fshi asnjë rekord. Migrimi `20261106110000_process_panel_reply.sql` u aplikua në Supabase pas provës në PostgreSQL lokal: commit-i i panelit ruan snapshot-in, transcript-in dhe paraqitjen atomikisht; replay nuk dyfishon mesazhet. U verifikua akses vetëm për service_role. Paneli përdor RPC-në e re kur merr envelope-in e procesit. Koordinatori live ende duhet ta prodhojë atë envelope; zëvendësimi i plotë nuk është përfunduar.

Përditësim aktual — 6 nëntor 2026 (zëvendëson statuset historike sipër):

- Koordinatori live është lidhur me checkpoint-et durabël në panel dhe inbound për grafiqet e mbështetura. Interpretimi ruhet para efekteve; retry pas dështimit të përgjigjes ripërdor gjendjen, ndërsa efektet running/unknown nuk ridërgohen verbërisht. Migrimi `20261106113000_process_live_entry.sql` është aplikuar.
- Prova me model real dhe Supabase, me një bisedë paneli të përkohshme, kaloi dy herë: informim → nisje regjistrimi → pyetje me dëftesë paraqitjeje. Një provë paraprake dështoi pa gjurmë të mjaftueshme; shkaku nuk është shpjeguar dhe stabiliteti nuk deklarohet i provuar. U pastruan vetëm rekordet sintetike të provës. Hyrja në browser nuk u përfundua.
- Nyja standarde `booking` tani përpilohet në mbledhje shërbimi/date/ore/emri/kontakti, review me kushtet aktuale të serverit dhe efekt `booking.create`. Modeli nuk mund të shkruajë kushtet e serverit; ndryshimi i tyre zhvlerëson review-n dhe kërkon paraqitje/konfirmim të ri. Serveri kontrollon sërish workflow-n, kufizimin e shërbimit, disponueshmërinë dhe kushtet para shkrimit. Inspektori lidh hapat e brendshëm me nyjën origjinale të editorit.
- Migrimet `20261106130000_process_booking_terms.sql` dhe `20261106140000_process_booking_policy.sql` janë aplikuar në Supabase me ledger. RPC-ja kontrollon input-in kundrejt action-it running të ruajtur, skadimin e miratimit, scope-in, kushtet nën lock dhe ndalimin collection-only. Testi PostgreSQL provon këto kontrolle dhe deduplikimin me shkrues kalendari stub; nuk provon Google Calendar apo një rezervim real. Nuk u krijua rezervim real nga rruga e re.
- Kaluan 93 teste të orchestration dhe kontrollet TypeScript/lint. Në kodin e prekur nuk u shtuan heuristika gjuhësore; regex-et e reja validojnë vetëm UUID. Legacy ende përmban interpretim të vjetër te `workflows/visual/execute.ts` dhe `calendar/agent.ts`.

Të papërfunduara: rezervimet collection-only, produktet/porositë/statusi i porosive/fotot dhe preview linear ende kanë rrugën e vjetër; grafiqet me këto aftësi nuk janë zëvendësuar plotësisht. Mbeten recovery/reconciliation për rezultate të panjohura, kontrolli i plotë i takeover nga stafi, retrieval-i i plotë i katalogëve, provat reale të domain-eve dhe heqja e motorit legacy. Kodi lokal nuk është publikim. Ky përditësim nuk deklaron përfundim të zëvendësimit.

Prova semantike e rezervimit me model real kaloi: shërbimi i emërtuar në shqip u zgjidh te ID-ja e katalogut, u mblodhën të dhënat, u kërkua review dhe u përgatit veprimi vetëm pas konfirmimit të veçantë me dëftesë paraqitjeje. Testi përdor katalog/konfigurim sintetik dhe nuk ekzekuton adapterin real; nuk është provë e krijimit të rezervimit në Supabase apo Google Calendar.

Përditësim — 7 nëntor 2026 (statusi aktual, mbi shënimet historike):

- Hyrja e përbashkët tani thërret vetëm koordinatorin e ri; nuk ka kthim te implementimi i vjetër kur mungon transporti ose një përkufizim është i pavlefshëm. Janë lidhur adapterët e porosive/statusit, fotot e verifikuara, collection-only dhe preview linear. Emrat compatibility të disa eksporteve dhe module/teste të vjetra ende ekzistojnë; kjo nuk përbën pastrim të përfunduar të repository-t.
- Recovery lexon dëftesat e domain-it pa riekzekutuar efektin. Identiteti i riprovimit validohet përpara recovery-t; dështimi i leximit ruan pasigurinë, ndërsa dështimi i commit-it propagandohet. Rilidhja e trajnimit përdor biznesin, versionin, rrjedhën dhe hapin real të editorit. Preferencat e komunikimit përfshihen në kompozimin e përgjigjes.
- Migrimet `20261106160000_process_order_submission` dhe `20261106170000_process_linear_orders` u verifikuan në ledger-in remote. U aplikuan edhe `20261107010000_process_ownership` dhe `20261107011000_process_order_review_receipts`, me regjistrim atomik në ledger. U verifikuan RLS për dëftesat, trigger-i i ownership dhe ekzekutimi i resume vetëm nga service_role. Pause zhvlerëson propozimet/miratimet dhe ruan faktet/dëftesat e pasigurta; resume sinkronizon revision-in e JSON-it dhe rreshtit. Resume i gjendjes së vjetër e nis motorin e ri bosh, sipas autorizimit për reset para përdorimit real.
- Kërkesa `awaiting_staff` ka tani dëftesë transaksionale edhe pa krijuar porosi. Replay nuk e kthen në porosi automatike pas ndryshimit të politikës. Testet provojnë ruajtjen e këtij rezultati dhe krijimin/dërgimin manual vetëm me autoritetin përkatës.
- Kaluan 231 teste të fokusuara në orchestration/inbound/reactions, më pas 3 teste shtesë për rikuperimin e porosive; TypeScript kaloi. PostgreSQL i përkohshëm ekzekutoi migrimet reale dhe provoi CAS, scope, lease, miratimet, deduplikimin, ndryshimin e ownership dhe reset-in gjatë resume. Nuk është replay i plotë i baseline-it Supabase, as provë provider-ësh realë.
- Kontrolli i plotë para ndryshimeve të fundit dha 2,791 teste të kaluara dhe 348 të dështuara në pesë skedarë të lidhur me kontratat/mocks e vjetra (`process-agent-turn`, `process-conversation-message`, `pinned-workflow-continuation`, `service-routing`, `chat-lab/isolation`). Nuk janë fshirë ose çaktivizuar për të fshehur dështimet. Nevojitet migrim i mbulimit të tyre te kontrata e re dhe shqyrtim i regresioneve funksionale.
- Leximi remote gjeti 2 gjendje v4, 8 v3 dhe 315 pa version; queue ka 2 prepared, 4 queued dhe 4 uncertain. Nuk u fshinë ose ridërguan këto punë. Migrimet e këtij përditësimi nuk bëjnë reset masiv të të dhënave.

Ende të pambyllura për zëvendësimin e plotë: kompozimi i workflow-t linear të produktit brenda rrjedhës vizuale (pa anashkalim të hapave dhe pa dyfishim porosie), retrieval-i i plotë i katalogëve/dokumenteve dhe projeksioni i katalogëve të mëdhenj, migrimi i testeve/rrugëve të mbetura legacy dhe kalimi final i gjendjeve të vjetra. Simulimi strukturor i editorit përdor ende runtime-in e mëparshëm. Kontrolli i rrjedhës së re nuk gjeti lista frazash për kuptimin e klientit; module të vjetra si `workflows/visual/runtime.ts`, `workflows/visual/execute.ts` dhe `calendar/agent.ts` ende ekzistojnë dhe nuk janë deklaruar të pastruara. Kodi lokal nuk është publikuar; zëvendësimi i plotë nuk është deklaruar i përfunduar.

Rezultatet e efekteve tani ruhen sipas hapit në snapshot dhe përdoren në përgjigje edhe pas një efekti pasues; testi me dy efekte të njëpasnjëshme kaloi. Prova e re me model real dhe Supabase kaloi dy mesazhe informim → nisje regjistrimi, me paraqitje të konfirmuar dhe pastrim vetëm të bisedës sintetike. Nuk ekzekutoi regjistrim biznesi, porosi apo rezervim real.

## 10. Dorëzim për agjentin pasues — 7 nëntor 2026

Ky seksion zëvendëson statuset historike të seksionit 9. Kërkesa mbetet **zëvendësim i plotë**, jo dy runtime paralelë. Përdoruesi ka autorizuar ndryshimet e kodit, migrimet, fshirjen/reset-in e rekordeve të vjetra dhe provat në browser. Nuk kërkohet sërish miratim për këto. Nuk është bërë publikim i aplikacionit. Lexo `AGENTS.md` para ndryshimeve; kuptimi i klientit interpretohet semantikisht, jo me fjalor frazash. Mos printo sekretet e `.env.local`.

### Ku është shkruar integrimi

- Hyrja: `src/lib/conversations/process-conversation-message.ts` dhe `process-agent-turn.ts` delegojnë te `src/lib/orchestration/conversation.ts`. Eksportet `processLegacyAgentTurn` dhe `tryProcessConversation` janë hequr. `contracts.ts`, `transition.ts`, `observation.ts`, `interpret.ts`, `respond.ts`, `run-turn.ts`, `executor.ts` dhe `persistence.ts` në atë direktori mbajnë kontratën, interpretimin, tranzicionet, efektet dhe checkpoint-et.
- Kompozimi visual + linear: `product-composition.ts` fut hapat e produktit pas përzgjedhjes, rikthehet te hapi pasues i grafit dhe lë vetëm një efekt përfundimtar porosie. `product-dependencies.ts` fikson versionin linear në `instance.productWorkflow`; ndryshimi/publikimi i lidhjes së produktit nuk ndryshon një kërkesë ekzistuese. `order.ts` dhe `order-context.ts` kontrollojnë këtë lidhje. `training-context.ts` dhe gjurmët e koordinatorit rikthejnë ID-të te nyja vizuale dhe hapi linear origjinal.
- Informacioni: `grounding-context.ts` rendit semantikisht katalogët përpara kufizimit të kontekstit, ruan statusin partial/count dhe nuk shpik rreshta pas dështimit. `src/lib/catalogs/retrieval.ts` ka rrugën `semanticRouting` të motorit të ri, ndarjen dokument/produkt/informacion, kualifikimin e tregut/gjuhës dhe deadline të përbashkët. `Snapshot.retrieval` ruan kontekstin informativ. `businessProcessContext` përfshihet në koordinator si udhëzim, jo autorizim. Pasqyrimet e shërbimeve në knowledge përjashtohen nga projeksioni i ri; çmimet vijnë nga `booking_services`.
- Transporti: `src/lib/conversations/workflow-queue.ts` pranon vetëm checkpoint native për përgjigje automatike dhe nuk dërgon prepared output legacy; rruga manuale staff ruhet. `src/lib/agents/panel-chat/execute.ts` përdor vetëm `finish_process_panel_chat`. Nuk ka më fallback te `prepare_workflow_reply`/`finish_panel_chat` në këto thirrje.
- Porositë manuale: `src/lib/orders/submission.ts` pranon snapshot native/action ID të ruajtur dhe përdor `submit_process_order`; ruan dispatch-in e jashtëm, pasigurinë dhe reconciliation manual. U hoq `src/lib/orders/automatic.ts`, eksporti `submitAgentConfirmedOrder` dhe rruga v3 e krijimit të porosive. Adapteri automatik i ri është `src/lib/orchestration/order.ts`; nuk ekzekutohet në hook-un e dërgimit të mesazhit.
- Domain-et e tjera: `business-provision.ts`, `booking.ts`, `order-status.ts` dhe `tools.ts` në orchestration; kontrollo emrat aktualë me `rg --files src/lib/orchestration` para leximit. Ruajtja e rezultateve sipas hapit është `Instance.results`; recovery lexon receipts, nuk ridërgon efektet running/unknown verbërisht.

### Databaza dhe provat e kryera

Përveç migrimeve të përmendura më sipër, u aplikuan me ledger atomik në Supabase: `20261107120000_process_product_dependencies.sql` dhe `20261107121000_process_pinned_product_bindings.sql`. I dyti korrigjon kontrollin e lidhjes aktuale të produktit: kontrollohet versioni i fiksuar në instancë, që një ricaktim workflow të mos prishë porositë në proces. Kërkohen fushat/opsionet/fotot e versionit linear dhe përputhja me input-in e action-it. Mos modifiko migrime të aplikuara; bëj migrim pasues.

`node e2e/process-checkpoints.mjs` kaloi pas këtyre migrimeve me PostgreSQL të përkohshëm dhe kontratat e booking/order/ownership. Nuk është replay i gjithë baseline-it Supabase. Provat reale të mëparshme me model + Supabase kaluan informim → nisje regjistrimi; nuk krijuan biznes/porosi/rezervim real. Ndryshimet e fundit të kompozimit/retrieval-it ende kërkojnë përsëritjen e kësaj prove.

Paketa e plotë kaloi me 2 832 teste pas migrimit të pesë suite-ve të vjetra. **Kjo nuk do të thotë se 348 rastet e vjetra u portuan një për një**: testet e implementimit të hequr u zëvendësuan me kontrata native dhe prova të koordinatorit. Pas heqjes së fallback-eve, kaluan 35 teste queue/isolation/grounding, 34 teste të dorëzimit manual të porosive dhe 5 teste audit për dokumentet/shërbimet. Testet e mëparshme të çmimeve/kushteve të porosive mbulohen në kontratën SQL dhe adapterët native; mock-et e API-së nuk janë provë e atomikës SQL. TypeScript kaloi para ndryshimit të fundit të submission; kontrolli përfundimtar është në proces.

### Punët e mbetura — mos shpall zëvendësim të përfunduar

1. **Simulimi strukturor i editorit:** `src/lib/workflows/visual/simulation.ts` ende përdor `advanceVisualWorkflow` nga runtime i vjetër. Kaloje te përpiluesi dhe `transition` native. Ruaj scenarios/branches/regression/validation/version/publish; skenarët janë input sintetik i deklaruar, jo fraza runtime. Shërbimet e jashtme mbeten UNVERIFIED dhe nuk thirren. Ndrysho edhe identifikuesin `visual-runtime-v2` në kontratën e raportit. Mos e masko motorin e vjetër duke ndryshuar vetëm emrin.
2. **Cutover i gjendjeve/radhës së vjetër:** nuk është bërë reset masiv. Inventari i mëparshëm ishte 2 v4, 8 v3, 315 pa version; queue 2 prepared, 4 queued, 4 uncertain (këto nuk janë statistika aktuale). Lexo sërish përpara migrimit. Mbyll vetëm punët legacy, ruaj receipts native dhe historikun/domain records; mos ridërgo uncertain jobs. Koordino lock-et/lease-et me worker-at, pastaj hiq lexuesin legacy nga `stored-state.ts` dhe degët e hydrate/suspend v3 në `handle-inbound.ts`. Output legacy tashmë bllokohet nga kodi i ri, ndaj mos lër queue-n pa trajtimin e cutover-it.
3. **Pastrimi i implementimeve/RPC-ve të vjetra:** inspekto importuesit për `workflows/visual/runtime.ts`, `workflows/visual/execute.ts`, `calendar/agent.ts`, shkruesit e vjetër SQL dhe helpers. Hiq vetëm pasi të jenë transferuar konsumatorët realë; mos fshi editorin apo funksione manuale. Rruga e re e shqyrtuar përdor `includes`/regex për enum/ID/format dhe evidencë literal, jo interpretim frazash; nuk është bërë audit final i gjithë pemës legacy.
4. **Referenca relative në katalogë të mëdhenj:** projeksioni semantik është i lidhur, por referencat si “i dyti” mund të humbasin ID-të kur produkti nuk hyn në subset-in e turnit të ri. Nevojitet metadata e paraqitjes së konfirmuar, validim i ID-ve dhe rilexim tenant/active, pa heuristika emrash. Kontrollo edhe fushat e produktit të korrigjuar me skema të ndryshme dhe kufijtë e zgjerimit graf+linear.
5. **Mbulimi përfundimtar:** verifiko paritetin e funksioneve që mbulonin testet e hequra, privacy/redaction dhe historikun e fakteve. Provo rrjedhën e përbërë, ndryshimet e produktit, recovery dhe gabimet e modelit. Efektet unknown mbeten bllokuese deri te receipt/reconciliation; mungesa e receipt-it për një lexues si `orders.status` duhet vlerësuar veçmas. Suite-a 72 episodeve, build/publikimi, replay i plotë DB nga zero dhe provider-ët realë nuk janë të përfunduar.

### Si të vazhdohet

- Kontrollo `git status --short` dhe `git log`: në këtë workspace disa ndryshime janë commit-uar nga jashtë ndërkohë që punohej. Mos supozo që diff bosh do të thotë se integrimi mungon; mos bëj reset.
- Testet: `node node_modules/vitest/vitest.mjs run`; `node node_modules/typescript/bin/tsc --noEmit`; `node e2e/process-checkpoints.mjs`.
- Auditet e përshtatura: `node node_modules/vitest/vitest.mjs run --config docs/qa-audit/vitest.audit.config.ts docs/qa-audit/tests/catalog-qualification.test.ts docs/qa-audit/tests/service-module-grounding.test.ts`.
- Model real: `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config e2e/process-model.vitest.config.ts`.
- Smoke live: cakto `PROCESS_SMOKE_BUSINESS_ID` të tenant-it të autorizuar dhe ekzekuto `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config e2e/process-live.vitest.config.ts`. Testi krijon/pastron vetëm bisedën e vet; lexo fillimisht fixture-n për scope-in.
- Migrimet remote aplikohen përmes Supabase Management API me `SUPABASE_ACCESS_TOKEN` nga env; publishable/service-role key nuk është kredencial SQL. Regjistro version/name/statements në të njëjtin transaksion. Nëse zëvendëson tekstin `commit;` me JavaScript, përdor callback të `replace` që sekuencat `$` të SQL të mos interpretohen si zëvendësim string-u.

### Përditësim pas seksionit 10 — cutover dhe simulimi native

Ky përditësim ka përparësi mbi listën e punëve të mbetura të seksionit 10:

- **Reset-i është kryer.** `20261107163000_process_state_cutover.sql` u provua me `e2e/process-cutover-contract.mjs` (thirret nga `e2e/process-checkpoints.mjs`) dhe u aplikua në Supabase me ledger atomik. Para migrimit: 325 legacy + 2 native. Pas migrimit: **327 snapshot-e native**, constraint `conversation_states_native_snapshot` i validuar. U mbyllën provat e vjetra të queue; u ruajt një job paneli native, 2 prepared staff dhe 4 uncertain staff. Asnjë mesazh i pasigurt nuk u ridërgua. Nuk u fshinë mesazhet, klientët apo porositë. Trigger-i `initialize_process_snapshot` inicializon vetëm INSERT `{}`; UPDATE me format legacy/bosh ose revision/scope të papërputhshëm refuzohet. Migrimi refuzon worker processing/sending me lease aktiv. Prova SQL konfirmon rollback para reset-it kur ka worker aktiv dhe ruajtjen e snapshot-eve native/dëftesave staff.
- `handle-inbound.ts` inicializon snapshot native për biseda të reja. U hoq shkrimi/dërgimi direkt i vjetër pas degës së queue, i cili ishte tashmë i paarritshëm. **Ende mbeten degë leximi/projeksioni legacy në këtë skedar dhe në `stored-state.ts`; nuk janë më shkrues të vlefshëm pas constraint-it DB.** Kontrollo paritetin e CRM/profile context përpara heqjes, që të mos humbet funksion ekzistues.
- **Simulimi strukturor është zhvendosur.** `workflows/visual/simulation.ts` tani përpilon me `compileVisualProcesses` dhe ekzekuton `transitionCustomer`/`recordPresentation`. Nuk importon më `advanceVisualWorkflow` ose kontekstin e vjetër të interpretimit. Skenarët furnizojnë observations sintetike eksplicite; nuk interpretohen “po/jo” me kod. Konfirmimet/fotot kërkojnë pritje native të paraqitur. `SimulationReport.engine` është `process-runtime`. Nyjet e shërbimeve ndalojnë para çdo efektit real dhe mbeten UNVERIFIED. Një nyje globale jashtë proceseve të përpiluara nuk simulohet si rrugë e verifikuar. Testet e degëve përdorin fushë të deklaruar në proces (fixture e vjetër kishte kusht para flow-t pa fushë të deklaruar). Kaluan 23 teste, përfshirë injektim tranzicioni të gabuar, regresion, redaktim, kufijtë dhe mos-thirrjen e provider-ëve. Module `visual/runtime.ts`/`visual/execute.ts` ende janë në repository; kërkimi i importuesve tregoi execute të lidhur vetëm me testet e vjetra dhe runtime me execute/teste. Mos hiq testet pa shqyrtim të mbulimit të tyre.
- **Gabim real i kompozimit i korrigjuar:** smoke pas cutover-it dështoi në turnin informativ me `invalid_reply_targets` dhe pa komandë/efekt. Skema e vjetër lejonte array me target ID arbitrare. `respond.ts` tani gjeneron object strict me vetëm çelësat target të serverit; zero target jep object bosh. Serveri revalidon mungesat, çelësat e tepërt, tekstin bosh/tipin, dhe deduplikon target-et identike. 9 teste të reja në `orchestration/respond.test.ts` kaluan. Smoke i përsëritur me model real dhe Supabase **kaloi në rreth 17 sekonda** pas korrigjimit, pa krijuar biznes/porosi/rezervim dhe duke pastruar bisedën e vet.
- **Testet transport/API u portuan, nuk u çaktivizuan:** 96 raste të `handle-inbound.test.ts` dhe route orders kaluan me checkpoint native. Suite-a e plotë pas cutover-it (përpara simulatorit/respond tests të fundit) dha **2 837 passed, 0 failed**, evidencë lokale `/private/tmp/agjenti-cutover-tests.json`. TypeScript dhe lint të skedarëve të kontrolluar kaluan. Kontrolli final pas simulatorit do të regjistrohet më poshtë.

Mbeten: pastrimi i lexuesve dhe moduleve/RPC-ve legacy me inventar importuesish; pariteti i kontekstit të profilit/kujtesës/redaktimit dhe referencat relative të katalogëve të mëdhenj; reconciliation e lexuesve pa receipt; kufijtë e kompozimit dhe skemat gjatë korrigjimit të produktit; vlerësimi i gjerë me model/provider, replay i plotë DB dhe publikimi. **Nuk është shpallur përfundimi i zëvendësimit të plotë.**

### Përditësim — 7 nëntor 2026, pas cutover: profil, katalog, korrigjim produkti

Ky përditësim ka përparësi mbi listën “Mbeten” sipër:

- **Lexuesit live nuk pranojnë më snapshot v3.** `stored-state.ts` kthen vetëm v4 ose `{}`; `handle-inbound.ts` nuk hydraton/pezullon degë `conversationPaused`/`visual`/`processes` legacy. Prompt i papërftuar bllokon me `delivery_unverified`. Handoff i stafit në native vetëm heq `handoffRequested` dhe ruan faktet. `hydrateProfile` mbeti vetëm për testet e veta; hyrja live lexon kujtesën në koordinator.
- **Pariteti i profilit në runtime native:** `readProcessProfile` lexon `conversation_profiles` me tenant/participant/channel, vetëm vlera të valinuara. Koordinatori e vendos te `Snapshot.profileMemory`. Në `start`/`accept_offer` serveri e kopjon te fushat `customer_*` me provenance `profile_memory`, pa evidencë nga mesazhi. Modeli nuk e kopjon si fakt; përgjigjja e përdor vetëm për pyetje të identitetit të vetë klientit.
- **Referencat relative të katalogut:** `Snapshot.catalogPresentation` ruan ID, displayOrder dhe digest-in e përgjigjes së dërguar. Slotet `[[product:id]]`/`[[service:id]]` renderohen nga katalogu i këtij turni; lista e përzier produkt+shërbim nuk regjistrohet. Turni i radhës i jep interpretuesit listën e paraqitur dhe rilexon tenant/active; ID-të e paraqitura futen në subset-in semantik edhe kur nuk janë ndër 20 rreshtat e rinj. Live kërkon `deliveredReply` me të njëjtin digest. Nuk ka heuristika emrash për identitet.
- **Korrigjimi i produktit** aplikon `productId` dhe `bindDependencies` para fushave të tjera, që opsionet e reja të validohen kundrejt skemës së re. Fusha e produktit të mëparshëm hiqet nëse nuk restatohet në të njëjtin event. Kompozimi graf+linear hedh `product_composition_limit` mbi 64 fusha / 128 hapa.
- **`orders.status`** ka `reconcile` që përsërit leximin me të njëjtin identitet të kanalit. Mungesa e identitetit është dështim i përcaktuar; dështimi i leximit ruan `unknown`. Nuk ka receipt domain për këtë lexues.
- Verifikimi lokal: TypeScript kaloi; 305 teste të fokusuara në orchestration/inbound/profile/queue/simulation/submission kaluan. Nuk u përdor browseri, nuk u krijua biznes/porosi/rezervim real, nuk u publikua. Heuristikat e reja janë UUID/ID/enum/digest, jo lista frazash.

Mbeten ende: heqja e `workflows/visual/runtime.ts`, `visual/execute.ts`, `calendar/agent.ts` dhe `conversation-processes` pasi të transferohen importuesit (sot runtime/execute janë kryesisht teste; `calendar/agent` mbetet si tip për prepared-request/customer-context); `hydrateProfile` legacy; suite-a 72 episodeve, replay i plotë DB, provider-ët realë dhe publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, pastrim i varësive leftover

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **`BookingDraft` u transferua.** Tipi dhe `bookingReviewKey` janë te `src/lib/calendar/draft.ts`. `prepared-request.ts`, `customer-context.ts` dhe `conversation-processes.ts` nuk importojnë më motorin `calendar/agent.ts` për tipet. `processBookingTurn` mbetet vetëm për testet e veta dhe audit-in qa; hyrja live e rezervimit është adapteri native `orchestration/booking.ts`.
- **`hydrateProfile` u hoq.** Nuk kishte importues live pas cutover-it. Kujtesa e klientit lexohet vetëm me `readProcessProfile`; fakti i mbledhur në instancë nuk mbishkruhet nga kujtesa. Testet e kanalit/tenantit/vlerave të pavlefshme mbetën te lexuesi native.
- **Projeksioni native i kërkesës së përgatitur** ka teste të veta: collection-only booking, mospërputhje politike, konfirmim pas dëftesës së paraqitjes, dhe rishikim i ri pas korrigjimit të orës. Korrigjimi i rezervimit nuk dërgon veprimin me wait-in e vjetër.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 194 teste të fokusuara (profil, prepared-request, visual-definition, transition, inbound, conversation, calendar/agent, customer-context) kaluan.
- ChatLab në `localhost:3003` me Zana Store, mënyra PROVË, konfigurim i publikuar: pyetja e katalogut u përgjigj nga motori native (`Gjendja e përgatitur v4`, checkpoint, pa workflow linear); referenca relative “i dyti” u lidh me produktin e dytë të paraqitur. Real chat ishte i fikur. Nuk u krijua rezervim/porosi/biznes real dhe nuk u publikua.

Mbeten ende: heqja e `workflows/visual/runtime.ts`, `visual/execute.ts` dhe `calendar/agent.ts` pas shqyrtimit të mbulimit të testeve të tyre (sot importohen nga teste/qa-audit, jo nga hyrja live); `conversation-processes` ende përdoret nga `turn-decision`/`conversation-control`/`prepared-request-correction` që nuk janë në zinxhirin live; suite-a 72 episodeve, replay i plotë DB, provider-ët realë dhe publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, heqja e motorëve leftover

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Motorët e vjetër u hoqën nga kodi.** Nuk ekzistojnë më `workflows/visual/execute.ts`, `workflows/visual/runtime.ts`, `calendar/agent.ts`, `calendar/agent-parser.ts` dhe `workflows/extract-facts.ts`, as testet që certifikonin vetëm ata. Nuk mbetet import TypeScript drejt këtyre skedarëve. Editori, `calendar/service`, `calendar/model` dhe `persistBooking` mbeten.
- **Mbulimi unique u portua te runtime native.** Grafet e pa vlefshme hedhin `invalid_visual_definition` pa import të runtime-it të vjetër (`graph-validation.test.ts`). Komandat boshe informative e lënë collect-in në pritje. Ndryshimi i kohëzgjatjes para miratimit zëvendëson rishikimin pa dërguar veprimin e vjetër. Audit-et diversity/orchestration dhe `booking-confirmation` thërrasin `compileVisualProcesses`/`transitionCustomer`/`bookingAdapter`, jo motorët e fshirë. Testet me lista frazash (`detectVisualIntent`, Po/Jo, `explicitBookingConfirmation`) nuk u portuan.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 75 teste të fokusuara native; 8 diversity/orchestration; 4 booking-confirmation. Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: çelësa jetimë në `src/test/fixtures/semantic.json` për testet e fshira; `guidance.ts` `explicitIntent` mbetet në rrugën e vjetër.

Mbeten ende: `conversation-processes` (importuar nga `turn-decision`/`conversation-control`/`prepared-request-correction`/`customer-context`, jo nga hyrja live); suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, heqja e `conversation-processes`

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Motori i snapshot-eve v3 u hoq.** Nuk ekzistojnë më `conversation-processes.ts`, `migrateConversationProcesses`, `restoreOrder`, `bookingAdapterState`, `snapshotOrder` dhe `suspendProcesses`. U hoqën edhe `conversation-control` dhe `prepared-request-correction`, që ishin konsumatorë leftover jo në hyrjen live. Editori, rruga manuale e porosive (`submit_process_order`) dhe runtime native mbeten.
- **Tipet e payload-it u lanë te `engine.ts`.** `ConversationProcesses`/`ConversationRouting` janë projeksion prezentimi; `currentProcessOwner` lexon shënuesit leftover të prompt-it, jo progresin live. `turn-decision` dhe `customer-context` nuk importojnë më motor migrimi. Hyrja live mbetet `processConversationMessage` → `processConversation`; gjendja e re refuzohet me `process_session_restart_required` nëse vjen pa `runtime`.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 168 teste të fokusuara (state-authority, entity-bridge, workflow-hub, test-actions, customer-context, composite-recall, turn-decision, orders route, prepared-request, conversation) plus 81 generate/customer-context/turn-decision. Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: `turn-decision` dhe `generateAgentReply`/`customer-context` mbeten jashtë zinxhirit live; `guidance.ts` `explicitIntent`; çelësa jetimë në `semantic.json` për testet e fshira.

Mbeten ende: suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, heqja e klasifikuesve leftover

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Klasifikuesit konkurrues u hoqën.** Nuk ekzistojnë më `turn-decision.ts` (funksionet), `process-offer.ts`, `interpret-process-offer.ts`, `compose-process-question.ts`, as `chooseGuidance`/`explicitIntent`. Hyrja live mbetet `processConversationMessage` → `processConversation` → `interpretCustomer`/`composeProcessReply`. Editori dhe rruga manuale nuk u prekën.
- **U ruajtën kontratat e prezentimit.** `rememberTurn`/`recentConversation` mbeten për transkriptin e kufizuar. `parseCommunicationDraft` mban kufirin e një pyetjeje/propozimi pa fusha të fshehura. `generateAgentReply` dhe `customer-context` mbeten jashtë zinxhirit live.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 63 teste (guidance, communication-contract, process-agent-turn, respond, interpret, conversation, generate). Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: `generateAgentReply`/`customer-context`/`currentProcessOwner`; `understanding/interpret`; `customer-question.ts`; çelësa jetimë në `semantic.json`.

Mbeten ende: suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, heqja e `generateAgentReply`

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Kompozuesi leftover u hoq.** Nuk ekziston më `generateAgentReply`, as `communication-instructions.ts`. `src/lib/agents/generate.ts` mbetet vetëm si ri-eksport i `agentModel`/`DEFAULT_AGENT_MODEL` për importuesit ekzistues. Hyrja live e përgjigjes është `composeProcessReply` në `orchestration/respond.ts`. `e2e/customer-journey-model.test.ts` (opt-in) thërret `composeProcessReply`. Editori dhe rruga manuale nuk u prekën.
- **Mbulimi unique i katalogut mbetet native.** Slot-et e produkteve/shërbimeve, ID e paverifikuara dhe lista e përzierë janë te `respond.test.ts` dhe `catalog-presentation.test.ts`. Testet e riparimit/konsistencës së `validateResponse` nuk u portuan te live; ato mbeten te pipeline leftover `customer-context`/`response-consistency`/`response-review`, që `composeProcessReply` nuk e thërret.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 98 teste të fokusuara (respond, catalog-presentation, conversation, interpret, communication-contract, customer-context, composite-recall; customer-journey opt-in i anashkaluar). Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: `customer-context`/`response-consistency`/`response-review`/`currentProcessOwner`; `understanding/interpret`; `customer-question.ts`; çelësa jetimë në `semantic.json`/`review.json` për testet e `generate.test.ts`.

Mbeten ende: suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, heqja e pipeline leftover të përgjigjes dhe interpretimit v3

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Pipeline leftover i përgjigjes u hoq.** Nuk ekzistojnë më `customer-context`, `response-consistency`, `response-review`, `customer-fact-reference`, `customer-question`, `customer-declared-facts`, `communication-contract`, `understanding/interpret.ts`, as `currentProcessOwner`/`applyInboundToState`. Hyrja live mbetet `processConversationMessage` → `processConversation` → `interpretCustomer`/`composeProcessReply`. Editori, katalogu (`understanding/context`/`selection`), handoff, ranking dhe rruga manuale nuk u prekën.
- **E2E u ridrejtuar te kontrata native.** `e2e/semantic-model.test.ts` (opt-in) thërret `interpretCustomer` dhe `briefingQuestion`. `e2e/response-consistency.test.ts` verifikon përgjigjen native, historinë, CAS dhe izolimin SQL, jo `validateResponse`. `e2e/r4-validation.test.ts` u hoq sepse ishte suita leftover e validatorit. 204 çelësa jetimë u hoqën nga `semantic.json`; `review.json` u hoq.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 314 teste të fokusuara (engine, understanding, interpret/respond/conversation native, process-agent-turn, ai-reaction, guidance, context, workflow-hub, entity-bridge, handoff, ranking, customer-status, grounding, retrieval, selection). Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: tipet e prezentimit `ConversationProcesses`/`ConversationRouting` në `engine.ts` dhe fusha `conversationRouting` në `AgentTurnResult` (editori i hub-it i lexon); `understanding/context` mbetet i lexuar nga katalogu/entity-bridge/handoff, por `withMessageUnderstanding` nuk vendoset nga `interpretCustomer`. Testet me lista frazash të `applyInboundToState` nuk u portuan.

Mbeten ende: suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, prezentimi native dhe leftover-et e pa lidhura me live

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Editori lexon runtime native.** `WorkflowHub`/`WorkflowContextPanel`/`MessageRoutingView` shfaqin `state.runtime` (profileMemory, instanca, fakte), jo `conversationRouting` ose `state.processes`. Editori, kartat e rrjedhave, zgjedhësi i flow-ve dhe rruga manuale e porosive mbeten. `simulateVisualWorkflow` pin-on versionet nga instancat/ofertat native.
- **U hoqën motorë leftover jo në hyrjen live.** Nuk ekzistojnë më `handoff.ts`, `customer-status.ts` (interpretuesi i vjetër), `product-order.ts`, `entity-routing.ts`, `resolve-reference.ts`, `linear-communication.ts`, as funksioni v3 `preparedRequest`. `PreparedRequest` mbetet si tip për `processPreparedRequest`. Testet me lista frazash (status porosie, WhatsApp/telefon) nuk u portuan.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 138 teste të fokusuara (hub, test-actions, prepared-request native, conversation, process-agent-turn, entity-bridge, catalog-presentation, ranking, engine, understanding, respond, ai-reaction, graph-validation). Hub-i u verifikua me markup statik, jo me seancë live në browser. Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: tipet `ConversationProcesses`/`ConversationRouting` në payload-in e prezentimit; `advanceSharedOrder`/`extractExplicitFacts` në `context.ts`; `understanding/context` lexohet nga katalogu/entity-bridge, por `interpretCustomer` nuk e vendos. `resolveProductReference` mbetet për mbulimin unique të katalogut.

Mbeten ende: suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, heqja e avancimit linear leftover

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Motori linear leftover u hoq.** Nuk ekzistojnë më `advanceSharedOrder`, `extractExplicitFacts`, `sharedPrompt`, `isQuestion`/`affirmative`, as tipet `ConversationProcesses`/`ConversationRouting`. `setFact`/`migrateContext`/`validValue` mbeten për validim fushash, parserin linear të editorit dhe kujtesën e profilit. Hyrja live mbetet `processConversationMessage` → `processConversation`. Rruga manuale e porosive (`submit_process_order`) refuzon gjendjen leftover pa schema 4.
- **Zgjedhja “tjetrin” lexon runtime ose `product_id`.** `resolveProductReference` nuk lexon më snapshot `processes.order`. Editori, katalogu (`understanding/context`/`selection`) dhe kartat e rrjedhave mbeten. Testet me lista frazash të `advanceSharedOrder` nuk u portuan.
- Verifikimi lokal i këtij slice: TypeScript kaloi; 138 teste të fokusuara (context, field-candidates, engine, linear, interpret, orders route, entity-bridge, workflow-readiness, conversation, catalog-presentation, ranking, respond, hub, prepared-request, ai-reaction). Nuk u krijua biznes/porosi/rezervim real dhe nuk u publikua.
- Leftover i identifikuar, jo i pastruar këtu: `understanding/context` lexohet nga katalogu/entity-bridge/ranking, por `interpretCustomer` nuk e vendos; `SharedContext` dhe fusha leftover (`product_id`, `visual`, `schemaVersion` 2/3) mbeten në payload; `resolveProductReference` mbetet për mbulimin unique të katalogut.

Mbeten ende: suite-a 72 episodeve; replay i plotë DB; provider-ët realë; publikimi. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**

### Përditësim — 7 nëntor 2026, suite 72, replay, provider, build

Ky përditësim ka përparësi mbi listën “Mbeten ende” sipër:

- **Suite-a 72 episodeve u ekzekutua me model real.** `e2e/episode-suite.test.ts` (opt-in `RUN_EPISODE_SUITE=1`) mbulon gjashtë konfigurime × katër gjuhë × tre përsëritje në runtime native (`interpretCustomer` + `transitionCustomer`, mënyra test). 72/72 kaluan; `e2e/process-model.test.ts` 7/7. Nuk u krijua porosi/rezervim/biznes real. Testet përdorin shembuj gjuhësorë si të dhëna, jo logjikë runtime.
- **Replay SQL i izoluar kaloi.** `node e2e/process-checkpoints.mjs` verifikoi CAS, deduplikim, lease, ownership, booking/order dhe cutover në PostgreSQL 17 të përkohshëm. Replay i plotë i baseline-it Supabase (`e2e/local.mjs up`) nuk u ekzekutua: Docker mungon në këtë makinë.
- **Provider real i modelit u përdor; kanalet live jo.** OpenAI u thirr për suite-n dhe process-model. Nuk u lidh Instagram/WhatsApp/Zana dhe nuk u ekzekutua `PROCESS_SMOKE_BUSINESS_ID` (nuk është konfiguruar). `yarn build` kaloi lokalisht (capabilities + Next.js); aplikacioni nuk u deploy-ua.
- Leftover i identifikuar: `understanding/context` ende lexohet nga katalogu; replay i plotë Supabase pret Docker; efektet live të kanaleve/providerëve të biznesit mbeten të paprovuara.

Mbeten ende: replay i plotë Supabase me Docker; prova live e kanaleve/Zana; deploy i aplikacionit. **Zëvendësimi i plotë nuk është shpallur i përfunduar.**
