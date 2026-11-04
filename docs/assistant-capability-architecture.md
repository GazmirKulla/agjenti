# Asistenti, aftësitë dhe proceset — plan implementimi

Drejtimi është miratuar në bisedë më 4 nëntor 2026. Ky dokument lidh ndryshimet me kriteret e pranimit; nuk është dëshmi publikimi.

## 1. Aftësi të disponueshme, navigim sipas përdorimit

- Modulet standarde nuk kërkojnë aktivizim ose leje pakete. Regjistri teknik mbetet për identifikimin e funksioneve.
- `enabledModules` në profilin e kthyer nga serveri mbetet kontratë për përputhshmëri dhe përmban aftësitë e lejuara; lista e ruajtur në profil është preferencë paraqitjeje.
- Navigimi bashkon preferencat me përdorimin real dhe respekton seksionet e fshehura shprehimisht. Ruajtja e dështuar/anulimi nuk shfaqin seksion të ri.
- Rolet, anëtarësimi dhe kufijtë e biznesit ruhen. `business.provision` mbetet privilegj i veçantë. Rezervimet automatike kërkojnë konfigurimin dhe autorizimin e tyre.
- Pranim: pronari shton shërbim pa aktivizim moduli; fshehja e menusë nuk bllokon API/AI; përdoruesi i një biznesi tjetër nuk lexon/shkruan të dhënat.

## 2. Konfirmimi

- Një modal me objektivin, ndryshimet, Konfirmo/Anulo dhe detaje të hapshme.
- Anulimi mbyll modalin, ruan propozimin dhe bisedën; nuk shkruan në biznes. Propozimet e rikthyera kërkojnë rishqyrtim.
- Konfirmimi përdor biletën ekzistuese të nënshkruar, afatin, kontrollin e ndryshimeve konkurruese dhe përgjigjen e serverit.
- Pranim: tastierë/mobile, anulim/rikthim, gabim pa sukses të rremë, konfirmim i skaduar dhe objektiv i pandryshuar gjatë navigimit.

## 3. Workflow

- Modeli vizual ekzistues është modeli kryesor për proceset e reja nga chat/editori. Versionet e vjetra dhe proceset lineare në vazhdim mbeten adapterë përputhshmërie.
- AI interpreton dhe përgjigjet; procesi ndjek gjendjen, kërkesat, degëzimet dhe konfirmimet; shërbimi përkatës autorizon dhe kryen veprimin.
- Faktet e vlefshme ripërdoren; pyetjet informative nuk konsumohen si të dhëna. Konfirmimi lidhet me faktet dhe versionin.
- Editor/nyje/lidhje/kushte/prova/versione/publikim dhe qasja manuale ruhen. Detajet shfaqen sipas nevojës.
- Migrimi nuk rishkruan versione të publikuara ose gjendje bisedash. Heqja fizike e adapterëve kërkon provë se nuk kanë më referenca aktive.
- Pranim: proces i ri përdor modelin kanonik, proces i nisur ruan versionin, ndryshim faktesh kërkon konfirmim të ri, përgatitja e porosisë nuk paraqitet si dërgim.

## 4. Asistent proaktiv

- Lexon probleme konkrete dhe punë të pambaruara nga burimet ekzistuese: plane private të asistentit, draft procesi, kalim te stafi, rezervime me gabim sinkronizimi.
- Ofron hapin e radhës dhe lidhjen drejt punës; nuk ekzekuton propozimet pa autorizim.
- Ndjek gjendjen nga burimi për të mos krijuar një kopje paralele të statusit. Rifreskon automatikisht gjatë përdorimit dhe kur përdoruesi rikthehet.
- Plane private shihen vetëm nga pronari i bisedës. Dështimi i leximit raportohet si informacion i padisponueshëm, jo si mungesë problemesh.
- Pranim: evidentim pa kërkesë manuale, rikthim te puna ekzistuese, zhdukje e sinjalit kur burimi është zgjidhur, asnjë dërgim mesazhi ose veprim i paautorizuar.

## 5. Databaza, verifikimi dhe kthimi

- Migrim shtues për ndarjen e aftësive nga navigimi. Nuk fshin konfigurime, të dhëna ose historik politikash.
- SQL kontrollon anëtarësimin, rolet, objektivin, konfirmimin dhe kushtet tregtare. Kontrolli i paraqitjes hiqet nga autorizimi.
- Teste njësie/sjelljeje, TypeScript/lint, provë vizuale dhe SQL me rollback për izolimin dhe privilegjet.
- Para aplikimit kontrollohen përkufizimet aktuale të funksioneve. Ndryshimet në databazën e lidhur dhe publikimi i aplikacionit raportohen veçmas.
- Kthimi bëhet me migrim kompensues të funksioneve; preferencat dhe politikat e mëparshme ruhen. Nuk rikthehen versione workflow automatikisht.

## Gjendja e dorëzimit — 4 nëntor 2026

- Ndarja e aftësive nga navigimi është zbatuar në server, web dhe përgjigjen bootstrap për mobile. Produktet, shërbimet, proceset, burimet, agjentët dhe lidhjet e kanaleve shfaqin seksionet përkatëse sipas të dhënave të ruajtura; preferenca e shprehur për fshehje ka përparësi.
- Propozimet e veprimeve dhe aktivizimi i produkteve/njohurive përdorin modalin. Konfigurimi dhe shqyrtimi i CSV-së mbeten në ndërfaqen e importit. Anulo ruan propozimin; mbyllja përfundimtare e propozimit është veprim më vete.
- Proaktiviteti kontrollon katër burimet e përcaktuara më sipër. Kontrolli bëhet gjatë përdorimit të asistentit, çdo minutë dhe kur kthehesh në dritare. Planet kontrollohen për 20 bisedat më të fundit me plan; nuk është inventar i pakufizuar. Nuk ka monitorim kur aplikacioni është mbyllur ose njoftime jashtë tij.
- Workflow ka një politikë të veçuar për zgjedhjen e motorit/versionit dhe udhëzim kanonik për propozimet e reja. Motorët, formatet dhe editorët ekzistues ruhen. Heqja fizike e formateve të vjetra dhe migrimi i të gjitha përkufizimeve nuk janë përfunduar; kërkojnë inventar të referencave dhe migrim të veçantë.
- Dy migrimet `20261104002604` dhe `20261104003316` u aplikuan në projektin Supabase të lidhur. Nuk fshihen të dhëna ose rishkruhen biseda/versione. Kodi i aplikacionit është lokal; publikimi nuk është kryer.

### Verifikimi

- Kaluan 2,650 teste në ekzekutimin e plotë; ndryshimet pas tij u kontrolluan me testet përkatëse. TypeScript dhe lint për skedarët e ndryshuar kaluan.
- Ndërtimi për publikim kaloi në kopje të izoluar. Ndërtimi në dosjen e punës u pengua nga serveri dev që përdorte njëkohësisht `.next`; nuk u ndryshua konfigurimi për ta fshehur gabimin.
- Në Chrome u provua komponenti real i modalit në desktop/mobile: anulim, rihapje, Escape dhe konfirmim. Aktivizimi u provua me përgjigje të simuluara: anulimi nuk shkruan dhe konfirmimi përdor saktësisht biletën e produktit të zgjedhur. Kjo është provë UI e izoluar, jo provë me klientë realë ose kanale të jashtme.
- Në databazën e lidhur kaluan fixture-t SQL me rollback për aftësitë standarde, qasjen mes bizneseve, rolin e stafit, privilegjin e veçantë dhe navigimin nga përdorimi. Kontrollet e sigurisë pas migrimeve treguan të njëjtat kategori dhe numra gjetjesh ekzistuese; nuk janë të gjitha të pastra.
- Suitat SQL me injektim gabimesh dhe konkurrencë u ekzekutuan lokalisht në PostgreSQL 17.10. Kaluan 76 migrime nga zero; kufijtë e publikimit/ekzekutimit, siguria e porosive, shkrimet atomike dhe rollback, autorizimi i katalogut, dy konfirmime paralele, çaktivizimi paralel i produktit/workflow-t, si dhe korrigjimi kundrejt konfirmimit nga stafi. U korrigjua një pritshmëri në fixture: menuja e fshehur nuk bllokon, por workflow i çaktivizuar vazhdon të bllokojë. Testet historike të katalogut tani verifikojnë heqjen e portave të paketave dhe ruajtjen e lejeve të aktorit.
- Databazat e provës përdorën vetëm Unix socket, pa port rrjeti dhe pa kredenciale prodhimi. Serveri i përkohshëm u ndal pas testeve. PostgreSQL mbetet i instaluar për prova të ardhshme; nuk u regjistrua si shërbim në nisjen e kompjuterit.

Përsëritja nga rrënja e projektit (krijon një cluster të ri të përkohshëm dhe e ndal në përfundim):

```sh
python3 supabase/tests/conversation_transport.py \
  --pg-bin /opt/homebrew/opt/postgresql@17/bin \
  --extra-sql supabase/tests/capability_navigation_suite.sql \
  --order-correction
```

Evidenca e ekzekutimit lokal: `/tmp/agjenti-local-sql.log` dhe `/tmp/agjenti-catalog-sql.log`. Këto janë prova SQL lokale; nuk dëshmojnë publikim aplikacioni ose dërgim te ofruesit e jashtëm.
