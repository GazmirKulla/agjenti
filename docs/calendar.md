# Kalendari dhe rezervimet

Apliko me radhë `supabase/migrations/20261010090000_calendar_bookings.sql` dhe `supabase/migrations/20261010100000_business_services.sql` përpara përdorimit. Aktivizo modulet Shërbime, Rezervime dhe Kalendari nga Cilësimet → Modulet. Pa migrimin, faqja shfaq një njoftim dhe nuk pretendon të ruajë takime.

Nga Shërbimet shto emrin, përshkrimin, kategorinë opsionale dhe çmimin (fiks, duke filluar nga, ose sipas kërkesës). Aktivizo “Lejo rezervim me orar” për shërbimet që rezervohen dhe përcakto kohëzgjatjen dhe pushimin pas takimit. Butoni Rezervo hap kalendarin me shërbimin e zgjedhur. Shërbimet pa rezervim përdoren nga Agjenti për informacion, pa kërkuar orar. Përshkrimet ekzistuese nga njohuritë migrohen në katalog; shërbimet ekzistuese të kalendarit mbajnë identifikuesit dhe rezervimet e tyre. Ndryshimet sinkronizojnë njohuritë e Agjentit brenda të njëjtit transaksion.

Opsionalisht vendos orar të veçantë për një shërbim; ai kufizon orarin e biznesit dhe përdor zonën kohore të tij. Disponueshmëria kontrollohet si në propozimin e orarit ashtu edhe në databazë gjatë ruajtjes. Pa orar të veçantë, përdoret orari i biznesit. Nga Kalendari → Konfigurimi Përcakto zonën kohore IANA, intervalet e punës (mund të shtosh dy intervale për pushimin e drekës) dhe ditët e mbyllura në format YYYY-MM-DD. Kalendari aktual pranon një takim për biznes në të njëjtën kohë; kalendarë paralelë për operatorë ose burime të ndryshme nuk janë ende të përfshirë.

Rezervimet në pritje dhe të konfirmuara zënë orarin. Anulimi e liron. PostgreSQL e ndalon mbivendosjen edhe për kërkesa konkurrente; koha e pushimit është pjesë e intervalit të zënë. Ndryshimet kontrollojnë revision për të mos mbishkruar një redaktim tjetër. Ora duhet të jetë në të ardhmen, brenda 90 ditëve. Orët lokale të paqarta ose që nuk ekzistojnë gjatë ndryshimit sezonal të orës refuzohen.

## Google Calendar

Në Google Cloud aktivizo Calendar API dhe krijo një OAuth client të tipit Web application. Vendos:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI=https://agjenti.app/api/calendar/google/callback`
- `NEXT_PUBLIC_APP_URL=https://agjenti.app`
- `TOKEN_ENCRYPTION_KEY` (çelësi ekzistues i enkriptimit)

Regjistro të njëjtën redirect URI në Google. Gjatë testimit, shto përdoruesit testues të OAuth consent screen. Për publikim, përfundo kërkesat e Google për verifikimin e lejeve të Calendar. Mos vendos çelësat në Git.

Lidhja nis vetëm nga formulari i biznesit të autorizuar. State është i lidhur me session user, biznesin dhe një cookie HttpOnly të enkriptuar me afat 10 minuta. Callback kontrollon përsëri anëtarësinë dhe modulin. Refresh/access tokens ruhen të enkriptuara; tabela e kredencialeve nuk lejon lexim nga klienti Supabase i browser-it.

Kërkohen lejet `calendar.events`, `calendar.events.freebusy` dhe `calendar.calendarlist.readonly`. Pas lidhjes, biznesi zgjedh një kalendar me rol owner/writer. Nuk përdoret automatikisht kalendari personal kryesor. Shkëputja fshin tokenët lokalë dhe ruan ngjarjet në Google; rilidhja përdor të njëjtin kalendar për të mos humbur lidhjen me takimet e eksportuara.

Orari i zënë në Google kontrollohet para rezervimit. Vetëm takimet e konfirmuara eksportohen; ora e përfundimit në Google përfshin pushimin pas shërbimit. Takimet ndryshohen/anulohen nga paneli. Nuk importojmë titujt ose të dhënat e ngjarjeve të tjera në databazë dhe nuk trajtojmë ndryshimin nga Google të një takimi të Agjentit si ndryshim të rezervimit lokal. Ngjarjet e tjera në Google vetëm bllokojnë disponueshmërinë. Kontrolli ndaj Google dhe krijimi i ngjarjes janë kërkesa të ndara; nuk mund të garantohet transaksion atomik me redaktime që ndodhin njëkohësisht drejtpërdrejt në Google.

Sinkronizimi përdor ID deterministe për çdo rezervim dhe lease dyminutëshe në databazë. Nëse Google dështon, rezervimi mbetet në panel me status sinkronizimi që kërkon riprovim. Butoni “Riprovo Google” riprovon të njëjtën ngjarje; nuk krijon kopje. Nuk ka ende worker periodik për riprovim ose webhook për sinkronizim në sfond.

## Rezervimet nga biseda

Janë të fikura si parazgjedhje. Aktivizo “Lejo Agjentin të marrë rezervime nga biseda” vetëm pasi të kesh përcaktuar shërbimet dhe orarin. Mënyra “Me miratim nga biznesi” ruan kërkesë në pritje; mënyra automatike konfirmon pas konfirmimit të klientit.

Interpretimi me AI nxjerr vetëm detajet e kërkesës; nuk ka qasje në veprime. Adapteri verifikon shërbimin dhe orarin, paraqet përmbledhjen dhe kërkon një përgjigje të qartë “Konfirmoj”. Drafti skadon pas 30 minutash. Ruajtja e kërkesës ka çelës idempotence të lidhur me bisedën; orari verifikohet përsëri në momentin e konfirmimit. RPC kontrollon sërish në databazë aktivizimin dhe mënyrën manuale. Ndryshimet/anulimet e rezervimeve ekzistuese bëhen nga biznesi në panel.

Provo Agjentin dhe Chat Lab përdorin adapterin në mënyrën `test`: konfirmimi simulohet, pa rezervim real, ngjarje Google ose mesazhe reale.

## Verifikimi

Testet Vitest mbulojnë zona kohore/DST, intervale, pushime, qasje të biznesit, konfirmim eksplicit, mënyrën provë dhe dështimet e Google. `supabase/tests/calendar_bookings.sql` është test transaksional për databazë të izoluar: mbivendosje, pushim, idempotence, revision, pronësi e shërbimit, ditë të mbyllura dhe anulim. Është verifikuar edhe me PostgreSQL lokal të përkohshëm (PGlite me btree_gist), pa lidhje me databazën e prodhimit.

`supabase/tests/business_services.sql` verifikon rezervimin opsional, lidhjen e takimit me shërbimin, orarin e shërbimit, sinkronizimin e njohurive dhe anulimin pas çaktivizimit. Migrimi dhe ruajtja e shërbimeve ekzistuese janë provuar në PostgreSQL lokal të izoluar; migrimet nuk janë aplikuar në prodhim.
