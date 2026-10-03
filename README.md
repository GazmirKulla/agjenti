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
- **Redirect URLs** = `https://agjenti.app/**` dhe `http://localhost:3003/**`
- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (Instagram App ID/Secret nga Meta → Instagram, jo Facebook App ID)
- `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
- `INSTAGRAM_OAUTH_REDIRECT_URI` = `https://agjenti.app/api/instagram/oauth/callback`
- `TOKEN_ENCRYPTION_KEY` (64 hex ose frazë e gjatë)
- `OPENAI_API_KEY`, `ZANA_AGENT_MODEL` (parazgjedhje `gpt-5.6-luna`)
- `CRON_SECRET`
- Katalogu/porositë e jashtme: URL + API key për biznes te Cilësimet; te sajti i biznesit `AGJENTI_APP_SECRET`

Webhook Meta: `https://agjenti.app/api/webhooks/meta`

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
