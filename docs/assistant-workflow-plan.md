# Menaxhimi i workflow-ve nga Agjenti

Status: integrimi i workflow-t vizual është implementuar në kod: shfaqje, modifikim drafti, rishikim para/pas, sqarime dhe përmirësim i propozimit, simulim në chat, publikim, aktivizim/çaktivizim dhe rikthim i një versioni si draft. Ruajtja përdor RPC-në ekzistuese dhe kontrollin atomik të revision.

Verifikimi i mjedisit më 10 tetor 2026 tregoi se tabelat e workflow-ve vizuale mungojnë. Duhet aplikuar migrimi ekzistues `supabase/migrations/20261010110000_visual_workflows.sql`; nuk është aplikuar në prodhim nga ky zhvillim. Deri atëherë chati shfaq vetëm rrjedhën e sugjeruar dhe bllokon ruajtjen/publikimin.

Mbeten për fazën pasuese: leximi/modifikimi i workflow-ve lineare sipas produktit dhe lidhjet e tyre, historik i plotë i ndryshimeve të drafteve, si edhe zëvendësimi i panelit të vjetër AI pasi të mbulohet funksionaliteti i tij. Versionet e publikuara ruajnë autorin dhe kohën përmes skemës ekzistuese. Mos e trajto këtë dorëzim si zbatim të fazës 4.

## Qëllimi

Biznesi mund t’i kërkojë Agjentit, me tekst ose audio, të shfaqë dhe shpjegojë rrjedhën aktuale, të propozojë ndryshime, të krijojë një rrjedhë, ta provojë dhe ta publikojë pas konfirmimit. Chati dhe editori përdorin të njëjtat të dhëna dhe të njëjtin ekzekutim.

## Gjendja e verifikuar

- Agjenti kryesor nuk ka veprime për workflow në `src/lib/business-assistant/model.ts`.
- Workflow-i vizual është një hapësirë për biznes, me draft, revision, version të publikuar dhe gjendje aktive/joaktive. Nuk është aktualisht një bibliotekë me disa workflow vizuale të pavarura.
- `src/lib/workflows/visual/actions.ts` mbështet ruajtje drafti, publikim dhe aktivizim/çaktivizim. Publikimi e aktivizon rrjedhën.
- `store.ts` dhe `execute.ts` ruajnë versionin e publikuar për bisedat vizuale në vazhdim. Kjo mbrojtje nuk duhet të supozohet automatikisht për workflow-t lineare të produkteve.
- Ekzistojnë edhe `workflows` dhe `workflow_steps` për porositë e produkteve. Hapi vizual `product` përdor motorin ekzistues të porosisë.
- `simulateVisualWorkflow` përdor motorin real në modalitet prove.
- Migrimi për workflow-t vizuale ekziston në projekt; prania e tij në mjedisin e vendosur duhet verifikuar gjatë implementimit.

## Përvoja e klientit

### Shfaq dhe shpjego

Kërkesat “Më trego si punon Agjenti” dhe “Çfarë kërkon për këtë produkt?” kthejnë një kartë me emrin, statusin, shtrirjen dhe hapat. Shfaqen veçmas rrjedha aktive dhe ndryshimet e papublikuara. Në mobile përdoret një listë vertikale me degëzime Po/Jo; diagrami i plotë hapet në editorin ekzistues. Përgjigjja duhet të bazohet në konfigurimin e ruajtur, jo në një përshkrim të shpikur nga modeli.

### Ndrysho me bisedë

Mbështeten shtimi, ndryshimi, heqja dhe riorganizimi i hapave, pyetjet e tyre, fushat e mbledhura, kushtet, lidhjet dhe kalimi te stafi. Kur ka disa hapa të ngjashëm ose nuk është e qartë shtrirja, Agjenti pyet dhe jep zgjedhje konkrete. Një ndryshim mund të përfshijë disa hapa të të njëjtit workflow, të ruajtur së bashku.

Shembull: “Kërko telefonin para konfirmimit.” Agjenti identifikon rrjedhën dhe hapin e konfirmimit, kontrollon nëse telefoni mblidhet tashmë, dhe propozon ndryshimin pa krijuar pyetje të dyfishta.

### Rishiko, provo dhe aktivizo

Paraqiten hapat e shtuar/ndryshuar/hequr dhe ndikimi te degëzimet. Veprimet janë “Ruaj draftin”, “Provoje” dhe “Publiko dhe aktivizo”. Ruajtja e draftit nuk ndryshon bisedat aktive. Publikimi kërkon konfirmim të qartë për versionin e shfaqur. Nëse editori e ka ndryshuar rrjedhën ndërkohë, propozimi rifreskohet dhe kërkon konfirmim të ri.

## Rendi i implementimit

1. **Leximi dhe konteksti.** Shto veprime vetëm për lexim/listim të workflow-ve dhe lidhjeve me produktet. Zgjero kontekstin e Agjentit me identitetin e rrjedhës, revision dhe hapin e zgjedhur. Kartë e lexueshme në chat dhe lidhje me editorin. Dallo mungesën e konfigurimit nga pamundësia për ta ngarkuar.
2. **Ndryshimi i draftit vizual.** Shto propozime të strukturuara për krijim dhe modifikim të draftit të biznesit. Përdor operacione të kufizuara mbi hapa/lidhje, identifikues të qëndrueshëm dhe validim në server. Krijimi nuk mbishkruan një draft ekzistues pa e bërë të qartë zëvendësimin. Ripërdor validimin dhe ruajtjen ekzistuese përmes një shërbimi të përbashkët për editorin dhe Agjentin.
3. **Prova dhe publikimi.** Integro simulimin ekzistues në chat, me sesion prove të ndarë nga biseda administrative. Lejo publikim, aktivizim dhe çaktivizim me konfirmim. Kthe versionet e mëparshme në draft për rishikim përpara ripublikimit. Editor dhe chat rifreskohen pas çdo ruajtjeje.
4. **Hapat e porosive dhe lidhjet me produktet.** Shto ndryshimet në workflow-t lineare dhe caktimin e tyre te produktet. Shfaq produktet e prekura kur një workflow ndahet nga disa produkte; ofro kopje për vetëm produktin e kërkuar. Para aktivizimit implemento ruajtje atomike, kontroll versioni dhe vazhdimësi të porosive në proces. Për tipare produktesh të lidhura me hapat, valido përputhjen e fushave me motorin real. Mos pretendo se një ndryshim vizual i fushave ndryshon automatikisht të dhënat e porosisë.
5. **Përfundimi i integrimit.** Shto sugjerime sipas faqes dhe modulit. Hiq hyrjet e vjetra AI për workflow vetëm kur funksionet e tyre mbulohen nga Agjenti. Ruaj editorin manual. Dokumento kufijtë e funksioneve që motori mund të ekzekutojë.

## Zbatimi dhe kufijtë

- Autorizimi, biznesi dhe modulet merren nga serveri; konteksti i faqes nuk jep autorizim.
- Ripërdor propozimet e konfirmueshme të Agjentit. Propozimet për grafik duhet të kenë skemë dhe kufij të përshtatshëm, jo të futen artificialisht në fushat e produkteve.
- Konfirmimi lidhet me workflow, revision dhe përmbajtjen e saktë të ndryshimit. Ruajtja është atomike; kërkesat e përsëritura nuk krijojnë publikime të dyfishta.
- Ruaj autorin, kohën, versionin dhe përmbledhjen e ndryshimeve. Rikthimi krijon version të ri, nuk rishkruan historikun.
- Agjenti përdor vetëm hapat që ekzekutuesi mbështet: start, condition, knowledge, collect, confirm, product, handoff dhe end. Veprime të reja si pagesa apo rezervime brenda grafikut kërkojnë zhvillim të veçantë të motorit.
- Kontrollo ciklet, degët pa destinacion, hapat e palidhur, fushat e pavlefshme dhe kufijtë ekzistues të grafikut. Draftet e paplota etiketohen qartë dhe nuk publikohen.
- Zbulimi i qëllimit në motorin vizual është aktualisht me rregulla deterministe. Ndryshimi i etiketës së një kushti nuk duhet të paraqitet si aftësi e re semantike.

## Kriteret e pranimit

- “Më trego workflow-n” paraqet saktë konfigurimin dhe statusin real, edhe kur drafti ndryshon nga versioni aktiv.
- “Shto telefonin para konfirmimit” ndryshon rrjedhën e synuar, pa pyetje të dyfishta dhe pa humbur degëzimet.
- Kërkesat e paqarta prodhojnë zgjedhje për sqarim, jo ndryshime arbitrare.
- Refuzimi i propozimit nuk bën asnjë shkrim. Ruajtja e draftit nuk publikon.
- Prova e draftit nuk krijon porosi, takime apo mesazhe reale; kjo verifikohet edhe për degën product.
- Publikimi nuk ndërpret bisedat ekzistuese; bisedat e reja përdorin versionin e ri.
- Ndryshimet paralele nga editori bllokojnë konfirmimin e vjetruar.
- Testohen izolimi mes bizneseve, modulet e çaktivizuara, konfirmimi i përsëritur, ndryshimet e disa hapave si një veprim dhe kufijtë e grafikut.
- Verifikohen desktop, mobile, hyrja audio dhe vazhdimësia e kontekstit gjatë navigimit.

## Dorëzimi i parë

Fillimi i rekomanduar: shfaqja/shpjegimi i rrjedhës dhe propozimi i ndryshimeve në draftin vizual, me kartë para/pas dhe hapje në editor. Më pas simulimi dhe publikimi; ndryshimet e porosive sipas produktit vijojnë pasi të mbulohet vazhdimësia e tyre.
