# Agjenti.app

Platformë qendrore e suportit me AI për Instagram. Zana Store është një biznes i lidhur me API.

## Stack

Next.js 15, React 19, TypeScript, Tailwind, Supabase, Vitest. Deploy: Vercel, domain `agjenti.app`.

## Fillimi lokal

1. Krijo një projekt të ri Supabase (i ndarë nga Zana).
2. Ekzekuto `supabase/migrations/20261001120000_init.sql`.
3. Kopjo `.env.example` te `.env.local`.
4. Shto rreshtin tënd te `platform_admins` pas regjistrimit të parë.
5. `yarn install && yarn dev` (gjithmonë porti `3003`).

## Env

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (`http://localhost:3003` lokal, `https://agjenti.app` në prod)

Auth (Supabase → Authentication → URL Configuration):
- **Site URL** = `https://agjenti.app` (jo localhost)
- **Redirect URLs** = `https://agjenti.app/**` dhe `http://localhost:3003/**`
- `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
- `INSTAGRAM_OAUTH_REDIRECT_URI` = `https://agjenti.app/api/instagram/oauth/callback`
- `TOKEN_ENCRYPTION_KEY` (64 hex ose frazë e gjatë)
- `OPENAI_API_KEY`, `ZANA_AGENT_MODEL` (parazgjedhje `gpt-5.6-luna`)
- `CRON_SECRET`
- `ZANA_API_BASE_URL`, `ZANA_AGJENTI_SECRET`

Webhook Meta: `https://agjenti.app/api/webhooks/meta`

## Cutover Instagram

1. Në Zana, fik `instagram_messaging_enabled`.
2. Në Meta, kthe webhook-un te Agjenti.
3. Testo një DM.

Inbox-i fillon bosh. Historia e Zana-s mbetet arkiv.

## Panelet

- `/app`: zgjedhja e biznesit dhe hyrja në panelin e adminit.
- `/admin`: përmbledhje e platformës; `/admin/businesses` për bizneset dhe anëtarët; `/admin/conversations` për bisedat dhe lidhjet Instagram.
- `/b/[slug]`: dashboard i biznesit; nënfaqet për Inbox, produkte, porosi, klientë, agjentë, njohuri, workflow, Instagram dhe cilësime.

Panelet përdorin skemën ekzistuese. Workflow-t lidhen me llojin e produktit. Numrat e dashboard-it janë totalet reale; grafiku paraqet krijimet për 7 ditët e fundit, me kufij ditorë UTC. Listat e klientëve, porosive dhe bisedave të adminit ngarkojnë deri në 1 000 rreshta; Inbox-i ngarkon 100 bisedat dhe 200 mesazhet më të fundit. Kërkimi dhe faqezimi veprojnë mbi listën e ngarkuar.

Planet/faturimi, Facebook/WhatsApp, statistikat e Instagram-it, transporti/pagesat, variantet e produkteve dhe CRM me etiketa/shënime mbeten për fazën tjetër. Nuk shfaqen si funksione aktive ose statistika të simuluara.

Fontet Figtree dhe Syne ruhen në `src/app/fonts` bashkë me licencat OFL, pa shkarkim gjatë build-it.

Kontrolle: `yarn lint`, `yarn test`, `yarn build`.
