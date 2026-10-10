# Agjenti — plani i zhvillimit assistant-first

Data: 10 tetor 2026. Statusi: zhvillimi ka nisur, faza e parë është në proces.

## Vizioni

Asistenti bëhet pika kryesore ku biznesi shpreh qëllimin dhe kryen punën. Biseda ndërthur tekst, forma, lista dhe kontrolle të strukturuara. Pamjet e moduleve mbeten të arritshme drejtpërdrejt. Identiteti vizual është i thjeshtë dhe familjar, me identitetin e Agjenti-t.

Ky dokument vijon `assistant-first-redesign-prompt.md` dhe konkretizon diskutimin për desktop/mobile. Në dallimet e prezantimit, drejtimi i ri është bisedë qendrore, panel pune në desktop dhe pamje e plotë në mobile. Nuk ndryshon kufijtë e autorizimit të dokumentit ekzistues.

## Baza e kontrolluar në projekt

- Next.js, React, TypeScript, Supabase dhe Vitest ekzistojnë; nuk kërkohet ndryshim stack-u.
- `src/components/business-assistant/workspace.tsx` ndan kontekstin dhe hyrjet e asistentit.
- `panel.tsx` ka tekst/audio, histori në memorie, propozim dhe konfirmim.
- `src/lib/business-assistant/model.ts` përcakton veprimet dhe fushat e lejuara.
- API dhe shërbimet ekzistuese kanë kontrolle biznesi, konfirmime dhe validime që duhen ruajtur.
- Mbështeten veprime për produkte, shërbime, njohuri, profil, agjent, rezervime dhe workflow.
- Pamjet e ofertave/faturave në diskutim janë koncepte vizuale, jo aftësi ekzistuese të verifikuara.
- Kontrolli i kodit nuk vërteton gjendjen e migrimeve ose deploy-t në production.

## Përvoja e synuar

### Desktop

Navigimi majtas, biseda në qendër, objekti i punës djathtas kur nevojitet. Paneli i punës mund të hapet, mbyllet dhe zmadhohet pa humbur draftin. Në gjerësi të ndërmjetme navigimi paloset ose pamja e punës kalon në ekran të veçantë. Navigimi përshtatet me modulet reale të biznesit.

### Mobile

Biseda është pamja kryesore. Navigimi hapet nga menuja. Format e shkurtra shfaqen në bisedë; dokumentet dhe redaktimet e gjata hapen më vete. Kthimi ruan gjendjen dhe pozicionin e bisedës. Tastiera, zona e sigurt e telefonit, fokusi dhe kthimi me navigimin e shfletuesit duhen testuar. Fusha e shkrimit nuk duhet të mbulohet nga tastiera.

### Rregullat e ndërveprimit

1. Përdor informacionin e njohur; kërko vetëm çfarë mungon.
2. Disa fusha të lidhura mblidhen në një formë. Paqartësia e vetme sqarohet me një pyetje.
3. Teksti dhe kontrollet ndryshojnë të njëjtin draft të versionuar.
4. Kërkesat e pambështetura shpjegohen pa simuluar ekzekutim.
5. Ndryshimi i temës ruan punën e papërfunduar për vazhdim.
6. Rezultati shfaqet si sukses vetëm pas përgjigjes së serverit.

## Biblioteka e ndërveprimeve

Tekst, përshkrim, numër, çmim/monedhë, select, multiselect, kërkim i një elementi, Po/Jo, checkbox, switch, datë/orë, skedarë, lista të faqëzuara, karta objektesh, krahasim para/pas, konfirmim dhe rezultat.

Çdo kontroll ka label, ndihmë kur duhet, validim, gjendje ruajtjeje dhe gabim të lidhur me fushën. Vlera boolean e panjohur është e dallueshme nga false. Opsionet dinamike merren nga të dhënat e autorizuara të biznesit. AI propozon tipe të lejuara; nuk ekzekutohet kod/HTML i gjeneruar nga modeli.

## Gjendja dhe ruajtja

Modelet e ardhshme: biseda, mesazhe me pjesë të strukturuara, draft pune, propozim i versionuar dhe ekzekutim me rezultat. Çdo objekt lidhet me biznesin dhe përdoruesin. Historiku i brendshëm është i ndarë nga Inbox-i i klientëve.

Ruajtja në server duhet të mbështesë rifreskimin dhe kalimin mes pajisjeve. Duhet vendosur politika e ruajtjes/fshirjes dhe dukshmëria individuale apo e ekipit. Mesazhet historike nuk duhet të riekzekutojnë veprime. Propozimet e skaduara ose të zëvendësuara kërkojnë përgatitje të re. Mos ruaj token-a konfirmimi në localStorage si zgjidhje për vazhdimësinë.

## Siguria dhe besueshmëria

- Serveri verifikon sesionin, anëtarësinë, rolin, modulin dhe pronësinë e çdo objekti.
- Leximi kryhet drejtpërdrejt; draftet ruhen sipas rregullave të modulit; veprimet me ndikim kërkojnë konfirmim konkret.
- Konfirmimi lidhet me përmbajtjen dhe versionin që përdoruesi pa.
- Kërkesat e përsëritura nuk prodhojnë dublikime; ndryshimet konkurruese zbulohen.
- Ruhet historiku i ekzekutimeve; zhbërja ofrohet vetëm kur mbështetet realisht.
- Skedarët dhe mesazhet e klientëve nuk mund të japin autorizime ose të ndryshojnë rregullat e ekzekutimit.
- Ndërrimi i biznesit izolon gjendjen dhe përgjigjet e vonuara.
- Pas ndërprerjes së lidhjes kontrollohet rezultati përpara përsëritjes së një shkrimi.

## Fazat dhe kriteret e pranimit

### 1. Inventari dhe ndërfaqja bazë — në proces

- [x] Kontroll fillestar i asistentit dhe moduleve në kod.
- [x] Dokumentimi i planit në projekt.
- [x] Ndarja e përmbledhjes për konfirmim nga biseda në desktop.
- [x] Hapja e përmbledhjes dhe kthimi te biseda në mobile.
- [ ] Biseda si hapësirë e përhershme në faqen kryesore, pa mbulim të panevojshëm të dashboard-it.
- [ ] Panel pune i përgjithshëm me mbyllje, rihapje dhe zmadhim.
- [ ] Provë vizuale në shfletues me sesion të autentikuar.

Pranimi: një propozim ekzistues kontrollohet dhe konfirmohet nga të dyja pamjet; gabimet mbeten të dukshme dhe kthimi ruan bisedën. Implementimi i parë përdor rrjedhën ekzistuese pa ndryshime databaze.

### 2. Procesi i plotë “Krijo një shërbim”

- [ ] Kontratë e strukturuar forme me validim në server.
- [ ] Emri, përshkrimi, çmimi/monedha, kohëzgjatja dhe rezervueshmëria sipas skemës ekzistuese.
- [ ] Plotësimi me tekst dhe kontrolle mbi të njëjtin draft.
- [ ] Krahasimi, konfirmimi dhe lidhja me shërbimin e ruajtur.

Pranimi: kërkesat e plota dhe të pjesshme përfundojnë me të dhëna reale, pa krijime të dyfishta dhe pa mbishkrime të heshtura.

### 3. Historia dhe vazhdimësia

- [ ] Migrime për bisedat, pjesët e mesazheve dhe draftet me izolim biznesi.
- [ ] Lista, kërkimi, titulli, arkivimi dhe fshirja sipas politikës.
- [ ] Vazhdim pas rifreskimit dhe nga pajisje tjetër.
- [ ] Menaxhim i propozimeve të skaduara dhe rezultateve historike.

Pranimi: rikthimi nuk ekzekuton asgjë automatikisht; një përdorues pa akses nuk lexon bisedën apo draftin.

### 4. Zgjerimi i moduleve

- [ ] Produkte dhe njohuri.
- [ ] Disponueshmëri dhe rezervime.
- [ ] Konfigurimi i agjentit dhe workflow, duke ruajtur draft/publikim/provë.
- [ ] Inventar i veçantë për veprimet mbi klientët, porositë dhe Inbox-in.

Pranimi: çdo aftësi ka kontratë të përcaktuar, leje, gabime të rikuperueshme dhe të njëjtën sjellje në mobile/desktop.

### 5. Provë dhe aktivizim gradual

- [ ] Aktivizim i kontrolluar për biznese prove dhe mënyrë rikthimi te pamja ekzistuese.
- [ ] Matje e përfundimit, braktisjes, korrigjimeve, vonesës, gabimeve dhe kostos për detyrë.
- [ ] Përmirësime nga provat e përdoruesve.

Pranimi: kontrollet teknike kalojnë; skenarët realë provohen dhe modulet ekzistuese vazhdojnë të funksionojnë. Objektivat numerike caktohen pas matjeve fillestare.

### 6. Module të reja

Ofertat dhe faturat kërkojnë specifikim të veçantë: modelet, numerimi, llogaritjet, statuset, dokumenti dhe dërgimi. Pagesat dhe dërgimi automatik nuk përfshihen nga një ndryshim vizual.

## Testimi

Kontrolle të tipave, lint, testet për planifikimin/konfirmimin dhe build. Teste të reja për sjellje të reja me ndikim: validimi i formave, izolimi, versionimi, idempotenca dhe ruajtja. Teste SQL në databazë të izoluar kur shtohen migrime.

Provë në shfletues: desktop i gjerë, tablet, telefon 390px dhe 320px; tastierë; fokus; lexues ekrani; lidhje e ndërprerë; klikim i dyfishtë; konflikt ndryshimi; propozim i skaduar; kalim biznesi; konfirmim që dështon; rikthim nga pamja e punës.

## Kufijtë e dorëzimit të parë

Ky hap nis prezantimin e bisedës dhe përmbledhjes së ndryshimit. Nuk shton ende forma dinamike, histori të qëndrueshme, module faturimi ose një ridizenjim të plotë të shell-it. Statusi i provave regjistrohet pas kontrolleve; imazhet e konceptit nuk konsiderohen provë funksionale.

## Verifikimi i hapit të parë

- `npx tsc --noEmit`: kaloi.
- `yarn test`: 118 skedarë, 763 teste kaluan.
- `yarn lint`: pa gabime; 7 paralajmërime në skedarë jashtë këtij ndryshimi.
- `yarn build`: kaloi.
- `git diff --check`: kaloi.
- Pamja ende kërkon provë vizuale dhe ndërveprimi në shfletues me përdorues të autentikuar. Testet ekzistuese nuk provojnë layout-in ose sjelljen e fokusit në pajisje reale.
