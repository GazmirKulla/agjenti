# Menaxhimi i workflow-ve nga Agjenti

## Statusi i dorëzimit

Integrimi në kod mbulon një qendër mesazhesh me rrjedha për porosi, rezervime të konfiguruara, informacion dhe staf. Përkufizimi vizual është v2; gjendja e bisedës është v3. Aktivizimi në prodhim mbetet hap operacional dhe nuk konfirmohet vetëm nga deployment-i:

- [x] Lexim/shpjegim i rrjedhës, kartë në chat, lidhje me editorin, kontekst faqje/hap
- [x] Propozime të strukturuara për draft (shto/ndrysho/hiq hapa e lidhje), para/pas, konfirmim
- [x] Simulim prove në chat, publikim, aktivizim/çaktivizim, rikthim versioni si draft
- [x] Butona në kartë: Publiko draftin, Aktivizo, Çaktivizo, Kthe si draft
- [x] Sugjerime kontekstuale në home dhe në faqen Workflows
- [x] Heqja e hyrjes së vjetër «Plotëso me AI» për seksionin workflows (BI mbetet për targete të tjera)
- [x] Ruajtje atomike përmes RPC-ve të përbashkëta dhe kontroll revision
- [x] Lexim/krijim/ndryshim i rrjedhave të porosive dhe lidhje me produktet
- [x] Përzgjedhje eksplicite: të gjitha produktet e lidhura ose vetëm produktet e zgjedhura
- [x] Kopje e re për çdo ndryshim të rrjedhës lineare; versioni i vjetër mbetet për porositë në proces
- [x] Snapshot i enkriptuar i hapave në gjendjen e bisedës; bisedat e vjetra lexojnë workflow_id e ruajtur nga serveri
- [x] Historik i pandryshueshëm i drafteve/publikimeve dhe i lidhjeve me produktet; konfirmime idempotente
- [x] Pamje qendrore e proceseve, hapje dhe editim i secilës rrjedhë me dorë ose përmes AI-së
- [x] Rivlerësim i çdo mesazhi; një porosi dhe një rezervim i papërfunduar ruhen dhe rifillohen me kontekstin e tyre
- [x] Profil i përbashkët, konfirmime të veçanta për çdo proces dhe orientim te stafi pa bllokuar AI-në
- [x] Kontroll i migrimeve, biznesit pilot dhe funksionimit të worker-it para publikimit/aktivizimit të grafikut v2
- [ ] Aplikim dhe verifikim i migrimeve, scheduler-it dhe pilotit në mjedisin e prodhimit

Dy migrimet e këtij dorëzimi janë `20261010213000_message_workflow_definitions.sql` (grafiku v2 dhe pajtueshmëria me v1) dhe `20261010220000_workflow_message_runtime.sql` (rezervime idempotente, kontrolli i pronësisë së bisedës dhe gatishmëria e worker-it). Ato varen nga migrimet paraprake të repos, përfshirë kalendarin, workflow-t vizualë, kontekstin e përbashkët dhe radhën e mesazheve.

Grafikët v1 dhe snapshot-et ekzistuese ruhen. Migrimet dhe testet SQL janë verifikuar në PostgreSQL 17 lokal të izoluar; ky verifikim nuk provon se migrimet ose konfigurimi operacional janë aplikuar në prodhim.

## Qëllimi

Biznesi mund t’i kërkojë Agjentit, me tekst ose audio, të shfaqë dhe shpjegojë rrjedhën aktuale, të propozojë ndryshime, të krijojë një rrjedhë, ta provojë dhe ta publikojë pas konfirmimit. Chati dhe editori përdorin të njëjtat të dhëna dhe të njëjtin ekzekutim.

## Gjendja e verifikuar

- Actions: `workflow_load`, `workflow_read`, `workflow_draft`, `workflow_publish`, `workflow_enable`, `workflow_disable`, `workflow_restore` në `src/lib/business-assistant/`.
- Workflow-i vizual është një hapësirë për biznes, me draft, revision, version të publikuar dhe gjendje aktive/joaktive. Grafiku v2 i grupon hapat në rrjedha me hyrjen e tyre; pamja qendrore hap rrjedhën për editim.
- `src/lib/workflows/visual/actions.ts` dhe `mutations.ts` mbështesin ruajtje drafti, publikim dhe aktivizim/çaktivizim. Publikimi e aktivizon rrjedhën.
- `store.ts` dhe `execute.ts` ruajnë versionin e publikuar për bisedat vizuale në vazhdim.
- Ekzistojnë edhe `workflows` dhe `workflow_steps` për porositë e produkteve. Hapi vizual `product` përdor motorin ekzistues të porosisë; Agjenti i menaxhon përmes veprimeve `orderflow_*` dhe ruajtjes atomike me kopje të re. Për pilotin, veprimet `linear_*` shtojnë draft, provë dhe publikim të veçantë.
- `processConversationMessage` bashkon rrugët e Instagram-it, provës së agjentit dhe simulimit të draftit për pilotin. Prova nuk ruan profil real, rezervim apo porosi dhe nuk dërgon mesazhe te klientët.

## Përvoja e klientit

### Shfaq dhe shpjego

Kërkesat «Më trego si punon Agjenti» kthejnë një kartë me emrin, statusin dhe hapat. Shfaqen veçmas drafti dhe versioni i publikuar. Në mobile përdoret listë vertikale me degëzime Po/Jo; diagrami i plotë hapet në editor.

### Ndrysho me bisedë

Mbështeten shtimi, ndryshimi, heqja dhe riorganizimi i hapave, pyetjet, fushat, kushtet, lidhjet dhe kalimi te stafi. Kur synimi është i paqartë, Agjenti pyet me zgjedhje konkrete.

### Rishiko, provo dhe aktivizo

Paraqiten hapat e shtuar/ndryshuar/hequr. Veprimet: Ruaj draftin, Provoje, Publiko dhe aktivizo, Aktivizo/Çaktivizo versionin e publikuar, Kthe version si draft. Ruajtja e draftit nuk ndryshon bisedat aktive. Publikimi kërkon konfirmim; nëse editori ka ndryshuar rrjedhën ndërkohë, propozimi rifreskohet.

## Kufijtë e motorit

- Hapat e mbështetur: `start`, `condition`, `knowledge`, `collect`, `confirm`, `product`, `booking`, `handoff`, `end`.
- Nyja `booking` përdor kalendarin dhe shërbimet ekzistuese të biznesit; kërkon konfigurimin dhe aktivizimin e rezervimeve. Pagesat dhe integrimet e reja kërkojnë zhvillim të veçantë. Kanalet e këtij dorëzimi janë Instagram dhe prova e izoluar.
- Kushtet e intentit janë rregulla deterministe; ndryshimi i etiketës së një kushti nuk është aftësi e re semantike.
- Nyja `product` thërret workflow-n linear të produktit; për bizneset e pilotit, `collect.fieldKey` lidhet me `customer_name`, `customer_phone`, `customer_email`, `customer_city`, `customer_address` ose një fushë të porosisë. Fushat e tjera ekzistuese nuk interpretohen si profil automatikisht.
- Kufij grafiku: 32 nyje, 64 lidhje dhe 16 rrjedha; draftet e paplota etiketohen dhe nuk publikohen.
- Autorizimi dhe modulet vijnë nga serveri; konteksti i faqes nuk jep autorizim.
- Konfirmimi lidhet me revision; kërkesat e përsëritura nuk krijojnë publikime të dyfishta. Rikthimi krijon draft të ri, nuk rishkruan historikun e versioneve.

## Faza 4 — workflow-t e produkteve

- `linear_load/read/draft/link/publish`: listim, propozim i konfirmueshëm, draft, provë dhe publikim. Zgjedhjet e sqarimit mund të shfaqen si butona.
- Drafti ruhet sipas produktit. Publikimi krijon kopje kur workflow ndahet me produkte të tjera; ndryshimi i përbashkët është zgjedhje eksplicite, me listën e produkteve të prekura.
- `save_product_workflow` kontrollon autorizimin, revision, versionet që u panë gjatë propozimit dhe produktet e prekura brenda transaksionit. Drafti nuk prek hapat aktivë apo lidhjen e produktit.
- `linear_workflow_versions` ruan definicionet e publikuara. Trigger-at krijojnë snapshot edhe për ndryshimet nga importet dhe editorët e vjetër. Bisedat në proces ruajnë hapat e tyre; migrimi vendos snapshot për porositë ekzistuese në proces.
- Prova e produktit përdor draftin e ruajtur dhe sesion të enkriptuar. Nuk ruan profil, porosi apo mesazhe reale.

## Konteksti i përbashkët

`ConversationStatePayload.schemaVersion = 3` ruan profilin e përbashkët dhe kontekstin e ekzekutimit, bashkë me një porosi dhe një rezervim të papërfunduar. Çdo proces ka gjendjen e vet (`active`, `suspended`, `completed`); pyetja në pritje i përket procesit që e bëri. Gjendjet e mëparshme përshtaten pa humbur vlerat dhe versionet e ruajtura. Fushat mbajnë vlerën, tipin, burimin dhe validimin. `customer`, `fields`, `step_key` dhe `product_id` mbeten përshtatës për Inbox dhe dërgimin ekzistues të porosisë.

- Të dhënat e etiketuara mblidhen në mënyrë deterministe; nxjerrja me AI lejon vetëm fushat e deklaruara, evidencë ekzakte nga mesazhi dhe vlera të vlefshme. Pa AI vazhdon mbledhja përmes pyetjes aktuale dhe etiketave.
- Hapat e plotësuar kapërcehen; konfirmimet mbeten eksplicite për procesin përkatës. Pyetjet informative nuk plotësojnë fushën aktuale; të dhënat e qarta në të njëjtin mesazh ruhen. Korrigjimet zhvlerësojnë konfirmimin që prekin.
- `conversation_profiles` mban kujtesën sipas biznesit/pjesëmarrësit Instagram, me lidhjen e integrimit për fshirje. Nuk krijon klient CRM dhe nuk bashkon identitete nga emri apo telefoni.
- Porosia e re ruan profilin, kërkon konfirmim të përmbledhur dhe pastron variante, foto e konfirmime të vjetra.
- Pas konfirmimit final shënohet `order_ready`; endpoint-i ekzistues i stafit kërkon konfirmimin për state v2/v3. Asistenti nuk krijon/dërgon porosi vetë. Rezervimi ndjek konfirmimin dhe rregullat ekzistuese të kalendarit, me mbrojtje nga krijimi i dyfishtë gjatë riprovimit.

## Radhitja dhe rikuperimi

Webhook-u ruan mesazhet e pilotit para përgjigjes HTTP. Çelësi unik është lidhja Instagram + ID e mesazhit. Worker-i merr mesazhin më të vjetër të papërfunduar për pjesëmarrësin, me lease dhe token; `prepare_workflow_reply` ruan bashkë state-in me revision, profilin dhe përgjigjen për dërgim.

Përgjigjja e ruajtur mund të dërgohet pa ekzekutuar sërish workflow-n. Një dërgim me rezultat të paqartë nuk përsëritet automatikisht: biseda ndalet për stafin. Gabimet para dërgimit riprovohen deri në tre herë. Webhook-u nis worker-in menjëherë pas ruajtjes së mesazheve. `/api/cron/workflow-inbound` kërkon `CRON_SECRET`; në konfigurimin bazë ekzekutohet një herë në ditë (`0 5 * * *`, UTC), për pajtueshmëri me Vercel Hobby. Ky ekzekutim është rikuperim rezervë: pa mesazh të ri, puna e mbetur ose riprovimi mund të presë deri në ekzekutimin e ditës tjetër.

Për pilotin kërkohet rikuperim çdo minutë në Supabase përmes `pg_cron` dhe `pg_net`. Skripti `supabase/operations/workflow-worker-schedule.sql` krijon job-in `agjenti-workflow-inbound` me orarin `* * * * *`, duke lexuar adresën dhe sekretin nga Vault. Ai thërret `GET /api/cron/workflow-inbound` me autorizimin e worker-it. Ky konfigurim funksionon pa ndryshuar orarin ditor të Vercel Hobby.

Publikimi/aktivizimi v2 kërkon job-in e mësipërm aktiv dhe një përfundim të suksesshëm të worker-it brenda tre minutave të fundit. Vetëm një scheduler tjetër ose fallback-u ditor nuk e plotëson kontrollin aktual. Worker-i regjistron funksionimin edhe kur radha është bosh.

## Aktivizimi i pilotit

1. Kontrollo historikun e migrimeve në Supabase dhe apliko vetëm ato që mungojnë, në rend kronologjik. Përveç varësive ekzistuese, kërkohen `20261010143000_shared_workflow_context.sql`, `20261010150000_workflow_inbound_queue.sql`, **`20261010213000_message_workflow_definitions.sql`** dhe **`20261010220000_workflow_message_runtime.sql`**. Mos riekzekuto verbërisht migrimet e vjetra.
2. Në deployment-in e prodhimit vendos `SHARED_WORKFLOW_BUSINESS_IDS` me UUID-në e biznesit pilot dhe `CRON_SECRET`; verifiko konfigurimet ekzistuese AI/enkriptim dhe bëj redeploy që të lexohen vlerat e reja. Bizneset jashtë listës mbajnë rrugën e vjetër të përpunimit.
3. Në Supabase Vault krijo `agjenti_app_url` me origjinën përfundimtare HTTPS të prodhimit (p.sh. `https://www.agjenti.app`, pa path ose ridrejtim) dhe `agjenti_cron_secret` me të njëjtën vlerë si `CRON_SECRET`. Kontrollo që adresa e worker-it nuk kthen `301`/`302`/`307`/`308`: ridrejtimi në një host tjetër mund të heqë header-in `Authorization` dhe të shkaktojë `401` edhe kur sekretet përputhen. Mos vendos vlerat e sekreteve në repo, migrime ose log-e.
4. Ekzekuto `supabase/operations/workflow-worker-schedule.sql`; ai aktivizon `pg_cron`/`pg_net` dhe planifikon job-in. Pas ekzekutimit të parë të suksesshëm, `select public.workflow_runtime_readiness();` duhet të japë `schemaVersion: 3`, `scheduled: true` dhe `lastSuccessAt` brenda tre minutave. Nëse jo, kontrollo job-in dhe përgjigjen HTTP të thirrjes së tij.
5. Ruaj dhe provo draftin: porosi → rezervim → informacion → rifillim porosie, “fola në WhatsApp, dua të porosis”, disa fusha/foto në një mesazh, korrigjim dhe klient që rikthehet. Për rezervime kontrollo edhe shërbimet dhe oraret e aktivizuara. Drafti/prova lejohen para gatishmërisë; publikimi dhe aktivizimi v2 bllokohen derisa kontrolli të kalojë.
6. Publiko nga ndërfaqja pas shqyrtimit. Verifiko një bisedë reale të kontrolluar, versionet e ruajtura dhe që porosia dërgohet vetëm nga veprimi ekzistues i stafit. Monitoro radhën dhe bisedat e ndalura përpara zgjerimit të pilotit.

Për ndalim operacional: ndal auto-reply të biznesit, lër worker-in të përfundojë ose klasifikojë punët në radhë dhe verifiko dërgimet e paqarta. Mos hiq konfigurimin e pilotit ndërsa ka punë të papërfunduara. Ruaj pajtueshmërinë me state v2/v3 dhe grafikët e versionuar; mos rikthe një version aplikacioni që nuk i lexon ato. Mos fshi snapshot-et ose kujtesën për të rikthyer konfigurimin.

### Monitorim pa përmbajtjen e mesazheve

```sql
select public.workflow_runtime_readiness();

select business_id, status, count(*), min(created_at) as oldest
from workflow_inbound_queue
where created_at > now() - interval '24 hours'
group by business_id, status;

select business_id, conversation_id, step_key, updated_at,
       collected #> '{context,execution,promptCounts}' as prompts_per_step,
       collected #> '{context,execution,validationFailures}' as validation_failures,
       collected #> '{context,execution,skipped}' as reused_steps
from conversation_states
where collected->>'schemaVersion' in ('2', '3');
```

Numërimi i pyetjeve për hap përfshin edhe përsëritjet legjitime pas përgjigjeve të pavlefshme ose korrigjimeve. Një bisedë e vjetër në pritje nuk provon vetë ngecje; krahaso mesazhin e fundit dhe statusin e radhës. `uncertain` dhe `failed` kërkojnë shqyrtim nga stafi.

### Verifikimi lokal

Testet e aplikacionit mbulojnë state-in, nxjerrjen me evidencë, kujtesën, propozimet, versionet dhe rikuperimin e dërgimit. `supabase/tests/shared_workflow_context.sql`, `message_workflow_definitions.sql` dhe `workflow_message_runtime.sql` verifikojnë autorizimin, versionet, revision, grafikun v2, commit-in atomik, rendin, lease-et, kontrollin e pronësisë, rezervimet idempotente dhe dërgimet e paqarta. Të gjitha migrimet u provuan në PostgreSQL 17 lokal të përkohshëm; kjo nuk vërteton konfigurimin e hostimit apo lidhjen reale Instagram.

## Kriteret e pranimit (faza 1–3 / 5)

- «Më trego workflow-n» paraqet konfigurimin dhe statusin real, edhe kur drafti ndryshon nga versioni aktiv.
- «Shto telefonin para konfirmimit» ndryshon rrjedhën e synuar pa pyetje të dyfishta dhe pa humbur degëzimet.
- Kërkesat e paqarta prodhojnë zgjedhje për sqarim.
- Refuzimi i propozimit nuk bën asnjë shkrim. Ruajtja e draftit nuk publikon.
- Prova e draftit nuk dërgon mesazhe te klientët.
- Publikimi nuk ndërpret bisedat ekzistuese vizuale; bisedat e reja përdorin versionin e ri.
- Ndryshimet paralele nga editori bllokojnë konfirmimin e vjetruar.
- «Plotëso me AI» nuk shfaqet më në faqen Workflows.


## Verifikimi i këtij dorëzimi

- Kontrolli i versionit `f1d850b` përfundoi me 758 teste të aplikacionit dhe build të suksesshëm.
- Migrimet dhe suitët SQL përkatëse kaluan në PostgreSQL 17 lokal të izoluar, përfshirë përkufizimin v2 dhe ekzekutimin e ri.
- Testet mbulojnë rifillimin pas orientimit te stafi, ndërrimin porosi/rezervim, konfirmimet dhe kufizimet e provës. Marrja manuale e bisedës nga stafi mbetet ndalim për AI-në.
- Aplikimi i migrimeve dhe verifikimi i scheduler-it/Instagram-it në prodhim mbeten hapa operacionalë të pakonfirmuar në këtë dokument.


## Rrjedha sugjeruese dhe kthimi pas

Ekzekutimi rishikon kërkesën e klientit duke përdorur procesin dhe hapin aktual, vlerat e ruajtura dhe historikun e kufizuar të bisedës. Ky kontekst ruhet brenda gjendjes së bisedës dhe sesionit të provës; fshirja ekzistuese e bisedës e përfshin edhe atë.

- “Fola me stafin, dua të porosis” rihap rrugën e porosisë. Përmendja e kontaktit të mëparshëm nuk interpretohet si kërkesë e re për staf.
- “Kthehu pas” dhe korrigjimet mund të rihapin një hap të kaluar. Vlerat ruhen derisa klienti t'i zëvendësojë; konfirmimi final zhvlerësohet dhe kërkohet përsëri.
- Pyetjet informative marrin përgjigje pa u regjistruar si përgjigje të hapit. Më pas biseda vazhdon nga e njëjta pikë.
- AI zgjedh vetëm navigim të lejuar: vazhdim, pyetje informative, korrigjim në hap ekzistues, porosi, ndihmë ose sqarim. Nuk mund të shënojë vetë përfundim, të konfirmojë porosi, të krijojë aftësi të reja apo të anashkalojë validimin. Vendimet e paqarta dhe gabimet e ofruesit përdorin rregullat lokale ose kërkojnë sqarim.
- Nyja vizuale `handoff` është orientim te stafi dhe ruhet si `advisory`; nuk çaktivizon përgjigjet automatike. Kjo vlen edhe në editor dhe në provën brenda asistentit. Pauzat manuale dhe dërgimet e paqarta ruajnë ndalimin ekzistues. Mungesa e konfigurimit të produktit shpjegohet pa bllokuar një kërkesë të re për një produkt tjetër.

Bisedat që ishin tashmë `paused` nga versioni i vjetër nuk riaktivizohen automatikisht. Stafi duhet t'i rifillojë përpara se të marrin përgjigje të reja. Versioni ekzistues ruhet gjatë korrigjimeve; një porosi e re pas përfundimit përdor versionin e fundit të publikuar.


### Mesazhi si qendër e navigimit

Çdo mesazh vlerësohet përpara cursor-it të ruajtur, përfshirë hapat e produktit dhe gjendjet handoff/completed. Vlerësimi merr të gjithë hapat bisedorë të versionit të biznesit, jo vetëm hapat e vizituar. Përputhjet e qarta trajtohen nga rregulla lokale; kërkesat e tjera vlerësohen nga AI me kontekstin e bisedës.

Në grafikun v2 kërkesa hyn nga hapi hyrës i rrjedhës përkatëse, duke respektuar hapat e konfiguruar para produktit ose rezervimit. Në v1 ruhet pajtueshmëria me navigimin ekzistues. Ndërrimi i procesit pezullon punën e papërfunduar dhe rifillimi e rikthen me vlerat e saj. Ndërrimi i produktit gjatë një porosie kërkon sqarimin për zëvendësim; profili ruhet dhe të dhënat specifike nuk transferohen verbërisht. Rifillimi nuk regjistrohet si përgjigje e hapit në pritje.

Hapat linearë mund të mblidhen jashtë radhës. Para se porosia të përfundojë, kontrollohen edhe hapat e kërkuar që mbetën pas; ndryshimi i rrugës nuk përbën plotësim ose konfirmim. Gjurma e provës përfshin vendimin dhe destinacionin për çdo mesazh. Pamja e provës paraqet mesazhin në qendër dhe grupet e rrjedhave rreth tij; pozicionet e ruajtura të editorit nuk ndryshojnë.

### Chat-i i provës

Chat-i ka një hapësirë qendrore për mesazhet dhe panele opsionale për historikun dhe rrjedhën. Mbështet Enter/Shift+Enter, kopjim, formatim teksti/kodi, redaktim, rigjenerim, eksport tekst, riemërtim/fshirje bisedash, pamje të zgjeruar dhe lexim me zë kur shfletuesi e mbështet. Leximi përdor zërat e pajisjes; disponueshmëria e shqipes varet prej saj.

Redaktimi dhe rigjenerimi krijojnë version të ri nga checkpoint-i përpara mesazhit. Origjinali ruhet në historik. Historiku mban deri në 8 biseda në `sessionStorage`, i ndarë sipas përdoruesit dhe biznesit; nuk sinkronizohet mes pajisjeve dhe pastrohet kur mbyllet skeda. Checkpoint-et e serverit skadojnë pas një ore. Eksporti nuk përmban token-et e sesionit. “Ndalo pritjen” injoron rezultatin e vonuar dhe anulon ngarkimet në proces; një thirrje AI e nisur në server mund të përfundojë.

Bashkëngjitjet reale mbështesin JPG/PNG/WEBP/PDF/TXT/MD/CSV/JSON, deri në 3 skedarë për mesazh dhe 3 MB për skedar. PDF/fotot lexohen përmes AI; dokumentet tekst kufizohen në 16,000 karaktere. Konteksti i enkriptuar ruan fragmente të 3 skedarëve të fundit (deri në 6 KB secili), jo përmbajtjen binare. Fragmentet janë të dhëna të paverifikuara të klientit; nuk përdoren për mbushje automatike të profilit. Endpoint-i kontrollon origjinën, anëtarësinë, madhësinë dhe llojin e skedarit. Diktimi përdor regjistruesin ekzistues deri në 2 minuta dhe e kthen audion në draft të redaktueshëm, pa e dërguar automatikisht.

Nuk kërkohet migrim Supabase për këtë ndërfaqe. Përdoren konfigurimet ekzistuese `TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `AGENT_MODEL` dhe modeli ekzistues i transkriptimit. Përgjigjja shfaqet pasi përfundon ekzekutimi i workflow-t; nuk ka streaming të token-ëve ose bisedë zanore në kohë reale.
