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

Apliko `supabase/migrations/20261007160000_business_discovery.sql` pas migrimeve ekzistuese, përpara deploy-it të kodit. Rrjedha është emri → lidhja Instagram → analiza në background → shqyrtimi → konfirmimi → prova e Agjentit. Website-i është opsional; linku nga profili sugjerohet kur Graph API e kthen. Bio/website varen nga fushat që lejon API dhe dështimi i metadata-s nuk bllokon postimet. Mbështeten llogaritë dhe lejet e integrimit ekzistues Instagram.

Onboarding-u hapet te `/b/[slug]/setup`, me pamje të veçantë nga paneli dhe tregues për fazën/progresin e analizës. Checklist-i i përgatitjes shfaqet vetëm aty. Rishikimi grupon propozimet sipas seksionit: përdoruesi mund të çaktivizojë një seksion të tërë ose elemente të veçanta dhe të zgjedhë modulet e panelit. Zgjedhjet ruhen si `draft.reviewPreferences` në JSON-in ekzistues (pa migrim shtesë), mbijetojnë rifreskimin/analizat e tjera dhe kontrollohen nga API-ja përpara aplikimit. Modulet që varen nga një modul i hequr çaktivizohen bashkë me të. Të dhënat ekzistuese të biznesit nuk fshihen; modulet mund të ndryshohen përsëri te Cilësimet.

Analiza lexon deri në 100 postime dhe përzgjedh deri në 25 foto nga postimet e fundit, historia dhe carousel-et, në grupe prej 5. Fotot dërgohen si `input_image` në Responses API; videot analizohen vetëm përmes thumbnail-it. Vëzhgimet vizuale dhe teksti i lexuar në foto mbajnë referencën e fotos/postimit, provën dhe confidence nën 0.8 për shqyrtim. Çmimi, stoku dhe politikat kërkojnë tekst të publikuar ose OCR, nuk nxirren nga pamja. Website-i lexon deri në 8 faqe publike dhe 65,000 karaktere me kontrollet ekzistuese kundër URL-ve private dhe redirect-eve të pasigurta. Ky është lexim selektiv, jo import i plotë SKU ose inventari.

Gjatë skanimit hapet një dialog me karusel të postimeve reale dhe progres nga checkpoint-i. Faza vizuale rrotullon grupin aktual prej 5 fotosh; website-i shfaq tituj dhe fragmente nga faqet e lexuara. Dialogu minimizohet pa ndalur worker-in dhe shfaq rezultatin kur analiza mbaron. Rrotullimi mund të ndalet dhe respekton `prefers-reduced-motion`. Preview-t kufizohen në 25 foto / 8 faqe, vetëm për përdorues me qasje në biznes; kapja e plotë dhe kredencialet nuk ekspozohen. Ky ndryshim përdor JSON-in ekzistues, pa migrim të ri.

`business_discovery` ruan propozimin, klasifikimin dhe versionet; `business_discovery_jobs` ruan fazat/checkpoint-et. Punët kanë lease 3-minutëshe, token që pengon shkrimet nga një worker i vjetër, tri prova për fazë dhe kufi 12 analiza/24h/biznes. Një grup fotosh që dështon pas tri provash kapërcehet me njoftim, duke ruajtur tekstin dhe fotot e tjera. Ndryshimi i lidhjes Instagram ose URL-së zëvendëson punën e vjetër. Klasifikimi i biznesit dhe udhëzimet janë rekomandime; faktet nga burime kundërshtuese kërkojnë zgjidhje dhe korrigjimet manuale ruhen. Rezultati i përfunduar regjistrohet edhe në historikun Business Intelligence.

Callback-u OAuth dhe kërkesat e panelit nisin worker-in përmes `after()`. Faqja e onboarding-ut vazhdon automatikisht punët në pritje gjatë ndjekjes së progresit; nëse përdoruesi largohet, worker-i aktual përfundon brenda afatit të kërkesës dhe checkpoint-et ruhen për vazhdimin kur faqja hapet sërish. `vercel.json` përfshin `/api/cron/business-discovery` një herë në ditë, në orën 03:00 UTC, si vazhdim rezervë kur browser-i është mbyllur. Ky interval është i pajtueshëm me planin Vercel Hobby; një cron çdo 5 minuta në këtë plan bllokon deployment-in. Konfiguro `CRON_SECRET` dhe një platformë/plan që mbështet funksione 180-sekondëshe. Për vazhdim më të shpeshtë pa browser, përdor një scheduler të jashtëm që thërret endpoint-in me `Authorization: Bearer <CRON_SECRET>`, ose përshtat intervalin në një plan Vercel që e mbështet.

Përdoret `OPENAI_API_KEY`. `BUSINESS_DISCOVERY_MODEL` dhe `BUSINESS_VISION_MODEL` janë opsionale dhe përdorin `AGENT_MODEL` kur lihen bosh. Modeli vizual duhet të mbështesë imazhe dhe strict JSON Schema; kontrata ndjek [dokumentacionin për imazhet](https://developers.openai.com/api/docs/guides/images-vision). API-ja kërkon sesion dhe qasje në biznes, origjinë të njëjtë dhe request deri në 512 KB. Klienti nuk merr token-et Instagram apo checkpoint-et me përmbajtjen e plotë.

Konfirmimi aplikon vetëm elementet e përzgjedhura në një transaksion. Produktet e reja me çmim/monedhë dhe template të vlefshëm marrin tipin/workflow-n dhe aktivizohen; pa template të vlefshëm mbeten joaktive. Produktet pa çmim mund të plotësohen ose lihen për më vonë. Shërbimet ruhen si njohuri për Agjentin; rezervimet/calendar-i ruajnë kufizimet e moduleve ekzistuese. Udhëzimet krijohen duke ruajtur rregullat e konfirmuara dhe agjentët ekzistues. Përgjigjet automatike aktivizohen nga rrjedha ekzistuese vetëm pasi të kryhen kontrollet dhe prova e Agjentit. Ndryshimet ndërkohë në panel bllokojnë aplikimin derisa përdoruesi të rifreskojë propozimin.

Verifikim: `npm test`, `npm run lint`, `npm run build`. `supabase/tests/business_discovery.sql` mbulon lease-et, zëvendësimin e burimit, retries, izolimin ndërmjet bizneseve, versionet, rollback-un, workflow-t dhe konfirmimin idempotent; ekzekutohet vetëm në databazë testimi dhe bën rollback. Testet e API/modelit përdorin mocks; OAuth, lejet Meta dhe daljet reale AI duhen provuar me një llogari biznesi pas konfigurimit të ambientit.

### Business Intelligence: collect → review → apply

Apply `supabase/migrations/20261006100000_business_intelligence.sql` after the
existing audio-onboarding migration. `OPENAI_API_KEY` enables source analysis;
manual structured entry works without an AI key. No external scan or audio is
applied automatically.

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

### FAQ dhe monedhat nga skanimet

Apliko `supabase/migrations/20261008120000_scan_knowledge_routing.sql` pas migrimeve ekzistuese. Skanimi i website-it/Instagram-it, në onboarding dhe te **Plotëso me AI**, i ruan automatikisht FAQ-të dhe informacionin e përgjithshëm me prova nga burimi në `knowledge_entries`. Produktet/shërbimet mbeten për konfirmim në seksionin përkatës; FAQ-të nuk ngarkojnë listën e produkteve. Draftet e vjetra me njohuri të mbështetura drejtohen te moduli kur hapet paneli, pa një analizë të re. Përjashtimet e shprehura nga përdoruesi respektohen.

Përsëritja e skanimit nuk dyfishon të njëjtin titull/përgjigje. Një përgjigje që kundërshton një njohuri ekzistuese ruhet joaktive dhe mund të kontrollohet, korrigjohet ose aktivizohet te **Njohuritë**. Ruajtja e draftit dhe regjistrimi i FAQ-ve kryhen në një transaksion me kontroll të biznesit, versionit dhe lease-it. Baseline-i përditësohet vetëm për insertimet tona; ndryshimet e tjera manuale vazhdojnë të kërkojnë rishikim.

`€`, `Euro`, `EUR` normalizohen në `EUR`; `Lek`, `Lekë`, `ALL` në `ALL`; `£` në `GBP`. Kur monedha mungon, ajo plotësohet vetëm nga prova tekstuale/OCR e çmimit të të njëjtit produkt. `$` pa kod dhe tekstet me disa monedha mbeten për sqarim. Normalizimi zbatohet edhe për draftet ekzistuese. Gabimet e ruajtjes tregojnë fushën përkatëse; mungesa e migrimit shfaqet si problem databaze, jo si çmim i pavlefshëm.
