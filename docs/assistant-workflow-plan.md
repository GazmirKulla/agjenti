# Menaxhimi i workflow-ve nga Agjenti

## Statusi i dorëzimit

Integrimi në kod mbulon workflow-n vizual dhe rrjedhat lineare të porosive. Aktivizimi në databazën e vendosur mbetet hap operacional:

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

Migrimi `supabase/migrations/20261010110000_visual_workflows.sql` ekziston në repo. Aplikimi në mjedisin e vendosur është hap operacional; pa të, chati shfaq rrjedhë të sugjeruar dhe bllokon ruajtjen/publikimin.

Faza 4 është implementuar për hapat që motori ekzekuton sot: text, choice, photo, confirm, customer. Hapi customer mbetet i fundit dhe mbledh emër/telefon/qytet/adresë. Nuk shtohen lloje të reja veprimesh si pagesa apo rezervime brenda grafikut.

Migrimet e kërkuara, sipas rendit: `20261010110000_visual_workflows.sql`, `20261010130000_assistant_orderflows.sql`, `20261010140000_visual_workflow_history.sql`. Migrimet e reja janë verifikuar në PostgreSQL lokal të izoluar (PGlite); nuk janë aplikuar në databazën e prodhimit. Pa to leximi vazhdon, ndërsa ruajtja shfaq kufizimin real. Nuk u gjet CLI/lidhje SQL e konfiguruar për aplikim në databazën e vendosur. Kontrolli i fundit vetëm për lexim konfirmoi se `visual_workflows` tashmë ekziston, ndërsa `assistant_workflow_changes` dhe `visual_workflow_events` mungojnë: mbeten për aplikim dy migrimet e reja 130000 dhe 140000.

**Faza 4 dhe konteksti i përbashkët janë zbatuar në kod, me aktivizim për biznes pilot.** Duhet të aplikohen migrimet e reja dhe të vendoset `SHARED_WORKFLOW_BUSINESS_IDS` para përdorimit real. Nuk është kryer aktivizim në production nga ky ndryshim.

## Qëllimi

Biznesi mund t’i kërkojë Agjentit, me tekst ose audio, të shfaqë dhe shpjegojë rrjedhën aktuale, të propozojë ndryshime, të krijojë një rrjedhë, ta provojë dhe ta publikojë pas konfirmimit. Chati dhe editori përdorin të njëjtat të dhëna dhe të njëjtin ekzekutim.

## Gjendja e verifikuar

- Actions: `workflow_load`, `workflow_read`, `workflow_draft`, `workflow_publish`, `workflow_enable`, `workflow_disable`, `workflow_restore` në `src/lib/business-assistant/`.
- Workflow-i vizual është një hapësirë për biznes, me draft, revision, version të publikuar dhe gjendje aktive/joaktive. Nuk është bibliotekë me disa workflow vizuale të pavarura.
- `src/lib/workflows/visual/actions.ts` dhe `mutations.ts` mbështesin ruajtje drafti, publikim dhe aktivizim/çaktivizim. Publikimi e aktivizon rrjedhën.
- `store.ts` dhe `execute.ts` ruajnë versionin e publikuar për bisedat vizuale në vazhdim.
- Ekzistojnë edhe `workflows` dhe `workflow_steps` për porositë e produkteve. Hapi vizual `product` përdor motorin ekzistues të porosisë; Agjenti i menaxhon përmes veprimeve `orderflow_*` dhe ruajtjes atomike me kopje të re. Për pilotin, veprimet `linear_*` shtojnë draft, provë dhe publikim të veçantë.
- `simulateVisualWorkflow` përdor motorin real në modalitet prove.

## Përvoja e klientit

### Shfaq dhe shpjego

Kërkesat «Më trego si punon Agjenti» kthejnë një kartë me emrin, statusin dhe hapat. Shfaqen veçmas drafti dhe versioni i publikuar. Në mobile përdoret listë vertikale me degëzime Po/Jo; diagrami i plotë hapet në editor.

### Ndrysho me bisedë

Mbështeten shtimi, ndryshimi, heqja dhe riorganizimi i hapave, pyetjet, fushat, kushtet, lidhjet dhe kalimi te stafi. Kur synimi është i paqartë, Agjenti pyet me zgjedhje konkrete.

### Rishiko, provo dhe aktivizo

Paraqiten hapat e shtuar/ndryshuar/hequr. Veprimet: Ruaj draftin, Provoje, Publiko dhe aktivizo, Aktivizo/Çaktivizo versionin e publikuar, Kthe version si draft. Ruajtja e draftit nuk ndryshon bisedat aktive. Publikimi kërkon konfirmim; nëse editori ka ndryshuar rrjedhën ndërkohë, propozimi rifreskohet.

## Kufijtë e motorit

- Hapat e mbështetur: `start`, `condition`, `knowledge`, `collect`, `confirm`, `product`, `handoff`, `end`.
- Nuk ka pagesa, rezervime apo nyja ekzekutuese të reja brenda grafikut pa zhvillim të veçantë të motorit.
- Kushtet e intentit janë rregulla deterministe; ndryshimi i etiketës së një kushti nuk është aftësi e re semantike.
- Nyja `product` thërret workflow-n linear të produktit; për bizneset e pilotit, `collect.fieldKey` lidhet me `customer_name`, `customer_phone`, `customer_email`, `customer_city`, `customer_address` ose një fushë të porosisë. Fushat e tjera ekzistuese nuk interpretohen si profil automatikisht.
- Kufij grafiku: 32 nyje, 64 lidhje; draftet e paplota etiketohen dhe nuk publikohen.
- Autorizimi dhe modulet vijnë nga serveri; konteksti i faqes nuk jep autorizim.
- Konfirmimi lidhet me revision; kërkesat e përsëritura nuk krijojnë publikime të dyfishta. Rikthimi krijon draft të ri, nuk rishkruan historikun e versioneve.

## Faza 4 — workflow-t e produkteve

- `linear_load/read/draft/link/publish`: listim, propozim i konfirmueshëm, draft, provë dhe publikim. Zgjedhjet e sqarimit mund të shfaqen si butona.
- Drafti ruhet sipas produktit. Publikimi krijon kopje kur workflow ndahet me produkte të tjera; ndryshimi i përbashkët është zgjedhje eksplicite, me listën e produkteve të prekura.
- `save_product_workflow` kontrollon autorizimin, revision, versionet që u panë gjatë propozimit dhe produktet e prekura brenda transaksionit. Drafti nuk prek hapat aktivë apo lidhjen e produktit.
- `linear_workflow_versions` ruan definicionet e publikuara. Trigger-at krijojnë snapshot edhe për ndryshimet nga importet dhe editorët e vjetër. Bisedat në proces ruajnë hapat e tyre; migrimi vendos snapshot për porositë ekzistuese në proces.
- Prova e produktit përdor draftin e ruajtur dhe sesion të enkriptuar. Nuk ruan profil, porosi apo mesazhe reale.

## Konteksti i përbashkët

`ConversationStatePayload.schemaVersion = 2` shton `context.profile`, `context.order` dhe `context.execution`. Fushat mbajnë vlerën, tipin, burimin dhe validimin. `customer`, `fields`, `step_key` dhe `product_id` mbeten përshtatës për Inbox dhe dërgimin ekzistues të porosisë.

- Të dhënat e etiketuara mblidhen në mënyrë deterministe; nxjerrja me AI lejon vetëm fushat e deklaruara, evidencë ekzakte nga mesazhi dhe vlera të vlefshme. Pa AI vazhdon mbledhja përmes pyetjes aktuale dhe etiketave.
- Hapat e plotësuar kapërcehen; konfirmimet mbeten eksplicite. Pyetjet informative nuk plotësojnë fushën aktuale. Korrigjimet zhvlerësojnë konfirmimin përfundimtar.
- `conversation_profiles` mban kujtesën sipas biznesit/pjesëmarrësit Instagram, me lidhjen e integrimit për fshirje. Nuk krijon klient CRM dhe nuk bashkon identitete nga emri apo telefoni.
- Porosia e re ruan profilin, kërkon konfirmim të përmbledhur dhe pastron variante, foto e konfirmime të vjetra.
- Pas konfirmimit final shënohet `order_ready`; endpoint-i ekzistues i stafit kërkon konfirmimin kur state është v2. Asistenti nuk krijon/dërgon porosi vetë.

## Radhitja dhe rikuperimi

Webhook-u ruan mesazhet e pilotit para përgjigjes HTTP. Çelësi unik është lidhja Instagram + ID e mesazhit. Worker-i merr mesazhin më të vjetër të papërfunduar për pjesëmarrësin, me lease dhe token; `prepare_workflow_reply` ruan bashkë state-in me revision, profilin dhe përgjigjen për dërgim.

Përgjigjja e ruajtur mund të dërgohet pa ekzekutuar sërish workflow-n. Një dërgim me rezultat të paqartë nuk përsëritet automatikisht: biseda ndalet për stafin. Gabimet para dërgimit riprovohen deri në tre herë. Webhook-u nis worker-in menjëherë pas ruajtjes së mesazheve. `/api/cron/workflow-inbound` kërkon `CRON_SECRET`; në konfigurimin bazë ekzekutohet një herë në ditë (`0 5 * * *`, UTC), për pajtueshmëri me Vercel Hobby. Ky ekzekutim është rikuperim rezervë: pa mesazh të ri, puna e mbetur ose riprovimi mund të presë deri në ekzekutimin e ditës tjetër.

Për pilotin real kërkohet rikuperim çdo minutë: në Vercel Pro ndrysho vetëm orarin e këtij endpoint-i në `* * * * *`, ose konfiguro një scheduler të jashtëm që thërret `GET /api/cron/workflow-inbound` çdo minutë me `Authorization: Bearer <CRON_SECRET>`. Mos ruaj sekretin në repo. Orari çdo minutë në `vercel.json` bllokon deployment-in në Vercel Hobby; nuk duhet aktivizuar aty pa planin përkatës.

## Aktivizimi i pilotit

1. Apliko migrimet `20261010143000_shared_workflow_context.sql` dhe `20261010150000_workflow_inbound_queue.sql` pas migrimeve ekzistuese.
2. Vendos `SHARED_WORKFLOW_BUSINESS_IDS` me UUID-në e biznesit pilot; bosh e lë sjelljen e vjetër për bizneset pa state v2. Verifiko `CRON_SECRET`, konfigurimin AI dhe worker-in e planifikuar.
3. Provo draftin: telefon përpara porosisë, disa fusha në një mesazh, korrigjim, klient që rikthehet, publikim gjatë porosisë dhe kalim te stafi.
4. Publiko draftet me konfirmim nga ndërfaqja. Verifiko një bisedë reale të kontrolluar dhe që vetëm stafi dërgon porosinë.
5. Monitoro radhën dhe bisedat e ndalura para zgjerimit të listës së bizneseve.

Për ndalim operacional: ndal auto-reply të biznesit, lër worker-in të përfundojë ose klasifikojë punët në radhë dhe verifiko dërgimet e paqarta. Mos hiq konfigurimin e pilotit ndërsa ka punë të papërfunduara; bisedat me state v2 vazhdojnë ta përdorin atë format. Mos fshi snapshot-et ose kujtesën për të rikthyer konfigurimin.

### Monitorim pa përmbajtjen e mesazheve

```sql
select business_id, status, count(*), min(created_at) as oldest
from workflow_inbound_queue
where created_at > now() - interval '24 hours'
group by business_id, status;

select business_id, conversation_id, step_key, updated_at,
       collected #> '{context,execution,promptCounts}' as prompts_per_step,
       collected #> '{context,execution,validationFailures}' as validation_failures,
       collected #> '{context,execution,skipped}' as reused_steps
from conversation_states
where collected->>'schemaVersion' = '2';
```

Numërimi i pyetjeve për hap përfshin edhe përsëritjet legjitime pas përgjigjeve të pavlefshme ose korrigjimeve. Një bisedë e vjetër në pritje nuk provon vetë ngecje; krahaso mesazhin e fundit dhe statusin e radhës. `uncertain` dhe `failed` kërkojnë shqyrtim nga stafi.

### Verifikimi lokal

Testet e aplikacionit mbulojnë state-in, nxjerrjen me evidencë, kujtesën, propozimet, versionet dhe rikuperimin e dërgimit. `supabase/tests/shared_workflow_context.sql` verifikon në PostgreSQL autorizimin, kopjen për produktin, versionet, revision, commit-in atomik, rendin, lease-et dhe dërgimet e paqarta. Të gjitha migrimet u provuan në një PostgreSQL lokal të përkohshëm; kjo nuk vërteton konfigurimin e hostimit apo lidhjen reale Instagram.

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

- 192 teste kaluan për Agjentin, API-në, workflow-t, motorin e bisedës dhe përgjigjet e Agjentit; TypeScript dhe lint pa gabime në ndryshimet përkatëse.
- Dy suitët e reja SQL kaluan në PostgreSQL lokal të izoluar (PGlite): izolim biznesi, ruajtje atomike, ruajtje e përkufizimeve të vjetra, replay idempotent, konflikte, validim dhe auditim i editorit/Agjentit.
- Në shfletues u verifikua leximi i rrjedhave dhe propozimi i një workflow të ri me dy hapa; korrigjimi i emrit mbajti të njëjtët hapa. Propozimi u anulua, pa shkrime në të dhënat reale.
- Simulimi real në chat u provua me “Dua të flas me stafin”; ktheu mesazhin e handoff-it dhe ndaloi hyrjen e provës pa dërguar mesazhe reale.
- Publikimi/ruajtja në databazën e vendosur nuk u krye: kërkohen dy migrimet e reja. Implementimi nuk paraqitet si plotësisht aktiv përpara këtij hapi.


## Rrjedha sugjeruese dhe kthimi pas

Ekzekutimi rishikon kërkesën e klientit duke përdorur hapin aktual, vlerat e ruajtura dhe deri në 10 mesazhet e fundit (1,200 karaktere secili). Mesazhet ruhen brenda gjendjes së bisedës dhe sesionit të provës; nuk shtohet tabelë ose migrim i ri. Fshirja ekzistuese e bisedës fshin edhe këtë kontekst.

- “Fola me stafin, dua të porosis” rihap rrugën e porosisë. Përmendja e kontaktit të mëparshëm nuk interpretohet si kërkesë e re për staf.
- “Kthehu pas” dhe korrigjimet mund të rihapin një hap të kaluar. Vlerat ruhen derisa klienti t'i zëvendësojë; konfirmimi final zhvlerësohet dhe kërkohet përsëri.
- Pyetjet informative marrin përgjigje pa u regjistruar si përgjigje të hapit. Më pas biseda vazhdon nga e njëjta pikë.
- AI zgjedh vetëm navigim të lejuar: vazhdim, pyetje informative, korrigjim në hap ekzistues, porosi, ndihmë ose sqarim. Nuk mund të shënojë vetë përfundim, të konfirmojë porosi, të krijojë aftësi të reja apo të anashkalojë validimin. Vendimet e paqarta dhe gabimet e ofruesit përdorin rregullat lokale ose kërkojnë sqarim.
- Nyja vizuale `handoff` është orientim te stafi dhe ruhet si `advisory`; nuk çaktivizon përgjigjet automatike. Kjo vlen edhe në editor dhe në provën brenda asistentit. Pauzat manuale dhe dërgimet e paqarta ruajnë ndalimin ekzistues. Mungesa e konfigurimit të produktit shpjegohet pa bllokuar një kërkesë të re për një produkt tjetër.

Bisedat që ishin tashmë `paused` nga versioni i vjetër nuk riaktivizohen automatikisht. Stafi duhet t'i rifillojë përpara se të marrin përgjigje të reja. Versioni ekzistues ruhet gjatë korrigjimeve; një porosi e re pas përfundimit përdor versionin e fundit të publikuar.


### Mesazhi si qendër e navigimit

Çdo mesazh vlerësohet përpara cursor-it të ruajtur, përfshirë hapat e produktit dhe gjendjet handoff/completed. Vlerësimi merr të gjithë hapat bisedorë të versionit të biznesit, jo vetëm hapat e vizituar. Përputhjet e qarta trajtohen nga rregulla lokale; kërkesat e tjera vlerësohen nga AI me kontekstin e bisedës.

Kërkesa për porosi shkon drejtpërdrejt te nyja product përkatëse, pa kaluar sërish nga kushte të vjetra si kanali WhatsApp. Nëse ka disa nyje produkti dhe qëllimi është i paqartë, kërkohet zgjedhje. Një kërkesë e re për produkt tjetër ruan profilin, por pastron variantet e produktit të mëparshëm. Rifillimi i porosisë nuk regjistrohet si vlerë e hapit në pritje.

Hapat linearë mund të mblidhen jashtë radhës. Para se porosia të përfundojë, kontrollohen edhe hapat e kërkuar që mbetën pas; ndryshimi i rrugës nuk përbën plotësim ose konfirmim. Gjurma e provës përfshin vendimin dhe destinacionin për çdo mesazh. Pamja e provës paraqet mesazhin në qendër dhe grupet e rrjedhave rreth tij; pozicionet e ruajtura të editorit nuk ndryshojnë.

### Chat-i i provës

Chat-i ka një hapësirë qendrore për mesazhet dhe panele opsionale për historikun dhe rrjedhën. Mbështet Enter/Shift+Enter, kopjim, formatim teksti/kodi, redaktim, rigjenerim, eksport tekst, riemërtim/fshirje bisedash, pamje të zgjeruar dhe lexim me zë kur shfletuesi e mbështet. Leximi përdor zërat e pajisjes; disponueshmëria e shqipes varet prej saj.

Redaktimi dhe rigjenerimi krijojnë version të ri nga checkpoint-i përpara mesazhit. Origjinali ruhet në historik. Historiku mban deri në 8 biseda në `sessionStorage`, i ndarë sipas përdoruesit dhe biznesit; nuk sinkronizohet mes pajisjeve dhe pastrohet kur mbyllet skeda. Checkpoint-et e serverit skadojnë pas një ore. Eksporti nuk përmban token-et e sesionit. “Ndalo pritjen” injoron rezultatin e vonuar dhe anulon ngarkimet në proces; një thirrje AI e nisur në server mund të përfundojë.

Bashkëngjitjet reale mbështesin JPG/PNG/WEBP/PDF/TXT/MD/CSV/JSON, deri në 3 skedarë për mesazh dhe 3 MB për skedar. PDF/fotot lexohen përmes AI; dokumentet tekst kufizohen në 16,000 karaktere. Konteksti i enkriptuar ruan fragmente të 3 skedarëve të fundit (deri në 6 KB secili), jo përmbajtjen binare. Fragmentet janë të dhëna të paverifikuara të klientit; nuk përdoren për mbushje automatike të profilit. Endpoint-i kontrollon origjinën, anëtarësinë, madhësinë dhe llojin e skedarit. Diktimi përdor regjistruesin ekzistues deri në 2 minuta dhe e kthen audion në draft të redaktueshëm, pa e dërguar automatikisht.

Nuk kërkohet migrim Supabase për këtë ndërfaqe. Përdoren konfigurimet ekzistuese `TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `AGENT_MODEL` dhe modeli ekzistues i transkriptimit. Përgjigjja shfaqet pasi përfundon ekzekutimi i workflow-t; nuk ka streaming të token-ëve ose bisedë zanore në kohë reale.
