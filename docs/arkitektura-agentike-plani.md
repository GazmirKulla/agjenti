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
