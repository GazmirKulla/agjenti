# Reactions manuale — fazë lokale e ndarë nga messaging core

Bazë: `13e226bba32110bda857d895673699ab357d603b` (`main`). Nuk ndryshohen koordinatori, queue worker-i, checkpoint-et P1 ose runtime-i i Agent Test. Nuk bëhen dërgime reale, commit, push apo deploy.

## Kontrata dhe burimet zyrtare

Kontrolluar më 24 tetor 2026. Dokumentacioni publik u lexua drejtpërdrejt, pa token-a. `SUPPORTED` më poshtë përshkruan kontratën e dokumentuar dhe implementimin lokal, **jo certifikim live**.

| Veprimi | Instagram | WhatsApp |
| --- | --- | --- |
| Klienti shton/ndryshon/heq | SUPPORTED: event `reaction`, `react/unreact` | SUPPORTED: mesazh `type=reaction`; emoji që mungon nënkupton heqje |
| Biznesi shton/ndryshon | SUPPORTED: `sender_action=react`, ID e mesazhit dhe emoji | SUPPORTED: `type=reaction`, `message_id`, emoji |
| Biznesi heq | SUPPORTED: `sender_action=unreact`, vetëm `message_id` në payload | UNVERIFIED nga dokumentacioni aktual i arritshëm; UI/API/SQL e bllokojnë |
| Receipt i reaction-it | Vetëm pranimi HTTP; nuk shpiket delivered/read | Pranim HTTP + status sent/failed; Meta nuk jep delivered/read për reactions |
| Provë reale provider-i | UNVERIFIED | UNVERIFIED |

Burime:

- [Instagram Messaging API — react/unreact](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api.md).
- [Instagram webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples.md).
- [WhatsApp reaction messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/reaction-messages.md).
- [WhatsApp incoming reaction webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/reaction.md).

Nuk ndryshohen versionet e projektit: Instagram përdor `graphVersion()` (default v22.0), WhatsApp `whatsappGraphVersion()` (default v26.0). Shembujt aktualë Meta përdorin v26.0. Përputhshmëria e emoji-ve jo-heart me versionin efektiv Instagram dhe lejet e llogarisë mbetet kusht i verifikimit live; ky kod nuk është miratim për aktivizim production. Heart përdor vlerën historike `love`. UI ofron një nënbashkësi prej gjashtë emoji-sh; marrja pranon një grapheme emoji të vlefshëm, jo tekst arbitrar.

Lejet/rregullimi i llogarisë duhen verifikuar para publikimit: Instagram `instagram_business_basic`, `instagram_business_manage_messages`, subscription `message_reactions`; OAuth ekzistues tashmë e kërkon këtë fushë. WhatsApp kërkon `whatsapp_business_messaging` dhe webhook `messages`. Nuk u lexua apo ndryshua konfigurimi live.

Ruhet kufiri konservativ i aplikacionit: veprim vetëm mbi mesazh hyrës të klientit me provider ID, brenda dritares së fundit 24-orëshe të bisedës dhe moshës së mesazhit 30 ditë. Meta mund të refuzojë gjithashtu mesazhe të fshira, mesazhe të një thread-i tjetër ose reactions; WhatsApp mund ta raportojë këtë më vonë me kodin 131009. Nuk përdoren API private.

## Rrjedha dhe burimi autoritativ

`Inbox → API reactions → transportAccess + RPC membership/target/CAS → adapter Meta → finish RPC → GET reactions → UI`

`Webhook me firmë të vlefshme → parser reactions → connection/account lookup → record_customer_reaction → lidhje me provider part/message → GET → UI`

- `message_reactions` ruan gjendjen e autorit customer/business mbi identitetin connection + participant + provider-message ID. `part_id` lidhet me pjesën e saktë të një përgjigjeje multipart; nuk përdoret automatikisht ID-ja e fundit.
- `message_reaction_operations` ruan operatorin privat, request UUID, revision, attempt/token fencing, rezultatin dhe ACK-un. Nuk është motor bisede ose queue e re; nuk ka worker reactions dhe as transaksion të hapur gjatë HTTP-së.
- Një identitet publik biznesi, jo një emoji publik për çdo operator. CAS dhe një operacion sending/uncertain për target pengojnë shkrimin konkurrues. Operatori tjetër sheh përditësimin nga GET çdo 3 sekonda.
- RLS lejon vetëm leximin e reactions të lidhura për anëtarin aktual. Klienti nuk ka INSERT/UPDATE/DELETE ose EXECUTE mbi RPC-të. API-ja përdor autentikim ekzistues dhe RPC-të kontrollojnë sërish anëtarësinë dhe target-in; operatori, tenant-i dhe provider ID nuk merren në mirëbesim nga klienti.
- Reaction nuk krijon bubble/mesazh tekst, nuk ndryshon auto_reply/staff ownership, fakte ose confirmation, nuk nis AI/workflow. Eventet vetëm-reaction nuk zgjojnë queue worker-in. Agent Test nuk ka kontrolle të reja dhe nuk kryen veprime provider-i.

## Retry, renditja, rikthimi

- UI shfaq pending; emoji i ri bëhet i konfirmuar vetëm pas ACK-ut autoritativ. Në dështim mbetet reaction-i i fundit ende i konfirmuar, jo një paraardhës që ka dështuar më vonë.
- HTTP timeout/5xx/ACK i pavlefshëm shënohet uncertain; nuk ridërgohet automatikisht. Pas 60 sekondash një sending pa rezultat bëhet uncertain në rakordim. Kjo nuk bllokon radhën e mesazheve, vetëm target-in e reaction-it.
- Dështimi i sigurt para pranimit lejon retry eksplicit me të njëjtin request UUID dhe attempt fencing, maksimumi 3 tentativa. Dështimi asinkron me ACK nuk ridërgohet automatikisht. Mund të bëhet veprim i ri eksplicit pas refresh-it.
- Session storage ruan vetëm hint-in e kërkesës lokale (jo përmbajtjen e mesazhit); GET autoritativ rikthen gjendjen pas reload/reconnect. Klikimi i dyfishtë ose ripërsëritja e të njëjtit UUID nuk shkakton HTTP të dytë te provider-i.
- Receipt shumë i hershëm përdor buffer-in/lock-un ekzistues të core-it; dispatcher-i SQL ruan kontratën e `record_transport_receipt`. Reactions nuk ndryshojnë receipt-et e mesazheve.
- Eventet e klientit renditen sipas timestamp-it të provider-it. Event i vjetër nuk mbishkruan më të riun; timestamp identik me emoji të ndryshëm shënohet ambiguous, jo rend i shpikur. Echo me autor llogarinë e biznesit nuk paraqitet si reaction i klientit ose kopje e reaction-it të biznesit.
- Reactions pa target mbeten të palidhura: 7 ditë dhe maksimumi 10,000 për connection; rakordimi bëhet gjatë eventit/GET. Nuk ka background sweeper: pastrimi bëhet kur vjen event tjetër në atë connection. Buffer-i plot refuzon shkrimin, nuk heq evente në heshtje.
- Reactions të bëra drejtpërdrejt nga biznesi jashtë Agjenti.app nuk kanë sinkronizim të plotë në këtë MVP. Lista ndjek kufirin ekzistues të Inbox-it prej 200 mesazhesh. Nuk ka polling të historisë së vjetër ose memorje semantike.

## Migrime dhe rikthim

1. `20261023232948_manual_message_reactions.sql`: dy tabela private, RLS, RPC CAS/rakordimi dhe dispatcher receipt. Kërkon migrimet e core-it që janë në commit-in bazë.
2. `20261023235109_reaction_failure_reconciliation.sql`: korrigjim forward-only i dy dështimeve të vonuara; përdor operacionin e fundit ende `sent`, jo vetëm `previous_emoji` historik.

Të dyja u aplikuan **vetëm** në stack-un disposable `agjenti-e2e-local-messages-20261024`, loopback + Docker network internal. Migrimi i parë i aplikuar nuk u rishkrua. Nuk preket schema e fakteve/workflow-t ose të dhënat ekzistuese të klientëve.

Për një publikim të ardhshëm të miratuar: migrimet përpara kodit. Rollback i aplikacionit mund t'i lërë tabelat/RPC-të të papërdorura dhe dispatcher-i vazhdon receipt-et e core-it. Mos fshi tabela me operacione pending/uncertain; ndërprerja e UI-së nuk anulon efektin në Meta. Rikthim SQL vetëm me migrim të ri të rishikuar, pasi të ndalohen writer-at dhe të ruhet auditimi; nuk përgatitet ose ekzekutohet DROP automatik.

## Verifikim lokal dhe prova para/pas

- Kufiri reaction+text (fixture sintetik keqformuar): dy teste dështonin në baseline sepse mund të futeshin në rrugën e AI-së; kalojnë pas guard-it eksplicit. Kjo nuk provon se Meta dërgon realisht envelope të tillë.
- Draft reactions: dy dështime të vonuara rikthenin `❤️` të refuzuar në vend të `🎉` ende të konfirmuar; regresioni real PostgreSQL dështoi para migrimit të dytë dhe kaloi pas tij.
- Draft adapter: ACK me recipient konfliktues shpallej sent; testi sintetik dështoi para guard-it dhe kalon si uncertain pas tij.
- CSS module mock u shtua te testi ekzistues i lokalizimit sipas konventës së atij testi; nuk u ndryshua asnjë pritshmëri ekzistuese.

## Skedarët e kësaj faze

Të rinj:

- `src/lib/conversations/reactions.ts`
- `src/lib/conversations/provider-reactions.ts`
- `src/lib/conversations/provider-reactions.test.ts`
- `src/lib/conversations/reaction-boundary.test.ts`
- `src/app/api/businesses/[id]/conversations/[conversationId]/reactions/route.ts`
- `src/app/api/businesses/[id]/conversations/[conversationId]/reactions/route.test.ts`
- `src/components/agents/message-reactions.tsx`
- `src/components/agents/message-reactions.test.ts`
- `src/components/agents/message-reactions.module.css`
- `e2e/message-reactions.mjs`
- `e2e/message-reactions.spec.mjs`
- `e2e/playwright.reactions.config.mjs`
- Dy migrimet e listuara më sipër dhe ky dokument.

Ekzistues, me ndryshime vetëm për integrimin reactions:

- `src/app/api/webhooks/meta/route.ts` dhe `route.test.ts`
- `src/lib/instagram/parse-webhook.ts`
- `src/lib/whatsapp/parse-webhook.ts`
- `src/app/b/[slug]/inbox/[conversationId]/thread-client.tsx`
- `src/components/dashboard/inbox-workspace.tsx`
- `src/lib/dashboard/language/messages.ts`
- `src/lib/dashboard/language/language.test.ts`

Puna në `docs/qa-audit/`, worktree W6a dhe skedarët e core/P1 nuk janë ndryshuar nga kjo fazë.

## Rezultate

| Gate | Rezultati | Lloji i provës |
| --- | --- | --- |
| Vitest i plotë | 2,550 PASS / 229 files | Unit/kontrata; përfshin P0/P1/R4, jo LLM live |
| Reactions SQL | 20 PASS | Auth, PostgREST, PostgreSQL dhe konkurrencë reale lokale |
| Reactions browser | 2 PASS | Inbox IG/WA, reload gjatë POST-it, dështime/unknown, retry, dy tabs, keyboard/outside-click, desktop/mobile; Meta sintetik |
| Core transport SQL | 16 PASS | FIFO, lease fencing, retry, staff ownership dhe receipts reale lokale |
| Core transport browser | 4 PASS | Inbox IG/WA + Agent Test FIFO/stop/reload/P0/P1/R4; provider/LLM sintetikë |
| Harness isolation | 21 PASS | Kontrollet e rrjetit dhe sigurisë së harness-it |
| TypeScript | PASS | `tsc --noEmit` |
| ESLint | PASS | 0 errors; 7 warnings ekzistuese të palidhura |
| Diff check | PASS | Pa gabime whitespace |

Regresionet kalojnë pa ndryshuar pritshmëritë e core-it. Para publikimit duhet verifikim i miratuar me llogari testimi Meta për versionin efektiv, lejet/subscriptions, shfaqjen reale te klienti, echo-t dhe dështimet asinkrone. Heqja manuale WhatsApp mbetet e çaktivizuar; unknown nuk ka auto-unblock pa provë autoritative. Pranimi i plotë live mbetet **PARTIAL / UNVERIFIED**, jo PASS production.

Screenshots me të dhëna sintetike, pa transicione të kapura në mes: `.e2e-local/instances/messages-20261024/reactions-{instagram,whatsapp}-{desktop,mobile}.png`. Instagram u provua në dark theme, WhatsApp në light theme. Kopja e kodit të aplikacionit të përdorur nga browser-i u krahasua me burimin aktual; ndryshojnë vetëm skedarë testesh, jo kodi i aplikacionit.

## Riprodhimi i provave

Komanda, me Node 22 dhe vetëm ambientin lokal:

```sh
E2E_INSTANCE=messages-20261024 node e2e/local.mjs up
E2E_INSTANCE=messages-20261024 node e2e/transport.mjs
E2E_INSTANCE=messages-20261024 node e2e/local.mjs app-transport
E2E_INSTANCE=messages-20261024 node e2e/message-reactions.mjs
E2E_INSTANCE=messages-20261024 node e2e/message-transport.mjs
E2E_INSTANCE=messages-20261024 node node_modules/.bin/playwright test --config=e2e/playwright.reactions.config.mjs
E2E_INSTANCE=messages-20261024 node node_modules/.bin/playwright test --config=e2e/playwright.transport.config.mjs
node node_modules/.bin/vitest run
node --test e2e/*.test.mjs
node node_modules/.bin/tsc --noEmit
node node_modules/.bin/eslint .
git diff --check
```

Mos ekzekuto dy suites browser paralelisht: provider-i sintetik përdor të njëjtin port loopback. Testet përdorin Auth/PostgREST/PostgreSQL real lokal dhe UI/API reale, por **Meta dhe LLM janë sintetikë**. Nuk certifikojnë sjelljen live, subscriptions, llogaritë/versionet efektive, dorëzimin real ose pamjen në aplikacionet e klientëve.
