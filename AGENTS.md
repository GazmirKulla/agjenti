# Udhëzime të përhershme për Agjenti.app

Zbatohen në të gjithë këtë repository. Lexoji para planifikimit dhe ndryshimit të kodit. Ky skedar është burimi i rregullave të bashkëpunimit; kërkesat e drejtpërdrejta të përdoruesit kanë përparësi.

## Qëllimi dhe scope-i
- Për ndryshime të mëdha, përmblidh në maksimum 5 pika rezultatin e kërkuar, çfarë ruhet, çfarë përjashtohet dhe kriteret e pranimit. Mirato drejtimin përpara implementimit; mos kërko përsëri miratim kur është dhënë.
- Një shembull demonstrues nuk është objektivi i projektit. Mos e kthe një skenar produkti në ridizenjim të gjithë modulit kur qëllimi është përvoja e përgjithshme.
- Çdo grup ndryshimesh duhet të ketë lidhje të drejtpërdrejtë me rezultatin e miratuar. Nëse puna devijon ose zbulon një zgjedhje që ndryshon scope-in, ndalo pjesën e varur dhe shpjegoje shkurt.
- Për ridizenjim, dorëzo fillimisht një pjesë të vogël që përfaqëson drejtimin e përgjithshëm: navigimin dhe një rrjedhë ekzistuese të plotë brenda tij. Mos investo në hollësi të një moduli të izoluar para këtij kontrolli.

## Ruajtja e funksionalitetit
- Inspekto routes, komponentët, shërbimet, kontratat e të dhënave dhe testet përkatëse para se të propozosh zëvendësime.
- Ripërdor funksionalitetin ekzistues. Ndryshimi i pamjes nuk autorizon heqjen, fshehjen pa hyrje alternative ose thjeshtimin e aftësive.
- Workflow-t duhet të ruajnë editorin, nyjet, kushtet, lidhjet, validimin, provat, versionet dhe publikimin që sistemi mbështet realisht.
- Ruaj aksesin manual; mos detyro përdorimin e chat-it për procese që kanë ndërfaqe funksionale.
- Mos ndërto një implementim paralel vetëm sepse është më i lehtë për demonstrim. Nëse nevojitet migrim gradual, përcakto mënyrën e kalimit dhe shmang dy burime të së vërtetës.
- Të dhënat sintetike dhe simulimet lejohen vetëm në prototipe të izoluara, të etiketuara qartë. Mos i paraqit si integrim real.

## Inxhinieri softuerike afatgjatë
- Merr vendime për korrektësi, mirëmbajtje dhe evoluim të sistemit; mos prodho kod vetëm që të duket sikur punon ("vibe coding").
- Zgjidh problemin në shtresën e duhur. Ruaj ndarjen mes UI-së, logjikës së biznesit dhe ruajtjes; shmang logjikën e kopjuar dhe varësitë e fshehta.
- Përdor konventat dhe stack-un aktual. Mos shto abstraksione, biblioteka apo infrastrukturë pa një nevojë konkrete.
- Për ndryshime arkitekturore, shpjego shkurt arsyen, alternativën kryesore, pasojat dhe mënyrën e migrimit/kthimit. Mos mbiprojekto për nevoja hipotetike.
- Autorizimi, izolimi mes bizneseve dhe validimi i shkrimeve duhet të zbatohen në server. Ruaj përputhshmërinë e kontratave dhe integrimeve ekzistuese.
- Trajto gabimet, gjendjet bosh, dështimin e rrjetit dhe konfliktet sipas ndikimit real të veprimit. Mos shfaq sukses pa konfirmim.
- Prefero ndryshime të kufizuara, koherente dhe të rishikueshme. Mos përfshi pastrime ose refaktorime të palidhura.

## Kohë, token-a dhe verifikim
- Lexo dhe kërko vetëm çfarë nevojitet për vendimin aktual. Grumbullo leximet e pavarura; mos rilexo pa arsye materiale.
- Mbaji përditësimet të shkurtra dhe konkrete. Mos krijo dokumente, raporte, pamje apo agjentë shtesë pa nevojë ose kërkesë.
- Testo sjelljen dhe rreziqet e ndryshuara. Mos shkruaj teste që vetëm pasqyrojnë implementimin dhe mos përsërit kontrolle të kaluara pa ndryshim ose shqetësim të ri.
- Verifiko pamjen herët për punë UI, para investimit të madh në implementim. Kontrollet teknike nuk zëvendësojnë përputhjen me përvojën e kërkuar.
- Në dorëzim krahaso rezultatin me kriteret fillestare. Thuaj çfarë funksionon, çfarë u testua dhe çfarë mungon; dallo kodin lokal, provën me të dhëna reale dhe publikimin.
- Mos shpall të përfunduar një kërkesë të gjerë kur ke realizuar vetëm një pjesë të saj.

## Ndryshimet ekzistuese dhe kthimi prapa
- Kontrollo gjendjen e Git para punës. Mos mbishkruaj ndryshimet e përdoruesit ose punë të palidhura.
- Kur kërkohet anulim, hiq vetëm ndryshimet e identifikuara të asaj pune. Dallo kodin nga të dhënat, konfigurimet dhe publikimet që mund të kërkojnë kthim veçmas.
- Kërko sqarim vetëm kur mungesa ndryshon rezultatin ose veprimi e kërkon. Për çdo konfirmim të domosdoshëm, shpjego saktë arsyen dhe burimin e kufizimit.
