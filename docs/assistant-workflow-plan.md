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

## Qëllimi

Biznesi mund t’i kërkojë Agjentit, me tekst ose audio, të shfaqë dhe shpjegojë rrjedhën aktuale, të propozojë ndryshime, të krijojë një rrjedhë, ta provojë dhe ta publikojë pas konfirmimit. Chati dhe editori përdorin të njëjtat të dhëna dhe të njëjtin ekzekutim.

## Gjendja e verifikuar

- Actions: `workflow_load`, `workflow_read`, `workflow_draft`, `workflow_publish`, `workflow_enable`, `workflow_disable`, `workflow_restore` në `src/lib/business-assistant/`.
- Workflow-i vizual është një hapësirë për biznes, me draft, revision, version të publikuar dhe gjendje aktive/joaktive. Nuk është bibliotekë me disa workflow vizuale të pavarura.
- `src/lib/workflows/visual/actions.ts` dhe `mutations.ts` mbështesin ruajtje drafti, publikim dhe aktivizim/çaktivizim. Publikimi e aktivizon rrjedhën.
- `store.ts` dhe `execute.ts` ruajnë versionin e publikuar për bisedat vizuale në vazhdim.
- Ekzistojnë edhe `workflows` dhe `workflow_steps` për porositë e produkteve. Hapi vizual `product` përdor motorin ekzistues të porosisë; Agjenti i menaxhon përmes veprimeve `orderflow_*` dhe ruajtjes atomike me kopje të re.
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
- Nyja `product` thërret workflow-n linear të produktit; ndryshimi i hapave `collect` në grafikun vizual **nuk** ndryshon fushat e porosisë / klientit.
- Kufij grafiku: 32 nyje, 64 lidhje; draftet e paplota etiketohen dhe nuk publikohen.
- Autorizimi dhe modulet vijnë nga serveri; konteksti i faqes nuk jep autorizim.
- Konfirmimi lidhet me revision; kërkesat e përsëritura nuk krijojnë publikime të dyfishta. Rikthimi krijon draft të ri, nuk rishkruan historikun e versioneve.

## Faza 4 — e ardhshme (jo e zbatuar)

1. Lexim/listim i `workflows` / `workflow_steps` lineare dhe lidhjeve me produktet.
2. Propozime të konfirmueshme për ndryshim hapash lineare dhe caktim `products.workflow_id`.
3. Kur një workflow ndahet nga disa produkte: trego produktet e prekura; ofro kopje për produktin e kërkuar.
4. Para aktivizimit: ruajtje atomike, kontroll versioni, vazhdimësi e porosive në proces.
5. Validim fushash kundrejt motorit real (`engine.ts`); mos pretendo që edit vizual = fusha porosie.
6. Historik i plotë i ndryshimeve të drafteve (përtej listës së versioneve të publikuara).

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
