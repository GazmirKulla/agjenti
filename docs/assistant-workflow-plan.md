# Menaxhimi i workflow-ve nga Agjenti

## Statusi i dorëzimit

Integrimi i workflow-t vizual nga Agjenti është i kompletuar për fazat 1–3 dhe mbylljen e fazës 5 (për workflow vizual):

- [x] Lexim/shpjegim i rrjedhës, kartë në chat, lidhje me editorin, kontekst faqje/hap
- [x] Propozime të strukturuara për draft (shto/ndrysho/hiq hapa e lidhje), para/pas, konfirmim
- [x] Simulim prove në chat, publikim, aktivizim/çaktivizim, rikthim versioni si draft
- [x] Butona në kartë: Publiko draftin, Aktivizo, Çaktivizo, Kthe si draft
- [x] Sugjerime kontekstuale në home dhe në faqen Workflows
- [x] Heqja e hyrjes së vjetër «Plotëso me AI» për seksionin workflows (BI mbetet për targete të tjera)
- [x] Ruajtje atomike përmes RPC `save_visual_workflow` dhe kontroll revision

Migrimi `supabase/migrations/20261010110000_visual_workflows.sql` ekziston në repo. Aplikimi në mjedisin e vendosur është hap operacional; pa të, chati shfaq rrjedhë të sugjeruar dhe bllokon ruajtjen/publikimin.

**Faza 4 (workflow lineare / lidhje produktesh) nuk është zbatuar.** Mos e trajto këtë dorëzim si zbatim të asaj faze.

## Qëllimi

Biznesi mund t’i kërkojë Agjentit, me tekst ose audio, të shfaqë dhe shpjegojë rrjedhën aktuale, të propozojë ndryshime, të krijojë një rrjedhë, ta provojë dhe ta publikojë pas konfirmimit. Chati dhe editori përdorin të njëjtat të dhëna dhe të njëjtin ekzekutim.

## Gjendja e verifikuar

- Actions: `workflow_load`, `workflow_read`, `workflow_draft`, `workflow_publish`, `workflow_enable`, `workflow_disable`, `workflow_restore` në `src/lib/business-assistant/`.
- Workflow-i vizual është një hapësirë për biznes, me draft, revision, version të publikuar dhe gjendje aktive/joaktive. Nuk është bibliotekë me disa workflow vizuale të pavarura.
- `src/lib/workflows/visual/actions.ts` dhe `mutations.ts` mbështesin ruajtje drafti, publikim dhe aktivizim/çaktivizim. Publikimi e aktivizon rrjedhën.
- `store.ts` dhe `execute.ts` ruajnë versionin e publikuar për bisedat vizuale në vazhdim.
- Ekzistojnë edhe `workflows` dhe `workflow_steps` për porositë e produkteve. Hapi vizual `product` përdor motorin ekzistues të porosisë; Agjenti nuk i editojnë ato hapa lineare.
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
