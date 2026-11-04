# Rindërtimi i motorit të bisedës

Drejtimi u miratua më 4 nëntor 2026. Ky skedar ndjek implementimin; nuk është provë publikimi.

## Kontrata e produktit

Një koordinator merr mesazhin, kontekstin dhe proceset. AI propozon interpretim dhe formulim; serveri zotëron faktet e validuara, autorizimin, konfirmimet dhe ekzekutimin. Përgjigjja mbështetet në një kontratë të strukturuar, jo në interpretimin e prozës së gjeneruar. Konfigurimi manual dhe asistenti ndryshojnë të njëjtin burim. Editorët, versionet, provat, lidhjet dhe gjendjet ekzistuese ruhen.

## Kufijtë e implementimit

- Asnjë motor i dytë që shkruan ose dërgon për të njëjtën bisedë.
- Integrimet dhe shërbimet e veprimeve ekzistuese ripërdoren.
- Versionet/gjendjet e publikuara nuk ndryshohen pa inventar dhe konvertim të verifikuar.
- Kontrollet e autorizimit dhe konfirmimet nuk varen nga udhëzimet e AI-së.
- Teksti i gjeneruar nuk mund të shtojë leje, fusha ose rezultate veprimesh.
- Shkrimet ekzistuese të këtij chat-i ishin staged para nisjes; ruhen.

## Daljet e kërkuara

- [x] Kontrata e vendimit, komunikimit dhe rezultateve; inventar i proceseve.
- [x] Një koordinator pa degën e vjetër sipas pilotit; konfigurim i versionuar dhe pyetje të strukturuara.
- [x] Motori vizual përshkruan ndërveprimin; adapteri linear përdor të njëjtën kontratë për mbledhjen. Konfirmimet, faturat e veprimeve dhe tekstet e konfiguruara mbeten të kontrolluara.
- [x] Draft/provë/publikim/rikthim përmes të njëjtit shërbim nga asistenti dhe ndërfaqja manuale.
- [x] Përputhshmëria e gjendjeve të vjetra dhe rikthimi i konfigurimit u testuan lokalisht; procedura e kalimit/kthimit për publikim është më poshtë.
- [ ] Prova e plotë UI → Auth → databazë → bisedë. Pamja desktop/mobile dhe skenarët e runtime-it u provuan veçmas; E2E nuk u ekzekutua sepse mungon Docker.
- [ ] Kontroll i prodhimit, publikim dhe provë me kanal real.

## Gjendja fillestare

Para ndryshimeve të këtij rindërtimi: 2746 teste kaluan; 2 dështuan në `navigation.test.ts` sepse navigimi tashmë përmban `users`, ndërsa pritshmëritë nuk e përmbajnë. Këto janë dështime ekzistuese jashtë motorit të bisedës. Asnjë provë lokale nuk dëshmon sjellje në Instagram live.

## Vendime arkitekturore

Ndryshimi bëhet brenda stack-ut dhe aplikacionit aktual. Kontratat dhe shërbimet ndahen si module, jo mikroshërbime. Nuk ndërtohet një dyqan i dytë faktesh. Kufijtë e platformës mbeten të versionuar në kod; preferencat e biznesit ruhen në konfigurimin ekzistues dhe nuk autorizojnë veprime. Kalimi final kërkon verifikimin e të gjitha referencave aktive dhe pajtimin e punëve në proces.

## Çfarë ndryshoi në kod

`processConversationMessage` zotëron vendimin për turnin dhe përgjigjen përfundimtare. Ai përdor adapterët ekzistues të proceseve, ruajtjes dhe transportit. Nuk ka ndryshim në lejet e veprimeve, nyjet/lidhjet e editorit ose kontratat e dërgimit/idempotencës. Gjendja e proceseve vazhdon të ketë një burim kanonik.

`communication-contract` ndan përgjigjen nga pyetja opsionale. `process-communication` ndan kërkesën për një fushë nga formulimi i saj. Modeli nuk zgjedh fusha të tjera dhe nuk merr mjete shkrimi në këtë shtresë. Fallback-u përdor tekstin e konfiguruar dhe gabimet e centralizuara. Përgjigjet e veprimeve mbeten të bazuara në rezultatin e serverit; receipt-et e reja për regjistrim/rezervim janë vëzhgime, jo leje dhe jo zëvendësim i ledger-it të ekzekutimit.

`communication-policy` ruan gjuhën, tonin, gjatësinë, pyetjet njohëse dhe emoji-t. Drafti nuk ndryshon përgjigjet live. Publikimi kontrollon revision-in dhe timestamp-in, ruan snapshot dhe ndryshon firmën e konfigurimit të testuar. Rikthimi krijon draft nga historia. Prova e draftit lidhet me biznesin, agjentin dhe timestamp-in në sesionin e mbyllur; nuk certifikon konfigurimin live.

Propozimet e reja `agent_update` normalizohen në `agent.communication`/`draft`. `agent.manage` ruan krijimin, emrin dhe aktivizimin; nuk lejon ndryshim udhëzimesh për një agjent ekzistues. Ticket-et tashmë të miratuara para kalimit mbajnë semantikën e tyre deri në skadim; ndryshimet e tyre auditohen dhe vjetrojnë çdo draft konfliktual.

Nuk u hoqën tekstet e nevojshme të UI-së, konfirmimet e detyrueshme, formulimi faktik i kontrolluar ose fallback-et kur modeli dështon. Qëllimi është ndarja e sjelljes së konfigurueshme nga rregullat e serverit, jo heqja mekanike e çdo string-u. Alternativa e hedhjes së gjithçkaje në prompt do të humbiste validimin dhe provën e ekzekutimit.

## Verifikimi lokal

- Paketa e plotë: **2,788 teste kaluan; 2 dështime ekzistuese në navigim**. Testet e shtuara mbulojnë formatin e modelit, pyetjet e vetme, të dhënat shtesë të deklaruara, draftin, konfliktet, gjuhën e fallback-ut dhe kufijtë e tenant-it.
- TypeScript dhe ndërtimi Next.js në kopje të izoluar kaluan. Kopja e ndërtimit nuk përdori sekretet e prodhimit.
- 80 migrime u aplikuan në PostgreSQL 17 lokal të përkohshëm; draft/publish/restore, privilegjet, timestamp-et, firma e provës dhe dy shkrime konkurruese kaluan. Published mbeti i pandryshuar kur shkrimi i dytë u refuzua.
- Regjistrimi u provua në runtime të izoluar: emër → email → konfirmim → rezultat/link i etiketuar SIMULIM; pa krijim biznesi real. Testet ekzistuese të ndërprerjeve, korrigjimeve, transportit, retry-ve dhe izolimit kaluan.
- UI desktop/mobile u inspektua me të dhëna sintetike; pa overflow në gjerësi mobile. Kjo nuk është provë e ruajtjes përmes UI-së.
- Gjeneratori real i aplikacionit, me modelin e konfiguruar dhe informacion sintetik, iu përgjigj “Përshëndetje, si funksionon?” me shpjegim të shkurtër; `question: null`, pa kërkesë për të dhëna dhe pa fallback. Kjo provon një rast, jo të gjithë cilësinë e bisedës.
- Provider-at sintetikë të E2E u përshtatën me kontratën JSON. Sintaksa kaloi; E2E nuk u ekzekutua. Përgjigjet pozicionale të formularëve historikë mbeten në testet e checkpoints; bisedat e reja pranojnë disa të dhëna njëherësh kur klienti i jep me etiketa.

## Inventari live, vetëm lexim

Më 4 nëntor 2026: 5 workflow vizuale, të gjitha të çaktivizuara; 0 versione vizuale të publikuara; 0 workflow/steps/versione lineare. 302 gjendje bisede: 298 historike dhe 4 schema v3; 0 procese produkti të papërfunduara dhe 0 pins vizuale/lineare. Radha nuk kishte punë aktive në momentin e leximit. Ekzistonte 1 agjent aktiv. Ky inventar duhet përsëritur në momentin e publikimit.

Kjo do të thotë se rrjedha e regjistrimit ekziston në kod, por nuk ishte e publikuar live në këtë inventar. Rindërtimi i motorit nuk aktivizon vetë një draft workflow-je.

## Kalimi dhe kthimi

1. Ekzekuto E2E-në në stack-un lokal të izoluar (`e2e/local.mjs`), përfshirë konfigurim → draft → provë → publikim dhe regjistrimin. Docker mungon në këtë mjedis. Mos zëvendëso këtë kontroll me suksesin e provës sintetike të modelit.
2. Përsërit inventarin live dhe ruaj referencën e deployment-it aktual. Nëse ka punë në proces, lejo përfundimin/ripajtimin përmes queue/lease-ve ekzistuese; mos pastro checkpoint-et dhe mos ridërgo reply me rezultat të pasigurt.
3. Apliko migrimin shtues përpara kodit të ri. Ai ruan konfigurimin aktual si revision 1, pa ndryshuar instructions/aktivizimin/workflow-t. Kodit të ri i duhen kolonat e reja; nuk duhet publikuar përpara migrimit.
4. Publiko të gjithë ndryshimin si një kalim. Provat e vjetra të simulimit kanë binding v1; motori i ri përdor v2 dhe kërkon simulim të ri para publikimit të ri përmes asistentit. Workflow-t e publikuara dhe gjendjet e fiksuara nuk fshihen. Miratimet e vjetra të udhëzimeve skadojnë pas maksimumi 10 minutash.
5. Provo shpjegimin fillestar, refuzimin e regjistrimit, korrigjimin e email-it, konfirmimin dhe linkun real në një bisedë të kontrolluar. Aktivizimi i rrjedhës së regjistrimit duhet të kalojë validimin/publikimin ekzistues; mos publiko automatikisht 5 draftet e inventarit.
6. Në problem të konfigurimit: rikthe revision-in e mëparshëm si draft, provoje dhe publikoje. Në problem të kodit: kthe deployment-in e mëparshëm dhe ruaj migrimin shtues/historikun. Kodi i mëparshëm mund të lexojë fushat e vjetra dhe checkpoint-et e njëjta; nuk nevojitet downgrade destruktiv i tabelave. Provat end-to-end të këtij kthimi në deployment mbeten për portën e publikimit.

**Gjendja në dorëzimin fillestar:** ndryshime lokale, pa deployment dhe pa shkrime në databazën live; kalimi në prodhim nuk ishte përfunduar.

**Përgatitja e merge-it, me kërkesën e përdoruesit:** më 4 nëntor 2026 migrimi u aplikua në prodhim përpara bashkimit, sepse `main` nis publikimin automatik. Versioni real i regjistruar nga Supabase është `20261104200251`; skedari në repository u përputh me këtë version pa ndryshuar SQL-në ose historikun e databazës. U verifikuan 5 snapshots fillestare, konfigurimet ekzistuese të pandryshuara, RLS, qasja e shkrimit vetëm për serverin dhe funksioni i statusit të konfigurimit. Prova e plotë E2E dhe prova e regjistrimit përmes Instagram mbeten të pakryera; workflow-t nuk u aktivizuan nga migrimi.
