# Agjenti.app

Platformë qendrore e suportit me AI për Instagram. Zana Store është një biznes i lidhur me API.

## Stack

Next.js 15, React 19, TypeScript, Tailwind, Supabase, Vitest. Deploy: Vercel, domain `agjenti.app`.

## Fillimi lokal

1. Krijo një projekt të ri Supabase (i ndarë nga Zana).
2. Ekzekuto migrimet në `supabase/migrations/` sipas rendit kronologjik.
3. Kopjo `.env.example` te `.env.local`.
4. Shto rreshtin tënd te `platform_admins` pas regjistrimit të parë.
5. `yarn install && yarn dev` (gjithmonë porti `3003`).

## Env

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (`http://localhost:3003` lokal, `https://agjenti.app` në prod)

Auth (Supabase → Authentication → URL Configuration):

- **Site URL** = `https://agjenti.app` (jo localhost)
- **Redirect URLs** = `https://agjenti.app/**`, `https://www.agjenti.app/**` dhe `http://localhost:3003/**`

Google / Gmail login (Supabase → Authentication → Providers → Google):

1. Në [Google Cloud Console](https://console.cloud.google.com/) krijo OAuth Client ID (Web).
2. Authorized JavaScript origins: `https://agjenti.app`, `https://www.agjenti.app`, `http://localhost:3003`
3. Authorized redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
4. Vendos Client ID + Client Secret te Supabase Google provider dhe aktivizoje.
5. `NEXT_PUBLIC_APP_URL` në Vercel duhet të jetë saktësisht domain-i publik (p.sh. `https://www.agjenti.app`) — i njëjti origin ku përdoruesi hap login-in, që cookie e sesionit të përputhet.
6. Redirect URLs në Supabase Auth duhet të përfshijnë `https://www.agjenti.app/auth/callback**` (dhe variantin pa www nëse e përdorni).

Apple login (Supabase → Authentication → Providers → Apple):

1. Në [Apple Developer](https://developer.apple.com/account) → Identifiers krijo një **App ID** me “Sign in with Apple”.
2. Krijo një **Services ID** (p.sh. `app.agjenti.web`) dhe aktivizo Sign in with Apple.
3. Configure → Domains: `<PROJECT_REF>.supabase.co` · Return URL: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
4. Keys → krijo një key me “Sign in with Apple”, shkarko `.p8` (vetëm një herë) dhe ruaj Key ID + Team ID.
5. Në Supabase Apple provider: Client IDs = Services ID (i pari në listë), pastaj Secret Key (JWT nga `.p8` / generatori i Supabase). Aktivizo.
6. Secret Key skadon çdo **6 muaj** — rinovoje përpara skadimit ose login-i Apple ndalon së funksionuari.
7. Testo `/auth/apple` (butoni “Vazhdo me Apple” te `/login`).

- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (Instagram App ID/Secret nga Meta → Instagram, jo Facebook App ID)
- `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
- `INSTAGRAM_OAUTH_REDIRECT_URI` = `https://agjenti.app/api/instagram/oauth/callback`
- `TOKEN_ENCRYPTION_KEY` (64 hex ose frazë e gjatë)
- `OPENAI_API_KEY`, `AGENT_MODEL` (parazgjedhje `gpt-5.6-luna`)
- `CRON_SECRET`
- Katalogu/porositë e jashtme: URL + API key për biznes te Cilësimet; te sajti i biznesit `AGJENTI_APP_SECRET`

Webhook Meta: `https://www.agjenti.app/api/webhooks/meta`  
(Përdor **www** — `agjenti.app` pa www kthen 308 redirect dhe Meta nuk dorëzon DM reale.)

Meta App Dashboard → Settings → Basic:

- Privacy Policy URL: `https://agjenti.app/privacy`
- Terms of Service URL: `https://agjenti.app/terms`
- User data deletion → **Data deletion instructions URL**: `https://agjenti.app/data-deletion`

Meta App Dashboard (Instagram / callbacks):

- Deauthorize Callback URL: `https://agjenti.app/api/meta/deauthorize`
- Data Deletion Request / Callback URL: `https://agjenti.app/api/meta/data-deletion`
- Status check (auto-returned to Meta): `https://agjenti.app/api/meta/data-deletion?code=<confirmation_code>`

## Cutover Instagram

1. Në Zana, fik `instagram_messaging_enabled`.
2. Në Meta, kthe webhook-un te Agjenti.
3. Testo një DM.

Inbox-i fillon bosh. Historia e Zana-s mbetet arkiv.

## Panelet

- `/auth/continue`: ridrejton adminin te `/admin` dhe klientin te biznesi ku ka qasje. `/app` është hequr.
- `/onboarding`: krijimi self-service i biznesit për përdoruesit pa anëtarësi. `/account` ridrejton te destinacioni sipas rolit.
- `/login`: hyrje, regjistrim dhe kërkesë për rikuperimin e fjalëkalimit.
- `/auth/reset-password`: ndryshimi i fjalëkalimit pas lidhjes së rikuperimit.

Në Supabase Auth, Redirect URLs duhet të lejojnë URL-në e aplikacionit me `/auth/callback` (përfshirë query-n e rikuperimit). Dërgimi i email-eve varet nga konfigurimi i email/SMTP në Supabase.

- `/admin`: përmbledhje e platformës; `/admin/businesses` për bizneset dhe anëtarët; `/admin/conversations` për bisedat dhe lidhjet Instagram.
- `/b/[slug]`: dashboard i biznesit; nënfaqet për Inbox, produkte, porosi, klientë, agjentë, njohuri, workflow, Instagram dhe cilësime.

Panelet përdorin skemën ekzistuese. Workflow-t lidhen me llojin e produktit. Numrat e dashboard-it janë totalet reale; grafiku paraqet krijimet për 7 ditët e fundit, me kufij ditorë UTC. Listat e klientëve, porosive dhe bisedave të adminit ngarkojnë deri në 1 000 rreshta; Inbox-i ngarkon 100 bisedat dhe 200 mesazhet më të fundit. Kërkimi dhe faqezimi veprojnë mbi listën e ngarkuar.

Në tabelën e produkteve, lloji, workflow-i dhe statusi ndryshohen me dropdown dhe ruhen automatikisht. Aktivizimi kërkon çmim, lloj aktiv dhe workflow të biznesit; gabimi shfaqet te rreshti përkatës. Heqja e llojit ose workflow-it nga një produkt aktiv e kalon në draft. Ruajtja kontrollon versionin e produktit që të mos mbishkruajë ndryshime të bëra ndërkohë. Ky funksion përdor skemën ekzistuese, pa migrim të ri.

Planet/faturimi, Facebook/WhatsApp, statistikat e Instagram-it, transporti/pagesat, variantet e produkteve dhe CRM me etiketa/shënime mbeten për fazën tjetër. Nuk shfaqen si funksione aktive ose statistika të simuluara.

Fontet Figtree dhe Syne ruhen në `src/app/fonts` bashkë me licencat OFL, pa shkarkim gjatë build-it.

Kontrolle: `yarn lint`, `yarn test`, `yarn build`.

## Onboarding self-service

Apliko `supabase/migrations/20261003090000_self_service_onboarding.sql` në Supabase përpara aktivizimit të këtij versioni. Pa migrimin, onboarding shfaq një gjendje të rikuperueshme pa kryer krijime të pjesshme. Ky migrim nuk ndryshon bizneset ekzistuese.

Pas regjistrimit dhe konfirmimit të email-it (kur kërkohet nga Supabase), `/auth/continue` dërgon adminët te `/admin`, anëtarët ekzistues te biznesi i tyre dhe përdoruesit e rinj te `/onboarding`. Rrjedha fillestare kërkon vetëm emrin, krijon biznesin atomikisht dhe hap `/b/[slug]/setup` për lidhjen e Instagram-it dhe analizën automatike. Alternativa manuale/audio është `/onboarding?manual=1`: lloji i biznesit filtron ofertat, oferta filtron qëllimet, ndërsa qëllimet krijojnë listën e aftësive të Agjentit. Draftet e pyetësorit ruhen kur shtypet Vazhdo, Prapa ose Ruaj për më vonë; përparimi tregon vetëm hapat e vlefshëm.

`business_onboarding` ruan përgjigjet dhe lidhjen me biznesin. Fusha `answers.businessProfile` përmban llojin e biznesit, ofertat, qëllimet, aftësitë e zgjedhura dhe konfigurimin e rekomanduar (qëllimet/aftësitë fillestare, workflow dhe checklist). Rules layer qendror gjendet te `src/lib/onboarding/rules.ts`; UI dhe validimi server-side përdorin të njëjtat rregulla. Kur ndryshohet një përgjigje e mëparshme, zgjedhjet e varura që nuk vlejnë pastrohen; profili përfundimtar llogaritet sërish në server dhe nuk besohet nga klienti. RPC-të janë vetëm për service role; server action merr identitetin nga sesioni i verifikuar dhe validon përgjigjet me allow-list. Një lock mbi profilin serializon draftet, tab-et dhe kërkesat e përsëritura. Krijimi i biznesit, rolit owner, agjentit dhe shënimi i përfundimit kryhen në një transaksion. Një anëtarësi e caktuar ndërkohë nga administratori përdoret pa krijuar një biznes tjetër.

Katalogu fillon bosh, `auto_reply=false` dhe agjenti fillestar joaktiv. Preferencat për AI-në përgatisin udhëzimet, pa premtuar funksione të paimplementuara si gjenerimi i drafteve për miratim. Nuk krijohen produkte ose politika të sajuara. Workflow vazhdon të lidhet me llojin e produktit. Checklist-i në dashboard përdor gjendjen reale të Instagram-it, katalogut, njohurive, agjentit, bisedave dhe workflow-ve. Madhësia e ekipit dhe vëllimi i mesazheve ndryshojnë vetëm këshillat; anëtarët shtohen nga mekanizmi ekzistues i adminit. Preferencat nuk përdoren për autorizime ose kufij funksionesh; konfigurimi operacional ndryshohet nga panelet ekzistuese.

Kontrolle: `npm test`, `npm run lint`, `npm run build`. `supabase/tests/self_service_onboarding.sql` provon draftet, idempotencën, caktimin e pronarit, kufizimin e RPC-ve dhe rollback-un; ekzekutohet vetëm në databazë të izoluar testimi pas migrimeve dhe bën rollback.

## Provo Agjentin (Test Chat)

Hyr si anëtar i biznesit ose Platform Admin. Në panelin e biznesit hap **Agjenti AI → Provo Agjentin**, ose `/b/<slug>/agents/test` (lokalisht `http://localhost:3003/b/<slug>/agents/test`, në prodhim `https://agjenti.app/b/<slug>/agents/test`). Nuk kërkon lidhje Instagram, webhook apo Meta Live.

1. Ruaj udhëzimet dhe aktivizo agjentin që dëshiron të provosh; nuk është e nevojshme të aktivizosh dërgimin automatik të biznesit.
2. Shto produkte në katalogun e biznesit, njohuri aktive dhe, nëse duhen, lidh llojet e produkteve me workflow-t ekzistuese.
3. Shkruaj si klient. Për të zgjedhur produktin, fillo me emrin e tij të saktë nga katalogu. Vazhdo me madhësinë, ngjyrën ose të dhënat që kërkon workflow. **Simulo foto** kalon vetëm sinjalin e fotos, pa ngarkim apo analizë imazhi.
4. Shiko hapin aktual, gjendjen e mbledhur, modelin, burimin e përgjigjes, workflow-n dhe response ID te paneli i diagnostikimit. **Rifillo** pastron bisedën, gjendjen dhe kontekstin AI, përfshirë rezultatet e një kërkese ende në proces.

Për demo në Meta App Review, shfaq konfigurimin e biznesit dhe më pas disa mesazhe prove nga kjo faqe. Etiketa “SESION PROVE” e dallon qartë nga Inbox-i. Kjo demonstron sjelljen e agjentit; nuk provon autorizimin, webhook-et ose dorëzimin e mesazheve të Meta dhe nuk zëvendëson verifikimin e integrimit real.

Simulatori dhe webhook-u thërrasin të njëjtin `processAgentTurn`: produktet nga tabela `products` e biznesit (përfshirë produktet linked të ruajtura aty), agjentin aktiv, deri në 12 njohuri aktive sipas `sort_order`, workflow-n dhe `generateAgentReply`. Katalogët e jashtëm nuk shkarkohen nga simulatori; kjo është e njëjta sjellje si rrjedha reale. Vetëm `handleInboundMessage` ruan bisedën/gjendjen dhe thërret `sendInstagramText`. Simulatori nuk shkruan në Inbox, `conversation_states`, porosi apo log-e të mesazheve, dhe nuk thërret Meta.

Mesazhet dhe gjendja mbahen në memorie në klient. Konteksti i sesionit është i enkriptuar me `TOKEN_ENCRYPTION_KEY`, i lidhur me përdoruesin/biznesin dhe i verifikuar në çdo kërkesë; skadon pas një ore pa aktivitet ose pas 40 mesazhesh. Ndryshimi i biznesit, rifreskimi i faqes ose **Rifillo** fillon sesion të ri. `OPENAI_API_KEY` aktivizon përgjigjet AI; mungesa e tij ose gabimet e ofruesit shfaqen si përgjigje rezervë, jo si sukses AI. Teksti dhe konteksti dërgohen te OpenAI sipas të njëjtave rregulla si përgjigjet reale; mungesa e ruajtjes në Inbox nuk do të thotë mungesë përpunimi/ruajtjeje nga ofruesi AI. Përdor të dhëna shembull.

Nuk kërkohet migrim i ri i databazës për Test Chat. Testet mbulojnë pipeline-n e përbashkët, transportin real, turnet e shumëfishta, autorizimin, izolimin e sesionit, reset-in dhe fallback-un.

### Cilësimet App për administratorin

Hap `/admin/app` (menuja **App**). Cilësimet ruhen në `app_settings` dhe lexohen në server; vetëm administratorët e platformës mund t’i ndryshojnë. Apliko migrimin `supabase/migrations/20261004100000_app_settings.sql` përpara ruajtjes së parë. Pa migrimin, leximet mbajnë sjelljen ekzistuese, ndërsa ruajtja shfaq gabimin e migrimit.

- **Konfigurimi automatik:** kur është i fikur, përdoruesit pa biznes japin vetëm emrin dhe kalojnë në panel. Nuk niset analizë automatike nga callback-u Instagram. Përdoret funksioni atomik `complete_business_onboarding`; pronësia dhe mbrojtja nga krijimi i dyfishtë ruhen, agjenti dhe përgjigjet automatike nisin të fikura.
- **Hapat e konfigurimit:** shfaq ose fsheh checklist-in për bizneset e regjistruara vetë, pa ndryshuar lejet.
- **Njoftimi:** tekst deri në 500 karaktere në panelet e bizneseve; bosh e heq.

Ndryshimet zbatohen kur hapet ose rifreskohet faqja. Një pyetësor i hapur më parë rishikon cilësimin në server gjatë ruajtjes. `updated_by` dhe `updated_at` regjistrojnë ndryshimin e fundit.

### Përmirësimet e performancës

- Auth, anëtarësitë dhe cilësimet App ripërdoren me React `cache` vetëm brenda një kërkese server-render; nuk ruhen globalisht ndërmjet përdoruesve ose kërkesave.
- Faqet publike dhe callback-et me verifikimin e tyre nuk bëjnë kërkesë shtesë te Supabase Auth në middleware. Faqet e mbrojtura dhe hyrja ruajnë kontrollin/rifreskimin e sesionit.
- Apliko `supabase/migrations/20261004110000_dashboard_performance.sql` për RPC `dashboard_stats` dhe indekset. Statistikat e dashboard-it përdorin 1 kërkesë HTTP në vend të 20–21; dy listat e shkurtra ngarkohen paralelisht me statistikat. Funksioni SQL është i aksesueshëm vetëm nga service role pas authz në faqet server. Pa migrimin përdoren përkohësisht numërimet e mëparshme të sakta.
- Klientët përdorin kërkim në server dhe 25 rreshta për faqe, pa kufirin e vjetër prej 1,000 klientësh në listën e ngarkuar. Kërkimi dërgohet me butonin Kërko/Enter.
- Katalogu lokal, llojet e produkteve dhe katalogu i jashtëm ngarkohen paralelisht. Navigimi ka loading boundaries; checklist-i nuk bllokon statistikat. Listat e bisedave dhe zgjedhësi i bizneseve nuk bëjnë prefetch masiv.

Për matje përdor production build (`npm run build`, `npm run start`), jo dev mode. Krahaso Network/TTFB dhe madhësinë e RSC payload me të njëjtin përdorues e dataset; provo klientët me mbi 1,000 rreshta, kërkimin dhe kalimin midis dy bizneseve. Testet mbulojnë parametrat e tenant-it në statistika, fallback gjatë migrimit, pagination dhe ruajtjen e kontrolleve në middleware. Migrimi SQL duhet verifikuar në databazën e synuar; nuk aplikohen ndryshime automatikisht në prodhim.

### Konfigurimi progresiv i biznesit

Apliko `supabase/migrations/20261004120000_business_setup.sql` për rrjedhën e re. Çdo biznes merr pesë hapa të nxjerrë nga konfigurimi real: Instagram, produkte, agjent aktiv me udhëzime, workflow të lidhura sipas llojit, dhe test. Pyetësori personalizon udhëzimet; çaktivizimi i tij nuk anashkalon gatishmërinë. `checklist_enabled=false` shfaq një shirit kompakt, por nuk fsheh kërkesën për Instagram ose zgjedhjen përfundimtare manuale/automatike.

- Produkte: të paktën një produkt me emër, çmim dhe monedhë. Çdo produkt në katalog duhet të lidhet me një lloj të biznesit dhe workflow me hapa, me mbledhjen e të dhënave të klientit si hap final. Lidhja dhe çmimi mund të ndryshohen te Produktet.
- Prova: nga Agjenti AI → Provo Agjentin, nis sesion të ri, zgjidh produktin me emrin e saktë dhe përfundo workflow-n deri te `order_ready`, me të katër fushat e klientit. Përdor të dhëna prove. Çdo përgjigje duhet të vijë nga AI e konfiguruar; fallback-i nuk certifikon testin. Testi mund të bëhet pa Meta Live dhe pa Instagram të lidhur, por fillimi i përdorimit real kërkon lidhjen.
- Ruhet vetëm fingerprint-i i konfigurimit dhe data e provës në `business_setup`, jo mesazhet, klientët ose porositë e simuluara. Ndryshimet në katalog, agjent, njohuri ose workflow kërkojnë një provë të re. Një editim gjatë sesionit kërkon Rifillo. Shkëputja/rilidhja e Instagram-it nuk fshin provën ose konfigurimin.
- Kur pesë hapat përfundojnë, zgjedhja manuale/automatike kalon dashboard-in në statistika. `launch_business` rikontrollon gatishmërinë në DB. Aktivizimi nga Cilësimet dhe rifillimi AI në Inbox kanë gjithashtu kontroll server-side. Bizneset tashmë të aktivizuara nuk fiken automatikisht nga ndryshime në konfigurim; marrin sugjerim për ritestim.
- UI ruan navigimin e lirë. Në mobile shfaqet fillimisht hapi aktual, me listën e hapave të palosur. Progresi rifreskohet pas ruajtjes dhe kur kthehesh nga skeda e autorizimit Instagram.

Pa migrimin shfaqet njoftim i qartë; nuk pretendohet se konfigurimi ose aktivizimi u ruajt.


### Onboarding me audio

Në `/onboarding?manual=1`, përdoruesit e rinj mund të zgjedhin “Na trego shkurt për biznesin tënd” ose të vazhdojnë manualisht. Regjistrimi përdor mikrofonin e browser-it (HTTPS ose localhost), zgjat deri në dy minuta dhe mbështet WebM/Opus dhe MP4 në browser-at përkatës. Audioja mund të dëgjohet dhe të regjistrohet përsëri para dërgimit. Nëse mikrofoni ose AI nuk janë të disponueshëm, pyetësori manual vazhdon të funksionojë.

**Aktivizimi:** apliko `supabase/migrations/20261006090000_audio_onboarding.sql`. Përdoret `OPENAI_API_KEY`; `ONBOARDING_TRANSCRIPTION_MODEL` ka default `gpt-4o-mini-transcribe`, kurse `ONBOARDING_EXTRACTION_MODEL` përdor modelin ekzistues të agjentit kur lihet bosh. Modeli i analizës duhet të mbështesë Responses API me strict JSON Schema. Kontratat ndjekin dokumentacionin zyrtar për [transkriptimin](https://developers.openai.com/api/docs/guides/speech-to-text) dhe [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

`POST /api/onboarding/audio` verifikon sesionin, origjinën, mungesën e një anëtarësie ekzistuese, cilësimin e onboarding-ut dhe formatin/madhësinë e audios. Kufiri është 3 MiB për regjistrim, 12 tentativa në 24 orë për llogari dhe një analizë aktive. Kufiri i kërkesave zbatohet atomikisht në databazë; një lease i braktisur skadon pas tre minutash. Audioja nuk ruhet në storage: dërgohet për transkriptim, pastaj lirohet nga memoria e kërkesës. Ruajtja/përpunimi nga ofruesi AI i nënshtrohet konfigurimit dhe politikave të tij.

`onboarding_audio_attempts` ruan transkriptin, daljen e strukturuar, profilin para/pas analizës dhe identifikuesin e përgjigjes. Transkripti ruhet edhe nëse analiza pasuese dështon. Leximi lejohet vetëm për pronarin dhe shkrimi vetëm për service role; fshirja e onboarding-ut ose e profilit fshin edhe historikun audio. `answers.audioReview` ruan confidence, fushat e konfirmuara dhe korrigjimet manuale. `answers.confirmedProfile` llogaritet në server vetëm gjatë përfundimit. Produktet e përmendura janë përshkrime, jo rreshta të krijuar në katalog.

AI prodhon një ndryshim të pjesshëm të profilit, vetëm me identifikuesit nga rules layer-i ekzistues. Çdo fakt kërkon një citim nga transkripti i ri; fushat e papërmendura mbeten null. Confidence është vlerësim i modelit, jo probabilitet i kalibruar. Audioja shtesë bashkon listat dhe plotëson tekstin pa zëvendësuar korrigjimet manuale. Të dhënat kalojnë përsëri në rregullat kushtore; rekomandimet gjenerohen në kod. Fushat me confidence nën 0.8 kërkojnë konfirmim individual, konfliktet kërkojnë korrigjim dhe krijimi i biznesit kërkon rishikimin përfundimtar. Një draft i ndryshuar në një tab tjetër nuk mbishkruhet nga një analizë e vonuar.

Kontrollo në desktop dhe mobile: audio → dëgjo → analizo → korrigjo/sqaro → konfirmo; provo edhe refuzimin e mikrofonit, një regjistrim plotësues, rifreskimin e faqes dhe kalimin në manual. Testet me Vitest mbulojnë auth, upload-et, kufijtë, bashkimin, të dhënat e panjohura, provat nga transkripti dhe konfirmimin. `supabase/tests/audio_onboarding.sql` teston izolimin dhe ruajtjen atomike në një databazë testimi; nuk duhet ekzekutuar në prodhim.

### Konfigurimi nga Instagram-i, fotot dhe website-i

Onboarding-u përgatit kontekstin e biznesit automatikisht: emri → lidhja Instagram → analiza në background → paneli. Apliko migrimet ekzistuese, pastaj `supabase/migrations/20261008150000_context_onboarding.sql`, përpara deploy-it. Ky migrim varet nga `20261008120000_scan_knowledge_routing.sql` dhe `20261008090000_agent_training.sql`. Në Supabase, ekzekuto skedarin e ri në SQL Editor; skedari i testeve më poshtë është vetëm për databazë të izoluar.

Postimet, bio, fotot dhe faqet publike përdoren për të kuptuar aktivitetin, audiencën, kontaktet, politikat dhe pyetjet e zakonshme. Onboarding-u nxjerr vetëm profil dhe njohuri; nuk importon produkte, çmime, stok, shërbime, workflow apo komanda të Agjentit. Njoftimet, përshëndetjet dhe ofertat e përkohshme nuk duhen kthyer në njohuri të përhershme. Produktet dhe të dhënat e paqarta për katalogun plotësohen më vonë te Produktet, duke përdorur rrjedhën e importit/shqyrtimit.

Te `/b/[slug]/setup`, analiza hap një dialog me karusel të postimeve reale dhe progres nga checkpoint-i. Mund të minimizohet pa ndalur worker-in. Faza vizuale rrotullon grupin aktual prej 5 fotosh; website-i shfaq tituj dhe fragmente. Rrotullimi mund të ndalet dhe respekton `prefers-reduced-motion`. Rezultati tregon llojin e biznesit, numrin e njohurive dhe kalimin direkt në panel. Nuk kërkon përzgjedhje elementesh apo konfirmim. Detajet janë të mbyllura fillimisht; njohuritë kontrollohen më vonë në modulin e tyre dhe modulet ndryshohen te Cilësimet.

Website-i është opsional; kur Instagram API kthen një link profili, worker-i e vendos automatikisht në radhë pas analizës së Instagram-it. Bio/website varen nga fushat që lejon API dhe dështimi i metadata-s nuk bllokon postimet. Analiza lexon deri në 100 postime dhe përzgjedh deri në 25 foto nga postimet e fundit, historia dhe carousel-et, në grupe prej 5. Fotot dërgohen si `input_image`; videot përdorin thumbnail. Website-i lexon deri në 8 faqe publike dhe 65,000 karaktere me kontrollet ekzistuese kundër URL-ve private dhe redirect-eve të pasigurta. Preview-t kufizohen në 25 foto / 8 faqe, vetëm për përdorues me qasje në biznes; kredencialet dhe kapja e plotë nuk ekspozohen.

Përfundimi ruan njohuritë, profilin e gjeneruar dhe udhëzimet bazë në një transaksion me lease dhe revision. Njohuritë kundërshtuese ruhen joaktive për kontroll të mëvonshëm; informacioni i munguar nuk bllokon kalimin në panel. Vetëm Agjenti fillestar i papërshtatur ripërdoret; Agjentët ekzistues dhe ndryshimet manuale gjatë skanimit ruhen. Përshkrimet e burimit ruhen si njohuri, jo si udhëzime të besuara. Modulet e zgjedhura manualisht dhe përjashtimet ekzistuese të njohurive respektohen. Batch-et e mbetura nga skanime të mëdha ose të vjetra ruhen automatikisht gjatë ndjekjes së progresit.

`business_discovery` ruan draftin, klasifikimin dhe versionet; `business_discovery_jobs` ruan fazat/checkpoint-et. `confirmed_at` shënon përgatitjen automatike për këtë rrjedhë, jo një konfirmim njerëzor. Punët kanë lease 3-minutëshe, token që pengon shkrimet nga një worker i vjetër, tri prova për fazë dhe kufi 12 analiza/24h/biznes. Një grup fotosh që dështon pas tri provash kapërcehet me njoftim, duke ruajtur tekstin dhe fotot e tjera. Ndryshimi i lidhjes Instagram ose URL-së zëvendëson punën e vjetër. Rezultati regjistrohet edhe në historikun Business Intelligence.

Callback-u OAuth dhe kërkesat e panelit nisin worker-in përmes `after()`. Faqja vazhdon automatikisht punët në pritje gjatë ndjekjes së progresit; checkpoint-et ruhen për vazhdimin kur faqja hapet sërish. `vercel.json` përfshin `/api/cron/business-discovery` çdo ditë në orën 03:00 UTC, të pajtueshme me Vercel Hobby. Konfiguro `CRON_SECRET` dhe një platformë/plan që mbështet funksione 180-sekondëshe. Për vazhdim më të shpeshtë pa browser, përdor scheduler të jashtëm me `Authorization: Bearer <CRON_SECRET>` ose një plan që mbështet intervalin e dëshiruar.

Përdoret `OPENAI_API_KEY`. `BUSINESS_DISCOVERY_MODEL` dhe `BUSINESS_VISION_MODEL` përdorin `AGENT_MODEL` kur lihen bosh. Modeli vizual duhet të mbështesë imazhe dhe strict JSON Schema. API-ja kërkon sesion dhe qasje në biznes, origjinë të njëjtë dhe request deri në 512 KB.

Përgjigjet automatike mbeten një hap opsional brenda onboarding-ut. Përdoruesi mund ta provojë Agjentin dhe ta aktivizojë pasi të kryhen kontrollet ekzistuese. Një biznes vetëm me njohuri mund ta provojë/aktivizojë pa produkt apo workflow artificial; bizneset me produkte ruajnë kontrollet e konfigurimit dhe provën e porosisë. Analiza nuk certifikon një test dhe nuk aktivizon dërgimin e mesazheve.

Verifikim: `yarn test`, `yarn build`. `supabase/tests/context_onboarding.sql` mbulon përgatitjen automatike, rollback-un, idempotencën, izolimin, ndryshimet gjatë analizës dhe aktivizimin me njohuri pa produkte. Testet e tjera SQL mbulojnë radhën dhe routing-un; ekzekutohen vetëm në databazë testimi dhe bëjnë rollback. API/modeli dhe prova e browser-it përdorin përgjigje të simuluara; OAuth, lejet Meta dhe daljet reale AI duhen provuar me një llogari biznesi pas konfigurimit të ambientit.

### Profili dhe rrjedha e biznesit nga analiza

Pas migrimit të onboarding-ut, apliko `supabase/migrations/20261008160000_business_process.sql`. Emri, username, bio, fotoja dhe URL-ja kërkohen nga llogaria Instagram e lidhur. Nëse Meta refuzon një fushë opsionale, fushat e tjera lexohen veçmas; metadata e pjesshme dhe një URL eksplicite në bio përdoren kur janë të disponueshme. Refuzimi i metadata-s nuk bllokon postimet; një bio e lexueshme mund të analizohet edhe kur postimet nuk kthehen. URL-ja e gjetur vendoset automatikisht në radhë për skanimin e website-it. Në onboarding shfaqen profili i rikuperuar dhe URL-ja e plotësuar, pa konfirmim tjetër. Metadata e një lidhjeje/gjenerate të vjetër nuk shfaqet pas rilidhjes.

Skanimi i website-it i jep përparësi faqeve që shpjegojnë porosinë, marrjen e materialeve, transportin, FAQ-të dhe politikat, përpara faqeve të produkteve. Analiza përgatit edhe rrjedhën e klientit dhe e ruan te `business_discovery.operating_workflow`, të ndarë nga workflow-t që ekzekutojnë porosi produktesh. Çdo hap i gjeneruar ka citim dhe referencë të verifikuar kundrejt burimeve. Për një biznes me PDF, vetëm “Shkarko PDF” nuk vërteton pagesën online apo dërgimin e menjëhershëm; hapat e pambështetur lihen jashtë dhe detajet e paqarta mbeten për plotësim më vonë. Mungesa/dështimi i kësaj analize shtesë nuk bllokon përgatitjen e njohurive dhe kalimin në panel.

Te **Workflow**, rrjedha shfaqet si listë hapash me burime të mbyllura fillimisht. Përdoruesi mund të përshtatë emrin, përshkrimin, hapat dhe detajet e paqarta, ose ta çaktivizojë plotësisht. Ruajtja kontrollon qasjen në biznes dhe revision-in; skanimet e tjera nuk mbishkruajnë përshtatjet manuale. Agjenti, Test Chat dhe Chat Lab e marrin këtë rrjedhë si kontekst për shpjegimin e hapit të duhur, jo si komanda të besuara ose autorizim për pagesa, porosi apo shkarkime. Workflow-i i një produkti mbetet autoritativ për ekzekutimin e porosisë. Ndryshimi/çaktivizimi i rrjedhës ndryshon fingerprint-in e provës së Agjentit.

Metadata, njohuritë, profili dhe rrjedha përfundojnë atomikisht nën lease/revision. Nëse migrimi mungon, leximi i rrjedhës nga Agjenti bie në kontekstin ekzistues; përfundimi i skanimit kërkon migrimin e ri. `supabase/tests/business_process.sql` mbulon atomicitetin, izolimin, çaktivizimin, konfliktet e versioneve dhe ruajtjen e përshtatjeve gjatë një analize të re. Testet dhe prova vizuale përdorin përgjigje të simuluara; disponueshmëria reale e fushave Meta varet nga API-ja dhe lejet e llogarisë.

### Pasurimi i hapësirës nga onboarding-u

Apliko vetëm `supabase/migrations/20261008170000_onboarding_preparation.sql` pas migrimit `20261008160000_business_process.sql`. Migrimi i ri është i përsëritshëm (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`) dhe nuk riemërton funksionet e statusit. Migrimet e mëparshme nuk duhen ekzekutuar sërish. Testi SQL e verifikon skemën bashkë me skenarët e përgatitjes në databazë të izoluar.

Nxjerrja e kontekstit tani i jep përparësi temave të Njohurive, jo vetëm një përshkrimi të biznesit. Oferta e përgjithshme, audienca, përfitimet, përdorimi, mënyra e kërkesës/porosisë, marrja e materialeve, pagesat dhe orari nxirren veçmas vetëm kur burimi i mbështet. Një titull përshkrues mund të formulohet si etiketë për një citim të verifikuar; nuk kërkohet një pyetje FAQ ose titull identik në postim. Teksti i kapur lexohet në grupe deri në 20,000 karaktere, me progres dhe checkpoint të secilit grup. Kufijtë e kapjes mbeten 100 postime, 25 foto, 8 faqe dhe 65,000 karaktere. Rianaliza e Instagram-it vendos edhe një lexim të freskët të website-it në radhë, pa ripërdorur një skanim të vjetër të përfunduar. Temat e përsëritura bashkohen; njohuritë ekzistuese dhe kundërshtimet ruhen sipas routing-ut ekzistues. Nuk plotësohet një kuotë artificiale njohurish.

E njëjta lidhje **lloji i biznesit → oferta → qëllimet → aftësitë**, nga `onboarding/rules.ts`, përgatit profilin, udhëzimet e Agjentit dhe pikënisjen e rrjedhës. Edhe pa një proces të publikuar krijohet një rrjedhë bisede sipas tipit: sqarimi i nevojës, oferta/informacioni i verifikuar, kërkesa për shërbim ose workflow-i i ofertës kur është konfiguruar dhe hapi tjetër/kalimi te stafi. Hapat e gjetur në burime e pasurojnë këtë pikënisje. Hapat e biznesit nga burimet ruhen te `publishedSteps` dhe shfaqen në një seksion të mbyllur, veç rrjedhës së bisedës. Të dyja mund të përshtaten te Workflow. Në UI dhe në kontekstin e Agjentit, udhëzimet nga onboarding-u dallohen nga informacioni i publikuar; nuk shërbejnë si provë për pagesa, transport, disponibilitet apo konfigurim veprimesh.

`business_discovery.generated_agent` mban ID-në dhe udhëzimet e fundit të gjeneruara. Një burim i dytë mund të pasurojë këtë Agjent vetëm nëse udhëzimet janë ende identike dhe nuk është shtuar një Agjent tjetër aktiv. Korrigjimet manuale, module/seksione të përjashtuara dhe rrjedhat manuale mbeten autoritative. Agjentët ekzistues pa këtë gjurmë nuk përvetësohen si të gjeneruar; konteksti i tyre pasurohet përmes Njohurive dhe rrjedhës. `supabase/tests/onboarding_preparation.sql` verifikon temat e ndara, pasurimin nga burimi i dytë dhe ndryshimet manuale gjatë skanimit. Provat e modelit dhe browser-it janë të simuluara; numri real i njohurive varet nga përmbajtja e burimeve.

### Business Intelligence: collect → review → apply

Apply `supabase/migrations/20261006100000_business_intelligence.sql` after the
existing audio-onboarding migration. `OPENAI_API_KEY` enables source analysis;
manual structured entry works without an AI key. Catalog offers and audio changes
require review before applying. Onboarding prepares business context automatically;
source-backed FAQ can also be routed directly to Knowledge.

“Plotëso me AI” is shared by business settings, products, agents, knowledge and
workflows. Services are available in the same section selector and are applied
as `knowledge_entries` with `intent_key=service`, matching the existing agent
knowledge pipeline. Product website/Instagram entry points and agent-instruction
generation now open this same dialog. CSV and direct manual product forms remain
available.

- `src/lib/business-intelligence/model.ts`: shared entities/facts, provenance,
  explicit conflicts, missing fields and apply validation. Unknown facts are null;
  unsupported fields and unsupported onboarding business types are rejected.
- `ingestion.ts`: reuses the catalog's bounded public URL reader and the existing
  authenticated Instagram media client. Websites read the initial page and up to
  seven relevant same-origin links; this is a bounded scan, not a full-site crawl.
  Instagram analyzes up to the existing media limit using captions and available
  URLs, not private DMs or undocumented profile scraping.
- `normalization.ts`: evidence-backed structured extraction with the existing AI
  model. Source content is untrusted input. No absent prices, policies or sensitive
  facts are invented. Exact source evidence is checked before retaining AI facts.
- `transcription.ts`: shared with onboarding; existing recorder and upload limits
  are reused. Audio bytes are transient. Transcripts and extractions are retained.
- `/api/business-intelligence`: business membership/admin authorization, bounded
  input, 30 source attempts/business/day, concurrent-attempt lock, revision checks.
- Database: `business_intelligence` stores the common draft;
  `business_intelligence_sources` stores source/transcript/extraction history;
  `business_intelligence_revisions` preserves edits and confirmations. RLS isolates
  businesses. A bridge imports confirmed onboarding profiles and audio history
  when a workspace is created, including pre-existing completed onboardings.

Choose a source, add information, expand draft items, edit fields, select items,
resolve conflicting values, then confirm and apply. Additional recordings/scans
fill unknowns and propose conflicts instead of overwriting existing facts. User
confirmation is retained separately from source confidence. “Rilexo të dhënat
aktive” refreshes the baseline if another page changed the catalog or agent.
Applications are atomic and retry-safe by revision; no partial product batch is
committed after failure. No Meta sends occur.

New products are inactive until their existing product form configures type,
workflow and activation. Variants, personalization and customer requirements
remain structured facts in `products.intelligence_details` and readable product
context, without inventing a separate SKU/variant engine. Workflows use existing
supported step kinds and are not automatically linked to products. Services and
policies become existing agent knowledge. New agent records stay inactive; an
existing agent's activation state is preserved. Business profile facts also live
in `businesses.intelligence_profile` for downstream consumers.

Validation: Vitest covers merge/conflicts, extraction boundaries, tenant auth,
review gating and bounded crawl; `supabase/tests/business_intelligence.sql` runs
in an isolated migrated database and checks draft isolation, atomic application,
RLS, stale-write protection and onboarding bridging. Browser smoke uses mocked
API responses, without paid AI requests or production writes.

### Katalogë B2B dhe dokumente

Apliko `supabase/migrations/20261006120000_catalogs.sql` përpara përdorimit.
Migrimi shton `catalogs`, `catalog_sections`, indeksimin me revision/claim dhe bucket-in privat `business-catalogs`.
Nuk krijon produkte dhe nuk ndryshon fingerprint-in e konfigurimit të bizneseve që përdorin vetëm produkte.
Nevojiten `OPENAI_API_KEY`, një `AGENT_MODEL` me mbështetje për PDF + structured output dhe `NEXT_PUBLIC_APP_URL` me origjinën kanonike të aplikacionit. Embeddings përdorin `text-embedding-3-small`, 256 dimensione.

1. Hap **Katalogë → Shto katalog**. Ngarko PDF/TXT/Markdown (deri 10 MB), shto link dokumenti ose skano një website.
2. Te detajet kliko **Plotëso me AI · Indekso dokumentin**. Indeksi ruhet si draft për rishikim: përmbledhje, metadata dhe fragmente me faqe kur burimi është PDF.
3. Kontrollo fragmentet kundrejt dokumentit origjinal, gjuhët, tregjet dhe industritë. Konfiguro **Kur duhet ta përdorë Agjenti?** dhe pyetjet sqaruese. Konfirmo dhe aktivizo.
4. Provo te **Agjenti AI → Provo Agjentin**, pa Meta Live/webhook: “Më dërgo katalogun e pompave industriale”. Përgjigju pyetjes për tregun/gjuhën nëse kërkohet. Debug përmban `retrievedCatalogIds`.
5. Verifiko që një pyetje për SKU/çmim përdor produktet dhe që një dokument joaktiv nuk dërgohet. Test Chat nuk dërgon mesazhe reale.

Skanohet maksimumi 8 faqe website, deri 100,000 karaktere për dokument teksti (65,000 për skanim website), dhe deri 40 seksione për dokument. Ky është indeks selektiv, jo premtim për lexim shterues të katalogëve të mëdhenj. UI tregon mbulimin dhe kufizimet; për materiale të mëdha ndaj dokumentet sipas kategorive. Teksti verifikohet me citime ekzakte; PDF-të kërkojnë rishikim njerëzor të referencave. Për indeksimin e dokumenteve të katalogut nuk mbështeten ende DOCX/XLSX, OCR i dedikuar, import SKU nga PDF apo background jobs (konfigurimi automatik më sipër ka radhën e vet). Analiza e dokumenteve kryhet brenda request-it (180s), me retry pas 5 minutash për procese të ndërprera, maksimumi 10 analiza/orë/biznes dhe 500 dokumente/biznes.

Retrieval përdor cosine similarity të fragmenteve, përputhje teksti/metadata, rregulla të konfirmuara dhe freski. Gjuha/tregu/industria e kërkuar duhet të përputhen me metadata të konfirmuara; vlerat e panjohura nuk konsiderohen automatikisht të përshtatshme. Pyetjet sqaruese ruhen në `conversation_states.collected.fields.catalog_context` (në sesionin e enkriptuar për Test Chat). Një pyetje dokumenti nuk avancon workflow-n e porosisë. Njohuritë renditen sipas pyetjes; shërbimet ripërdorin `knowledge_entries` me `intent_key='service'`, pa tabelë paralele. Për bizneset vetëm me katalogë/shërbime, konfigurimi nuk kërkon produkt ose workflow artificial; testi duhet të marrë një përgjigje AI mbi dokument/shërbim të verifikuar. Bizneset me produkte ruajnë provën e plotë të porosisë.

Dokumentet e ngarkuara janë private deri në aktivizim. Agjenti ndan një link me token të rastësishëm; çaktivizimi e revokon atë. Linku gjeneron URL shkarkimi 60-sekondëshe (një URL e nënshkruar më parë mbetet e vlefshme deri në skadim). Materiali i shkarkuar nga klienti nuk mund të revokohet. URL-të e jashtme hapin burimin origjinal, i cili mund të ndryshojë; riindekso pas ndryshimeve. Riindeksimi çaktivizon dokumentin derisa të konfirmohet sërish. Metadata ekzistuese ruhet; metadata e nxjerrë nga analiza e re shfaqet veçmas për krahasim dhe korrigjim manual.

Verifikimi lokal: `npx vitest run src/lib/catalogs src/lib/conversations src/lib/setup src/lib/agents`; kontrollet SQL/RLS janë në `supabase/tests/catalogs.sql` (transaksion me rollback, për databazë test). Testet e provider-it përdorin mock; bëj një provë reale me dokument të biznesit pasi të aplikosh migrimin dhe konfigurimin.

### Admin Chat Lab / Conversation Debugger

Open `/admin/chat-lab` from the admin sidebar. Search for a business, send test
customer messages, and select a turn or execution stage to inspect Overview,
Context, Workflow, AI / API, Tools / Actions, or chronological Logs. Conversation
Data always shows the latest state, even when an older turn is selected. Below
1100px the inspector opens as a modal drawer. Reset and business changes require
confirmation; Replay restores the encrypted checkpoint before the last turn.

The adapter in `src/lib/chat-lab/actions.ts` authorizes platform admins on **every
request** and invokes the same `processAgentTurn` used by Instagram production
conversations, with `mode: "test"` and `source: "admin_chat_lab"`. It does not invoke
`handleInboundMessage`, onboarding completion, inbox persistence, or external
action handlers. The shared core and catalog retrieval are read-only apart from
AI provider calls. Future mutating tools must remain outside that boundary or
explicitly support mocked test execution before being connected to Chat Lab.

Requires the existing `TOKEN_ENCRYPTION_KEY`; `OPENAI_API_KEY` and `AGENT_MODEL`
behave exactly as in production, including workflow fallback when unavailable.
The test simulator itself needs no migration; the training controls below require
the agent-training migration. Test state uses authenticated encryption, is bound to
admin and business, expires after one hour of inactivity, and permits 40 turns.
The transcript and debug snapshots remain in page memory and disappear on
reload/navigation. Replay may make a new paid provider call and produce a
different answer; it preserves the test conversation ID and turn count. Explicit
training saves are separate authenticated actions that persist business configuration;
ordinary test messages remain read-only.

Traces capture actual requests/responses (including catalog embeddings and
requirements extraction), provider usage when returned, read-only calls, and
measured timestamps. Credentials are redacted before returning debug data.
Normal production calls do not collect these opt-in traces. The reusable
inspector consumes snapshots without performing actions; Live mode is not
implemented.

Current engine limitations are shown explicitly: intent is the existing
product/catalog/general router, services are active `knowledge_entries` with
`intent_key='service'`, and only Instagram channels are currently integrated.
Previous AI messages are linked through `previous_response_id`; no separate
conversation summary/customer-profile load is invented. The engine has no AI
action-tool definitions or autonomous order/booking/payment tools, so the lab
does not manufacture successful tool calls. Workflow required flags are shown
from configuration while production still advances sequentially through steps.

Verification: `npx vitest run` covers admin authorization, cross-tenant/user and
expired/tampered session rejection, replay checkpoints, redaction, failure
traces, and parity with the production core. Authenticated local browser smoke testing covered live AI replies, replay
identity/count, multi-turn customer collection, latest-state modal versus older
selected turns, business-change confirmation/cancellation, and the mobile
inspector at 390px. The tested Zana products use the engine's default customer
collection (no linked workflow), and no active agent instructions were found;
these are exposed as actual configuration diagnostics. Catalog retrieval has
unit coverage; use a confirmed catalog for a provider/database integration test.

### Sesionet e trajnimit: Chat Lab dhe Provo Agjentin

Apliko `supabase/migrations/20261008090000_agent_training.sql` pas migrimeve ekzistuese. Seksioni **Trajno Agjentin** përdoret si te `/admin/chat-lab` ashtu edhe te `/b/[slug]/agents/test`. Çdo përgjigje prove ka lidhjen **Trajno këtë përgjigje**; përdoruesi mund ta vlerësojë si shembull të mirë ose ta korrigjojë, pastaj të konfirmojë **Ruaj mësimin** në dritaren e dedikuar të korrigjimit. Dritarja shfaq gjendjen e ruajtjes dhe suksesin vetëm pasi serveri konfirmon ndryshimin. Vlerësimi ose biseda e zakonshme nuk ruan automatikisht mësime.

Mësimet e ruajtura menaxhohen në faqen **Memoria e Agjentit** (`/b/[slug]/agents/memory`), e arritshme nga të dyja provat dhe konfigurimi i Agjentit AI. Lista ka kërkim, filtra dhe faqe me 15 mësime; nuk ngarkohet apo shfaqet poshtë bisedës së provës.

Memoria ruan preferenca stili, shembuj pyetje/përgjigje dhe udhëzime për një workflow ose hap ekzistues. Preferencat vlejnë për biznesin; shembujt mund të kufizohen te workflow/hapi i zgjedhur. Motori i përbashkët i përgjigjeve lexon memorien në çdo kërkesë, edhe në bisedat reale të Instagram-it. Ruajtja, ndryshimi, aktivizimi/çaktivizimi dhe heqja janë veprime eksplicite; sesioni i provës rifillohet pas një ndryshimi për ta ritestuar konfigurimin. Çmimet dhe të dhënat e klientit nga shembujt nuk konsiderohen fakte për bisedat e reja. Trajnimi përshtat formulimin dhe shpjegimin e hapave; ndryshimet strukturore të procesit bëhen nga konfigurimi ekzistues i workflow-ve.

`agent_training_memories` izolon të dhënat sipas biznesit, deri në 200 mësime. Në çdo përgjigje përfshihen deri në 16 preferenca/udhëzime aktive dhe 4 shembuj relevantë; udhëzimet për hapin/workflow-n kanë përparësi dhe brenda të njëjtit nivel përdoren fillimisht korrigjimet më të reja. Nuk bëhet fine-tuning i modelit dhe nuk mësohet automatikisht nga mesazhet e klientëve. Shembujt dhe udhëzimet dërgohen te provideri AI si pjesë e kontekstit të përgjigjes; përdor të dhëna prove dhe ruaj vetëm përmbajtjen që dëshiron të përdoret më vonë.

Çdo veprim kontrollon sesionin dhe aksesin në biznes. Target-i me ID direkt lejohet vetëm për administratorët e platformës; përdoruesit e biznesit përdorin slug-un me kontrollin ekzistues të anëtarësisë. Workflow-t dhe hapat verifikohen në server dhe në databazë. Feedback-u mban një provë të enkriptuar, të lidhur me përdoruesin, biznesin dhe pyetjen reale të provës, me afat një orë. Versionet parandalojnë mbishkrimet nga ndryshime konkurruese dhe `agent_training_events` ruan historikun e ndryshimeve. RLS lejon vetëm leximin për anëtarët e biznesit ose adminin; shkrimet kryhen nga veprimet e autorizuara të serverit. Ndryshimet në memorien aktive ndryshojnë fingerprint-in e konfigurimit, që një test i vjetër të mos certifikojë preferenca të reja.

Pa migrimin, bisedat ekzistuese vazhdojnë me konfigurimin aktual dhe ruajtja e trajnimit shfaq mesazh për migrimin e munguar. Testet Vitest mbulojnë autorizimin, feedback-un, izolimin e workflow-ve, përzgjedhjen e shembujve dhe përdorimin në motorin real. `supabase/tests/agent_training.sql` verifikon RLS, versionet, historikun dhe fingerprint-in në një databazë testimi me rollback.

### Adresa të lexueshme për bizneset

Apliko `supabase/migrations/20261009210000_readable_business_slugs.sql` pas migrimeve ekzistuese. Adresa krijohet nga emri: `filiz-store`, `filiz-store-1`, `filiz-store-2`. Numërimi përdor vlerën e parë të lirë dhe krijimet njëkohësisht kontrollohen në databazë, si në onboarding ashtu edhe në panelin e administratorit.

Migrimi përditëson edhe adresat ekzistuese të formës `biznes-<UUID>`. ID-të dhe të dhënat mbeten të njëjta; linket e vjetra ruhen si alias dhe kontrollojnë të njëjtën anëtarësi. Cilësimet dhe konfirmimi i fshirjes shfaqin adresën e re. Adresat ekzistuese të personalizuara ruhen. Migrimi mund të riaplikohet; nuk aplikohet automatikisht në production.

### FAQ dhe monedhat nga skanimet

Apliko `supabase/migrations/20261008120000_scan_knowledge_routing.sql` pas migrimeve ekzistuese. Skanimi i website-it/Instagram-it, në onboarding dhe te **Plotëso me AI**, i ruan automatikisht FAQ-të dhe informacionin e përgjithshëm me prova nga burimi në `knowledge_entries`. Produktet/shërbimet mbeten për konfirmim në seksionin përkatës; FAQ-të nuk ngarkojnë listën e produkteve. Draftet e vjetra me njohuri të mbështetura drejtohen te moduli kur hapet paneli, pa një analizë të re. Përjashtimet e shprehura nga përdoruesi respektohen.

Përsëritja e skanimit nuk dyfishon të njëjtin titull/përgjigje. Një përgjigje që kundërshton një njohuri ekzistuese ruhet joaktive dhe mund të kontrollohet, korrigjohet ose aktivizohet te **Njohuritë**. Ruajtja e draftit dhe regjistrimi i FAQ-ve kryhen në një transaksion me kontroll të biznesit, versionit dhe lease-it. Baseline-i përditësohet vetëm për insertimet tona; ndryshimet e tjera manuale vazhdojnë të kërkojnë rishikim.

`€`, `Euro`, `EUR` normalizohen në `EUR`; `Lek`, `Lekë`, `ALL` në `ALL`; `£` në `GBP`. Kur monedha mungon, ajo plotësohet vetëm nga prova tekstuale/OCR e çmimit të të njëjtit produkt. `$` pa kod dhe tekstet me disa monedha mbeten për sqarim. Normalizimi zbatohet edhe për draftet ekzistuese. Gabimet e ruajtjes tregojnë fushën përkatëse; mungesa e migrimit shfaqet si problem databaze, jo si çmim i pavlefshëm.


### Visual workflows

Apply `supabase/migrations/20261010110000_visual_workflows.sql` after the existing migrations. It is transactional and safe to rerun in Supabase SQL Editor. No production migration is run by the application. Without it, the editor can preview the prepared graph; saving explains which migration is required, and existing conversations keep their previous behavior.

`/b/[slug]/workflows` now prepares an editable diagram from the onboarding journey, with start, condition, knowledge reply, data collection, confirmation, product workflow, handoff and end nodes. Move nodes by dragging (or Alt + arrow keys), and connect each output from the side inspector. Save incomplete work as a draft; publishing requires a reachable, valid graph. The active published version is separate from the draft. New conversations use it; running conversations retain their immutable version. Disabling the visual workflow affects new runs. Existing linear orders and reservations finish before entering the visual layer. While the visual workflow is active, it owns routing; the separate booking adapter cannot bypass its conditions or required steps. A dedicated booking node is not included in this version.

The editor's test conversation executes the same state machine as production with a user/business-bound encrypted session. It never sends Instagram messages or changes inbox data. Chat Lab and the business agent test also show the traversed graph. Production stores the current node and collected values in `conversation_states.collected.visual`; `completedVisual` retains the last completed run. A handoff pauses the inbox conversation, and staff can explicitly resume it. The visual layer prepares replies and data; it does not create orders, charge payments or schedule follow-ups.

Intent conditions currently use conservative Albanian/English word rules (shown in the inspector), while knowledge replies use the existing AI, source retrieval and saved business training. Field conditions use only accepted values, and confirmations require an explicit yes/no. Product nodes delegate only to configured product workflows; missing configuration hands off to staff.

Validation: `yarn test`, `yarn build`, and `supabase/tests/visual_workflows.sql` in an isolated PostgreSQL database. The SQL suite checks draft/publish separation, optimistic revisions, immutable snapshots, tenant isolation and bounded graph validation.


### Workflow-t nga Agjenti i biznesit

#### Stabilizimi A: zbatim gradual i moduleve

**Status: verifikim lokal i shtresës së aplikacionit; jo miratim për rollout.** Politikat legacy `tenant write workflows` dhe `tenant write steps` në `20261001120000_init.sql` kontrollojnë vetëm anëtarësinë. Ky ndryshim nuk mbyll shkrimet direkte PostgREST në tabelat legacy ose lidhjet e produkteve, nëse roli ka grant-et përkatëse. API-ja Next.js nuk është provë sigurie për ato rrugë. Para pranimit të plotë duhet inventarizim i klientëve direkt, kontroll i grant-eve në staging dhe migrim jo-destruktiv i rishikuar për t'i kaluar shkrimet përmes kufirit të autorizuar. Nuk është aplikuar migrim dhe kjo rrugë mbetet kusht bllokues; runtime-i i tenant-eve të përfshira gjithsesi kontrollon modulet para ekzekutimit.

`MODULE_ENFORCEMENT_BUSINESS_IDS` pranon ID biznesesh të ndara me presje (pa wildcard); bosh = sjellja ekzistuese. Ky flag është vetëm server-side, jo parametër i klientit. Riautorizimi i `saveModules` zbatohet për të gjithë. Para përfshirjes së një biznesi, ruaj një profil eksplicit manual/generated të moduleve dhe provo draft/publikim/riaktivizim dhe një bisedë me version të vjetër në staging. Profili i munguar/legacy ose gabimi i leximit bllokon bizneset e përfshira; nuk bëhet fallback në module të lejuara.

Për bizneset e përfshira, draftet, publikimi manual/AI dhe riaktivizimi kontrollojnë modulet e kërkuara nga grafi real dhe lidhjet aktive brenda tenant-it. Drafti mund të ketë konfigurim të paplotë, por jo module të çaktivizuara ose lidhje joaktive/të huaja. Produktet e reja ruhen pa lidhje specifike, aktivizohen në rrjedhën e përgjithshme të vlefshme dhe pastaj lidhen; operacioni i kombinuar produkt+flow nuk lejon lidhje joaktive. Workflow-t e vjetër me lidhje joaktive duhen riparuar para përfshirjes në rollout. Heqja e një lidhjeje të pavlefshme lejohet kur grafi rezultues është i vlefshëm.

`order.prepare` përfaqëson vetëm përgatitjen/konfirmimin ekzistues të porosisë, jo krijimin apo dërgimin e saj. Edhe flow-t `order` pa nyje `product` dhe flow-t custom me lidhje produkti kërkojnë Produkte + Porosi + Workflow. Flow-t me shërbime kërkojnë Shërbime; nyjet e rezervimit kërkojnë edhe Rezervime. Modulet e palidhura nuk bëhen parakushte. Google Calendar është opsional për rezervimet lokale; konfigurimi i paplotë i një lidhjeje të aktivizuar raportohet `integration_unavailable`. Kjo nuk certifikon kredencialet ose shëndetin real të provider-it.

Në runtime kontrollohet konfigurimi aktual për rrugën e ekzekutuar, edhe kur biseda përdor version të vjetër. Bllokimi ruan cursor-in, fushat dhe versionin e bisedës; nuk ndryshon versionet historike dhe nuk publikon asgjë. Kufijtë ekzistues të porosive, rezervimeve dhe handoff-it kontrollojnë gjithashtu modulet. Simulimi mbetet i izoluar; kufizimet e tij dhe diferenca e aprovuar manual/AI për provat e simulimit nuk zbuten.

Kontrollet e reja në aplikacion nuk janë transaksion i përbashkët me ndryshimin e moduleve: një veprim tashmë në ekzekutim mund të përfundojë nëse çaktivizimi ndodh pas kontrollit të fundit. RPC-të ruajnë kontrollet ekzistuese atomike të anëtarësisë/revisionit. Nuk shtohet migrim apo mbrojtje nga përdorimi administrativ i `service_role`. Para rollout-it real duhen prova Supabase/E2E, përfshirë çaktivizim gjatë bisedës dhe shkrime konkurruese. Çaktivizimi i flag-ut kthen sjelljen legacy; nuk rikthen të dhëna dhe nuk duhet trajtuar si masë sigurie për një tenant që kërkon kufizimet e reja.

Agjenti mund të tregojë rrjedhën vizuale dhe hapat e porosive, të propozojë ndryshime me krahasim para/pas, të ruajë draftin, të provojë rrjedhën, të publikojë/aktivizojë/çaktivizojë dhe të rikthejë një version të publikuar si draft. Workflow-t e produkteve krijohen ose ndryshohen si kopje të reja dhe lidhen me produktet e zgjedhura vetëm pas konfirmimit. Teksti dhe audio përdorin të njëjtën rrjedhë konfirmimi.

Pas migrimeve ekzistuese aplikohen `20261010130000_assistant_orderflows.sql` dhe `20261010140000_visual_workflow_history.sql`; kjo e fundit kërkon `20261010110000_visual_workflows.sql`. Pa tabelat vizuale shfaqet vetëm propozimi fillestar; ruajtja kërkon migrimet. Nuk aplikohen automatikisht në prodhim.

Hapat linearë mbështesin tekst, zgjedhje me përgjigje të lirë, foto, konfirmim dhe mbledhjen finale të të dhënave të klientit. Nuk ofrohet validim enum për zgjedhjet ose hapa pagesash. Ndryshimet nuk aktivizojnë produktet. Produktet nga katalogu i jashtëm mbeten të mbrojtura nga ndryshimi i lidhjeve përmes Agjentit.

`orderWorkflowSnapshot` ruan hapat e verifikuar, të enkriptuar dhe të lidhur me biznesin/produktin. Për porositë që nisën përpara këtij ndryshimi, transporti i Instagram-it kalon `conversation_states.workflow_id` nga databaza. Kështu lidhja e produktit me një kopje të re nuk ndryshon hapat e porosisë në proces. Versionet vizuale ruajnë mekanizmin ekzistues të versionit të publikuar.

`assistant_workflow_changes` regjistron ndryshimet lineare dhe produktet e prekura. `visual_workflow_events` regjistron çdo ruajtje të editorit ose Agjentit. RPC-të përdorin identitetet nga serveri, krahasime para shkrimit dhe çelësa idempotence. Testet SQL: `supabase/tests/assistant_orderflows.sql` dhe `supabase/tests/visual_workflow_history.sql`, vetëm në databazë të izoluar testimi.

### W4 — integriteti i dërgimit të porosive

Varësi e detyrueshme: `supabase/migrations/20261014120000_order_submission_integrity.sql`. Ky ndryshim **nuk është provë që migrimi është aplikuar**. Nuk ka fallback te insert-et e vjetra joatomike. Para rollout-it: ndal përkohësisht endpoint-in e dërgimit, kullo kërkesat e versionit të vjetër, testo/apliko migrimin me miratim, pastaj aktivizo kodin W4. Mos lejo trafik të përzier nga endpoint-i i vjetër. Për rollback të aplikacionit, mbaj dërgimin të bllokuar; kthimi te insert-et e vjetra humbet garancitë. Mos fshi ledger-in.

`orderReview.id` krijohet nga runtime; review lidh faktet W2, produktin, versionin e workflow-t dhe `orderTerms` (çmimin/monedhën/sasinë 1). Të dhënat v1/v2/v3 lexohen ende, por konfirmimet pa ID/çmim/monedhë të shqyrtuar kërkojnë rikonfirmim. Scope-i i ekzekutueshëm është një produkt i vetëm me çmimin bazë të katalogut dhe sasi 1; cart me disa artikuj/sasi të tjera refuzohet. Çmime variantesh, taksa, transport, ulje dhe pagesa nuk llogariten nga W4. Kërkesa ekzistuese për adresë mbetet për W5.

RPC-ja rikontrollon anëtarësinë, revision-in dhe snapshot-in e plotë, produktin aktiv të tenant-it, çmimin/monedhën dhe modulet aktuale nën lock. Produktet janë tenant-owned; `product_types` është katalog global. Profilet eksplicite me Porosi/Produkte të çaktivizuara bllokohen në këtë kufi edhe jashtë flag-ut të workflow-ve. Profilet legacy pa konfigurim eksplicit ruajnë kontrollin `MODULE_ENFORCEMENT_BUSINESS_IDS`. Modulet e palidhura nuk bllokojnë dërgimin. Ndryshimi i moduleve pas commit-it nuk anulon një dërgim tashmë të autorizuar.

Porosia, artikulli, lidhja me klientin dhe `order_submissions` ruhen në një transaksion. Unique `(business_id, conversation_id, confirmation_id)` lejon vetëm një porosi për konfirmim. Vetëm fituesi merr leje për një tentativë HTTP; retry/replay nuk e merr sërish. Snapshot-et historike dhe versionet nuk ndryshohen. Ledger-i është service-only; me hardening-un W4-SEC të aplikuar, trigger-i bllokon shkrimet direkte authenticated që ndryshojnë/fshijnë porositë W4 ose artikujt e tyre, edhe kur ekziston një tabelë e përkohshme me të njëjtin emër. Porositë legacy pa ledger mbeten me RLS-në ekzistuese. Fshirja e porosive/bizneseve me ledger kërkon procedurë eksplicite ruajtjeje/fshirjeje; nuk është pjesë e W4.

Provider-i HTTP aktual nuk ka kontratë idempotence të verifikuar. `X-Agjenti-Submission-Id` shërben vetëm për korrelacion, **jo** si garanci exactly-once. Timeout, përgjigje e paqartë, konfigurim i palexueshëm, humbje e përgjigjes së RPC-së ose dështim i ruajtjes së rezultatit lënë `pending_reconciliation`. Nuk bëhet retry automatik as për refuzim të ruajtur. Kur nuk ka integrim të konfiguruar, rezultati është `local_only`, jo dërgim i jashtëm. Në listën e porosive dhe përgjigjen e statusit, pasiguria shfaqet veçmas.

Pajtimi manual përdor `PATCH /api/businesses/{businessId}/conversations/{conversationId}/orders` me sesion të autentikuar dhe body `{ "orderId": "UUID", "status": "accepted" ose "rejected", "externalOrderId": "referenca e verifikuar", "evidence": "prova e kontrollit te provider-i" }`. Stafi duhet të verifikojë regjistrat e provider-it para këtij veprimi; prit të paktën 1 minutë që tentativa aktive të mbarojë. `accepted` kërkon referencë të jashtme. Mos përfshi sekrete/PII në evidence. RPC-ja ruan aktorin/provën/kohën, nuk ridërgon dhe nuk lejon mbishkrim të një rezultati terminal. Nuk ka ende formular të posaçëm UI për pajtimin ose API read-only të provider-it; përdorimi kërkon operator teknik. Një rezultat i panjohur nuk duhet zëvendësuar me një konfirmim të ri vetëm për ta ridërguar.

Gate i staging-ut: ekzekuto `supabase/tests/order_submission.sql` në DB të izoluar të migruar, dhe `supabase/tests/order_submission_concurrency.py --database-url <URL-e-DB-disposable-me-emër-që-mbaron-me-_w4_test>` për dy sesione PostgreSQL reale. Skripti nuk aplikon migrime. Provo gjithashtu anëtarësi të revokuar, çaktivizim modulesh gjatë kërkesës, RLS me JWT authenticated, dështim artikulli, timeout pas pranimit nga provider-i dhe dështim të finalizimit. Testet Vitest me RPC mocks nuk provojnë lock-et ose transaksionin real. Verifikimi E2E i provider-it bëhet vetëm me endpoint/accounts testimi, jo me porosi reale.

### W4-SEC — kufizim minimal i dobësisë SQL

Migrimi vijues `20261014130000_order_submission_security.sql` kërkon W4 të aplikuar më parë. Ripërcakton vetëm pesë funksionet W4: të gjitha tabelat, row types dhe thirrjet e helper-ëve përdorin `public.`; `search_path=pg_catalog,pg_temp` përjashton `public` nga kërkimi implicit dhe vendos skemën e përkohshme të fundit. Nuk ndryshon tabela, të dhëna, RLS, grante, nënshkrime RPC ose lidhjet e trigger-ëve. Migrimi fillestar nuk modifikohet. Ruajtja e ACL-ve është qëllimore, por **nuk korrigjon grant drift të një instalimi ekzistues**.

Dobësia e riprodhuar: me TEMP + UPDATE dhe akses RLS te porosia, roli SQL `authenticated` mund të krijonte `pg_temp.order_submissions` bosh dhe të anashkalonte kontrollin e ledger-it në trigger. Kjo provon një dobësi SECURITY DEFINER; nuk provon që një klient PostgREST ka mundësi të ekzekutojë SQL arbitrar ose `CREATE TEMP TABLE`.

Regresioni `supabase/tests/order_submission_security.sql` ekzekutohet me `psql -X -v ON_ERROR_STOP=1 -f ...` vetëm si administratori i një DB-je disposable me emër që mbaron në `_w4_test`. Grante DML/TEMP sintetike, fixture-et dhe tabelat e përkohshme janë brenda një transaksioni që kthehet mbrapsht. Testi dështon mbi W4 origjinal me `W4SEC_SHADOW_BYPASS`; pas hardening-ut provon pesë shkrime të bllokuara, membership të falsifikuar, RPC reale si `service_role`, replay pa ridërgim dhe pajtim. Riekzekutohen edhe testet ekzistuese SQL dhe concurrency të W4. Nuk duhen vendosur grantet e fixture-it në prodhim.

Inventari i shkruesve (kontrolluar mbi kodin W4, 2026-10-14):

| Rruga | Autoriteti dhe kufiri |
| --- | --- |
| `src/app/api/businesses/[id]/conversations/[conversationId]/orders/route.ts` → `src/lib/orders/submission.ts` | POST/PATCH autentikojnë aktorin; serveri thërret RPC-të W4. Nuk u gjet insert/update i drejtpërdrejtë i porosive në kodin aktual të aplikacionit. |
| `submit_confirmed_order` | Shkruesi aktual i porosisë + artikullit + ledger-it; transaksion, tenant/membership, konfirmim/revision, module dhe çmim autoritativ. |
| `finish_order_submission`, `reconcile_order_submission` | Ndryshojnë rezultatin e porosisë/ledger-it; service-only sipas migrimit. Pajtimi nuk ridërgon. `assert_order_actor` është helper service-only; `protect_managed_order` ekzekutohet nga trigger-ët, jo si RPC klienti. |
| Versioni para W4, commit `5ae02d0`, i të njëjtit endpoint (rreshtat 104–127, 147–158) | Insert-e të ndara dhe update me `service_role`, pa ledger. Nuk ekziston më në HEAD; nuk është verifikuar nëse deploy-e të vjetra punojnë ende. |
| `/rest/v1/orders`, `/rest/v1/order_items` | RLS legacy `FOR ALL` lejon shkrime për anëtarin e tenant-it nëse ka grante efektive DML dhe skema është e ekspozuar. INSERT pa ledger nuk ka fence W4; trigger-i mbron vetëm porositë e menaxhuara/artikujt e tyre. Module/konfirmim/idempotence nuk imponohen nga RLS legacy. |
| `/rest/v1/rpc/{submit_confirmed_order,finish_order_submission,reconcile_order_submission,assert_order_actor}` dhe `/rest/v1/order_submissions` | `anon`/`authenticated` duhet të jenë të refuzuar sipas migrimit W4. `service_role` mbetet autoritet i besuar dhe mund të shkruajë direkt; çelësi nuk duhet të ekspozohet te klientët. |
| Lista e porosive, Inbox, `src/lib/orders/customer-status.ts` | Vetëm lexime të porosive; jo shkrues alternativë. RPC-të e raportimit lexojnë porositë; nuk janë rrugë dërgimi. |

**Ekspozimi real Supabase: UNVERIFIED.** `supabase/operations/order_submission_security_inventory.sql` mbledh vetëm metadata read-only: ACL efektive tabelash/kolonash/funksionesh, pronarë, RLS, trigger-ë, default grants, role memberships dhe konfigurim të kufizuar PostgREST. Ekzekutimi kërkon miratim për mjedisin përkatës. Kërkimi i wrapper RPC-ve/views është heuristik; SQL dinamik dhe konfigurimi i jashtëm PostgREST duhen shqyrtuar veçmas. Rezultatet e bootstrap-it lokal nuk provojnë grantet Supabase. Duhet edhe provë staging me JWT `anon`/`authenticated`, tenant të huaj, anëtarësi të revokuar dhe pa çelës service në browser.

Gate i kthyeshëm, nëse ekspozimi konfirmohet: ndalo/kullo endpoint-et e vjetra përpara trafikut W4; për REST direkt kufizo DML në kufirin DB/API që realisht e ekspozon, duke ruajtur SELECT dhe RPC-të server-side të nevojshme. Një flag vetëm në Next.js **nuk** bllokon PostgREST direkt. Ruaj ACL-të paraprake dhe klientët e prekur, përfshirë grantet në kolona/PUBLIC/role të trashëguara; rikthe vetëm grantet e miratuara pas eliminimit të shkruesit legacy. Revokimi i DML nga `authenticated` nuk ndalon deploy-in e vjetër me `service_role`: ai duhet ndalur veçmas. W4-SEC nuk aktivizon gate global dhe nuk revokon verbërisht grante pa prova, sepse kjo mund të thyejë klientë ekzistues.

Rollout: testi i izoluar → prova reale e ACL/RLS dhe rrugëve REST në staging → miratim i veçantë për migrimin/gate-in → kalim i kontrolluar pa shkrues legacy paralel. Mos rikthe funksionet me lookup të pasigurt dhe mos fshi ledger-in për rollback; mbaj dërgimin të ndaluar nëse duhet kthyer aplikacioni. Ky hardening nuk ndryshon garancitë e provider-it dhe nuk mbyll gate-in Supabase pa prova reale.

### W0-B — kufiri i shkrimeve direkte të porosive

**Status: implementim/testim lokal; jo migrim production.** Projekti i identifikuar nga përdoruesi është `cvdsapjmibezkzeregrd`, production i përdorur për zhvillim pa klientë realë sipas deklarimit të tij. Eksporti i granteve i datës 2026-10-14 07:31 UTC konfirmon INSERT/UPDATE/DELETE/TRUNCATE për `anon` dhe `authenticated` në `orders`/`order_items`. Hash-et e pesë funksioneve përputhen me W4-SEC; rolet klient nuk kanë EXECUTE mbi to ose shkrime mbi ledger-in.

Rikontrolli direkt read-only në SQL Editor më 2026-10-14 08:26 UTC konfirmoi sërish hash-et dhe konfigurimin e pesë funksioneve W4-SEC, refuzimin e EXECUTE për rolet klient dhe praninë e granteve direkte të shkrimit në dy tabelat. `to_regclass('supabase_migrations.schema_migrations')` ktheu NULL: prania e funksioneve nuk po trajtohet si provë e historikut CLI të migrimeve. Pas kërkesës për migrim/push, përdoruesi nuk konfirmoi mungesën e shkruesve të tjerë legacy; W0-B nuk u aplikua dhe flag-u i verifikimit të varësive nuk u vendos. W4-SEC ekzistues nuk u riaplikua pa nevojë.

Verifikimi i autorizuar read-only më 2026-10-14 08:04 UTC përdori vetëm credential-in publik `anon`, jo `service_role`: HEAD në `/rest/v1/orders?select=id&limit=0` dhe `/rest/v1/order_items?select=id&limit=0`, me `Accept-Profile: public`, ktheu 200. Profili i pavlefshëm ktheu 406/PGRST106. Kjo konfirmon rrugët read-only në skemën `public`, **jo një shkrim HTTP të suksesshëm**. OpenAPI në rrënjën REST ktheu 401; lista e plotë e skemave/wrapper-ëve nuk u verifikua. Nuk u kërkuan rreshta klientësh dhe nuk u përdorën POST/PATCH/DELETE ose SQL shkrues në production.

Varësitë e inspektuara:

- Kodi aktual i endpoint-it të porosive përdor `submitConfirmedOrder`/`reconcileOrder`; shkrimet bëhen nga RPC-të W4 përmes klientit server-side `service_role`. Lista e porosive, Inbox, customer-status dhe raportimi përdorin lexime. Nuk u gjet shkrues direkt klienti në repository.
- Versioni para W4 (`5ae02d0`) përdorte insert-e të ndara me `service_role`. Prania e deploy-eve të vjetra, skripteve ose klientëve jashtë repository-t mbetet e paverifikuar; deklarimi “pa klientë realë” nuk provon mungesën e integrimeve/test clients.
- Politikat legacy `FOR ALL` mbeten të pandryshuara, por nuk japin vetë privilegje SQL. Pas heqjes së granteve klienti nuk mund të shkruajë; SELECT dhe izolimi RLS ruhen. Ndryshimi i qëllimshëm i kompatibilitetit: klientët që shkruanin direkt edhe porosi legacy do të refuzohen. Historia legacy mbetet e lexueshme sipas RLS.

Migrimi `20261014140000_order_write_boundary.sql`, pas W4 dhe W4-SEC, revokon **vetëm INSERT, UPDATE, DELETE, TRUNCATE në `public.orders` dhe `public.order_items` nga `anon` dhe `authenticated`**. PostgreSQL heq edhe grantet përkatëse në kolona; testet mbulojnë raste vetëm me grante kolonash. Nuk ndryshohen SELECT, REFERENCES/TRIGGER, RLS, RPC-të, `order_submissions`, default privileges, role memberships, `PUBLIC`, role të tjera apo të dhëna. Kontrollet pas revokimit përdorin lejet efektive të tabelave dhe kolonave.

Migrimi përdor RESTRICT, jo CASCADE. Nëse ekzistojnë grant-e të deleguara ose mbeten të drejta shkrimi përmes PUBLIC/roleve të trashëguara/grantor-ëve të tjerë, i gjithë transaksioni dështon dhe grantet mbeten të pandryshuara. Këto raste kërkojnë inventar dhe miratim të veçantë, jo revokim automatik të roleve të tjera.

Procedura e rollout-it (kërkon miratim të veçantë; nuk është ekzekutuar në production):

1. Konfirmo deploy-in aktiv W4 dhe ndalo/kullo shkruesit e vjetër. Kontrollo klientët e jashtëm, wrapper RPC/views dhe skemat e ekspozuara në konfigurimin real PostgREST.
2. Ekzekuto inventarin read-only dhe `supabase/operations/order_write_boundary_snapshot.sql` **përpara migrimit**. Arkivo rezultatin me project ref, mjedisin dhe kohën. Snapshot-i kthen një JSON me ACL-të dhe `rollback_sql`; nuk ndryshon grante dhe nuk lexon porosi.
3. Provo snapshot → migrim → teste → rollback → migrim në staging/disposable. Verifiko HTTP me `anon` dhe JWT të një përdoruesi test, tenant tjetër, lexime dhe endpoint-in W4. Provat e shkrimit bëhen vetëm me fixture-e sintetike në staging, jo në production.
4. Vetëm pas verifikimit të varësive, vendos `SET agjenti.w0b_dependencies_verified = 'on';` në **të njëjtin sesion** që aplikon migrimin. Pa këtë konfirmim eksplicit migrimi ndalet me `w0b_dependency_review_required`, përfshirë në pipeline automatike. Flag-u nuk është mekanizëm autorizimi dhe nuk zëvendëson provat; nevojiten ende privilegjet DDL.
5. Pas aplikimit të miratuar, rikontrollo grantet efektive, SELECT/RLS dhe rrugën W4. Mbaji shkruesit legacy të ndaluar. Default grants ose rikrijimi i tabelave në migrime të ardhshme mund të rihapin kufirin; përsërit kontrollin pas atyre ndryshimeve.

Rollback: përdor vetëm `rollback_sql` nga snapshot-i **para migrimit**, si rol i autorizuar që mund të veprojë si grantor-ët e regjistruar. Rikthehen vetëm grantet klient të hequra, me të njëjtën tabelë/kolonë, grant option dhe grantor; nuk përdoret GRANT ALL dhe nuk rikthehen/fshihen të dhëna. Rishiko fillimisht çdo ndryshim ACL pas snapshot-it. Rollback-u rihap qëllimisht rrugën legacy, prandaj kërkon miratim dhe kufizim trafiku; nuk është korrigjim sigurie. Mos rikthe W4-SEC ose mos fshi ledger-in.

Testet lokale: `supabase/tests/order_write_boundary.py --database-url <URL-lokale-me-Unix-socket-dhe-DB-disposable-_w4_test> --psql <psql>`. Kërkohet DB e zbrazët nga porositë, e migruar deri në W4-SEC. Harness-i modelon grantet hosted, aplikon W0-B, ekzekuton `order_write_boundary.sql`, testin atomik W4 dhe concurrency real; provon rollback-un e saktë, grante vetëm kolonash, PUBLIC, trashëgimi dhe delegime. Përfundon pa porosi fixture dhe me DB-në disposable të kufizuar. Mos e ekzekuto në Supabase production dhe mos kopjo grantet e fixture-it atje.

Rreziku i mbetur `service_role`: privilegjet e tij ruhen; një deploy i vjetër, wrapper i privilegjuar ose çelës i ekspozuar mund të shkruajë jashtë ledger-it. W0-B mbyll privilegjet direkte të dy roleve klient në dy tabela, jo të gjitha rrugët e privilegjuara të platformës. Pranimi lokal nuk është provë e rollout-it apo e integrimit real me provider-in.

### Lejet e moduleve dhe ftesat e pronësisë

`/admin/actions` përdor të njëjtat tabela politikash për `module.*` dhe veprimet ekzistuese. Administratori lejon ose bllokon modulet për paketë/biznes; `/b/[slug]/actions` tregon aftësitë efektive dhe rrjedhën e biznesit me ftesë. Aktivizimi në hapësirë mbetet te `dashboard_profile` dhe nuk tejkalon lejen e administratorit. Modulet bazë të komunikimit dhe cilësimeve mbeten të disponueshme. Klientët e kanaleve nuk fitojnë hyrje në panel. Anëtarësitë ekzistuese `staff` dhe lejet e tyre nuk ndryshohen nga migrimi ose ruajtja e konfigurimit të ftesave.

Apliko `20261014150000_module_entitlements.sql` **përpara** publikimit të kodit që e përdor. Migrimi nuk ndryshon profilet ekzistuese (përfshirë profilet bosh që përdorin pamjen klasike), të dhënat ose ftesat. Modulet ekzistuese lejohen fillimisht në të gjitha paketat; `business.provision` ruan politikën aktuale dhe aktivizohet shprehimisht nga administratori për biznesin e zgjedhur. Bllokimet e platformës zbatohen gjithmonë, edhe për biznese jashtë rollout-it `MODULE_ENFORCEMENT_BUSINESS_IDS`; ai switch vazhdon të kontrollojë vetëm zbatimin shtesë të përzgjedhjes së moduleve në runtime. Regjistri i klientëve ndahet nga identitetet e Inbox-it, që bllokimi i faqes së klientëve të mos ndërpresë marrjen e mesazheve. Leads dhe Stafi ruajnë faqet ekzistuese bazë.

Verifikim në DB disposable: `supabase/tests/module_entitlements.sql` dhe `supabase/tests/action_catalog.sql`, bashkë me regresionet e shërbimeve, katalogëve dhe workflow-ve. Për kthim përdor `supabase/operations/rollback_module_entitlements.sql` bashkë me versionin e mëparshëm të aplikacionit: ruhen politikat, profilet, anëtarësitë dhe ftesat, ndërsa hiqet zbatimi i ri i lejeve të moduleve. Migrimi nuk duhet riaplikuar verbërisht pas këtij rollback-u, sepse rreshtat e politikave ruhen qëllimisht.
