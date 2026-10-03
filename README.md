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

Pas regjistrimit dhe konfirmimit të email-it (kur kërkohet nga Supabase), `/auth/continue` dërgon adminët te `/admin`, anëtarët ekzistues te biznesi i tyre dhe përdoruesit e rinj te `/onboarding`. Mirëpritja mbledh emrin, pastaj shtatë hapa në shqip. Draftet ruhen në server kur shtypet Vazhdo, Prapa ose Ruaj për më vonë; një ngarkim tjetër vazhdon nga hapi i ruajtur.

`business_onboarding` ruan përgjigjet dhe lidhjen me biznesin. RPC-të janë vetëm për service role; server action merr identitetin nga sesioni i verifikuar dhe validon përgjigjet me allow-list. Një lock mbi profilin serializon draftet, tab-et dhe kërkesat e përsëritura. Krijimi i biznesit, rolit owner, agjentit dhe shënimi i përfundimit kryhen në një transaksion. Një anëtarësi e caktuar ndërkohë nga administratori përdoret pa krijuar një biznes tjetër.

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

- **Pyetësori i onboarding-ut:** kur është i fikur, përdoruesit pa biznes japin vetëm emrin. Përdoret funksioni ekzistues atomik `complete_business_onboarding`; pronësia dhe mbrojtja nga krijimi i dyfishtë ruhen, agjenti dhe përgjigjet automatike nisin të fikura. Bizneset ekzistuese nuk ndryshojnë.
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
