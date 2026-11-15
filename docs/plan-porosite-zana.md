# Plan: porositë e agjenti.app → API e Zana Store

Status: hetim, pa ndryshime kodi, pa migrime. Me leje u lexuan vetëm konfigurimi i Zana-s te agjenti.app dhe katalogu live (`GET`); asnjë porosi nuk u dërgua.

**Vendim i përdoruesit (14.11.2026):** në këtë fazë porosia krijohet te Zana vetëm kur pronari shtyp “Krijo” në bisedën me klientin (porosia manuale, `create_manual_order`), jo automatikisht nga agjenti.

## 0. Para porosive: katalogu i Zana-s dhe produktet e agjenti.app

Burimi: repo-ja e Zana Store (`/Users/gazmirkulla/Documents/projects/puzzle`), lexuar lokalisht. Katalogu live në `zana-store.com` **nuk u thirr** (kërkon sekretin dhe leje).

### Si funksionon sot te Zana
- `GET /api/integrations/agjenti/catalog` (`app/api/integrations/agjenti/catalog/route.ts` → `src/lib/integrations/agjenti-catalog-response.ts`), Bearer `AGJENTI_APP_SECRET`.
- Modeli i Zana-s: **lloje produktesh** (`product_types`: puzzle, custom_puzzle, poster, print, canvas, tshirt; `apparel` vetëm te tshirt) → **formate** (`formats` + `format_prices`, p.sh. 30x40, me çmim) → **shtesa** sipas formatit (korniza, dizajn) → **ngjyra** (`garment_colors`, vetëm për veshjet) → **produkte/dizajne** të publikuara (`products.published`).
- Përgjigjja: `products[] = {id, name, productType, price: null, currency: "ALL", formats[{id, name, price}], colors[{id: slug, name}]}` + `productTypes[]` + `formats[]` (me `addons`).
  - Çmimi është gjithmonë te formati; `price` i produktit është gjithmonë `null`.
  - `colors` u jepen **të gjitha produkteve**, edhe puzzle-ve/posterave që nuk kanë ngjyrë.
  - Nëse nuk ka asnjë produkt të publikuar, kthehen **llojet** si produkte (`id = "puzzle"` etj.).
  - Shtesat (`addons`) dalin vetëm te `formats[]`, jo brenda produktit.
- `POST /api/integrations/agjenti/orders` (`src/lib/integrations/agjenti-orders.ts`) **ekziston**: pranon `customer{name, phone, address, city}` dhe `items[{productId, productType, formatId, colorId, quantity, character, photoUrls}]`.
  - `formatId` është **i detyrueshëm** dhe duhet të jetë ID-ja e formatit te Zana; `colorId` (slug) është i detyrueshëm për veshjet.
  - Çmimin e rillogarit vetë nga `format_prices`, duke shtuar transportin sipas qytetit. `totalAmount`/`unitAmount` tonat injorohen.
  - Kthen `{ok: true, orderId: "ord_…", orderNumber}`; për dështim `{ok: false, reason}` (jo `error`) me HTTP 400/500.
  - **Nuk e lexon `X-Agjenti-Submission-Id`**: i njëjti dërgim dy herë krijon dy porosi.
  - Shtesat (korniza, dizajni) nuk pranohen në porosi.

### Si e merr agjenti.app sot
- Faqja “Lidh produktet e importuara” (`src/app/b/[slug]/products/imports/page.tsx`) lidh çdo produkt vetëm me `external_id`, `name`, `price` (= `null` → “Pa çmim”) dhe `currency`. **Formatet, ngjyrat, llojet dhe shtesat humbasin.**
- Produkti i lidhur del draft pa çmim dhe pa variante. Për ta aktivizuar dhe porositur, pronari duhet t’i rikrijojë formatet me dorë si variante (`product_variants`) dhe çmimet si numra. Kjo krijon dy burime të së vërtetës: kur Zana ndryshon çmimin, agjenti e ruan të vjetrin. Zana vetë e ndalon këtë (“Never fall back to saved prices”).
- Agjenti në bisedë dhe porosia manuale lexojnë vetëm kopjen lokale; katalogu live lexohet vetëm në faqen e importit dhe në testin e lidhjes.
- Specifikimi që ne i japim webit (`website-specifications.tsx`) përshkruan ende modelin e vjetër (`formats`/`colors`, pa variante, `price_mode`, `price_unit` apo fusha). Zana e ndjek saktë këtë specifikim, prandaj problemi është te kontrata jonë, jo vetëm te Zana.

### Përputhja me modelin e ri të produkteve në agjenti.app

| agjenti.app (tani) | Zana | Përputhja sot |
|---|---|---|
| `products.external_id` | `products[].id` (ose id e llojit) | ✔ ruhet |
| `product_types` | `productType` / `productTypes[]` | ✘ nuk importohet |
| `product_variants` (`options`, `sku`, `price_amount`) | `formats[]` me çmim | ✘ nuk importohen; varianti s’ka `external_id` |
| listë zgjedhjesh `attributes.<çelës> = [...]` | `colors[]` (vetëm veshjet) | ✘ nuk importohen |
| `price_mode` `fixed/from/range/request` | çmimi sipas formatit | ✘ produkti del pa çmim; mund të shfaqej si `from` (çmimi më i ulët i formatit) |
| `price_unit`, sasi me presje | copë të plota | – nuk nevojitet |
| fusha produkti/workflow (personazhi, foto) | `character`, `photoUrls` | ✘ nuk dërgohen në mënyrë të strukturuar |
| shtesa | `addons` sipas formatit | ✘ nuk ekziston koncept te ne; Zana s’i pranon në porosi |

**Pasoja:** një porosi për Zana sot do të refuzohej me `invalid_format`. Payload-i ynë merr `formatId` nga fusha e vjetër `collect_size`, ndërsa variantet e reja ruhen si `variant_<çelës>` me UUID-në tonë, prandaj `formatId` del bosh ose i panjohur.

### Si duhet të funksionojë (propozim)
1. **Kontrata e katalogut v2** (në specifikim, gjenerike për çdo web; mbetet e pajtueshme me fushat e vjetra):
   `products[] = {id, name, description?, imageUrl?, productType?, priceMode, price, priceMax?, priceUnit?, currency, options[{key, label, values[{id, name}]}], variants[{id, options{key: valueId}, sku?, price, active}]}`.
   Zana: çdo format bëhet variant me `id = format_id` dhe çmimin e vet; ngjyrat bëhen opsion `color` vetëm për veshjet; `priceMode = "from"` me çmimin më të ulët.
2. **Importi/sinkronizimi** te agjenti.app: lidhja krijon produktin + variantet me `external_id` + listat e zgjedhjeve me ID të jashtme. Një “Rifresko nga webi” përditëson çmimet dhe çaktivizon variantet që mungojnë. Për produktet `source = 'linked'`, çmimet dhe variantet janë vetëm për lexim (burimi i vetëm është Zana).
3. **Porosia** dërgon `productId = products.external_id`, `formatId = product_variants.external_id`, `colorId = id-ja e jashtme e ngjyrës së zgjedhur`. Para dërgimit verifikohet që varianti ka `external_id`; përndryshe porosia mbetet lokale me një gabim të qartë.
4. **Ndryshime te Zana** (repo `puzzle`, me pronarin): mos u jep ngjyra produkteve jo-veshje; vendos se a duhen llojet si produkte kur s’ka dizajne; pranoje `X-Agjenti-Submission-Id` për të shmangur dyfishimin; kthe edhe `error` krahas `reason`; vendos për shtesat (korniza, dizajni).
5. **Migrim i nevojshëm** (miratim + koordinim me sesionin e varianteve): `product_variants.external_id` (unik për produkt) dhe vlera të jashtme për listat e zgjedhjeve.

**Mungon ende për porosinë manuale (“Krijo” në bisedë):** `create_manual_order` merr vetëm `variantId`. Nuk ruan zgjedhjen e ngjyrës (listë zgjedhjesh) dhe as personazhin/fotot, që Zana i kërkon për veshjet dhe puzzle-t me porosi.

### Të dhënat reale (14.11.2026, me leje; vetëm lexim, sekreti nuk u printua)
- **Konfigurimi te agjenti.app:** `catalog_source = external`; `catalog_url = zana-store.com/api/integrations/agjenti/catalog`; `orders_url = zana-store.com/api/integrations/agjenti/orders` (**është vendosur**); sekreti ekziston. Politika `local_orders` nuk ekziston, prandaj porositë e agjentit presin konfirmimin e stafit. `product_fields` e biznesit: 0.
- **Katalogu live (`GET`, HTTP 200):** 4 produkte, 6 lloje, 12 formate.
  - Bluza me Foto, Bluza me Personazhe (`tshirt`, veshje); Foto në Puzzle, Puzzle me Personazhe (`custom_puzzle`).
  - Formatet `custom_puzzle`: A4 24/54/96 copëza = 1800, A3 48/108 = 2700, A2 216 = 4500. Shtesa: “Bazë mbështetëse” +400 (`has_frame`) te formatet A4.
  - Formatet `tshirt` janë masa/mosha: 2, 4, 6, 8 = 1200; 10, 12 = 1400.
  - Çdo produkt ka `price: null`, 6 formate dhe **7 ngjyra**, edhe puzzle-t.
  - Llojet poster, print, canvas, puzzle janë aktive, por pa formate me çmim, prandaj nuk dalin.
- **Produktet e biznesit `zana` te agjenti.app:** 4 të lidhura, të gjitha me `external_id` që përputhet me katalogun live. Të gjitha janë **aktive**, me `price_mode = fixed`, **`price_amount = null` dhe 0 variante**. Ka edhe 1 produkt manual (“Puzzle i personalizuar me foton e produktit”, 2200, pa `external_id`).
- **Pasojat:**
  - “Krijo” në bisedë për çdo produkt të lidhur do të dështonte me `price_missing`, sepse produkti s’ka çmim e as variante.
  - Agjenti nuk ka çmime për t’i thënë klientit.
  - Produkti manual mund të porositet lokalisht, por te Zana s’ka korrespondues: do të refuzohej.
  - Ekziston 1 porosi manuale `confirmed`, vetëm lokale.
- **Një paqartësi më shumë:** produkti i lidhur u aktivizua pa çmim. Duhet parë pse kontrolli i aktivizimit e lejoi.

## 1. Çfarë ekziston sot

**Lidhja me webin e biznesit (gjenerike, jo vetëm për Zana)**
- Tabela `integrations` (`kind = 'http'`, një rresht për biznes): `catalog_url`, `orders_url` (opsionale), `secret_ciphertext` (i enkriptuar me `TOKEN_ENCRYPTION_KEY`). Ruhet te Integrimet → Webi i biznesit (`src/components/dashboard/website-integration.tsx`). `businesses.catalog_source = 'external'`.
- `src/lib/integrations/zana.ts`: `fetchLinkedCatalog` / `probeLinkedCatalog` (GET katalogu me `Authorization: Bearer <sekreti>`) dhe **`submitExternalOrder`**, që tashmë bën `POST` te `orders_url` me `Bearer`, `X-Agjenti-Submission-Id: <attempt_id>`, `redirect: manual`, timeout 20s, dhe pret `{"ok": true, "orderId": "..."}`.
- Kontrata e porosive për zhvilluesin e webit është e dokumentuar në UI: `src/components/dashboard/website-specifications.tsx` (`POST /api/integrations/agjenti/orders`, përgjigje `{"ok":true,"orderId","orderNumber"}` / `{"ok":false,"error"}`).
- Produktet e lidhura: `linkExternalProduct` (`src/lib/products/commands.ts`) krijon/përditëson `products` me `source = 'linked'` dhe `external_id` = ID e produktit te Zana. **Variantet (`product_variants`) nuk kanë `external_id`**, vetëm `sku`.

**Ku krijohen porositë (vetëm dy RPC krijojnë porosi; secila krijon/lidh edhe klientin)**

| Rruga | Kodi | Dërgon te Zana sot? |
|---|---|---|
| Agjenti në bisedë, me leje “porosi lokale” (`business_automation_policies.local_orders`) | `orderAdapter` (`src/lib/orchestration/order.ts`) → `submit_process_order` me `p_user = null` | **Jo.** Del `local_only`, `orders.status = 'confirmed'`. |
| Agjenti pa atë leje → porosia pret stafin | `process_order_reviews` → stafi konfirmon: `submitConfirmedOrder` (`src/lib/orders/submission.ts`) → `submit_process_order` me `p_user` | **Po**, nëse ka `orders_url`: `settleReceipt` → `submitExternalOrder` → `finish_order_submission`. |
| Porosi manuale nga biseda/Inbox | `createManualOrder` (`src/lib/orders/manual.ts`) → `create_manual_order` | **Jo.** Shënuar shprehimisht te `manual-surfaces.ts`: “nothing is sent externally”. Nuk krijon rresht në `order_submissions`. |

Pra, mekanizmi i dërgimit ekziston, por punon vetëm kur stafi konfirmon me dorë porosinë e agjentit. Porositë automatike dhe ato manuale mbeten lokale.

**Ledger-i dhe idempotenca**
- `order_submissions` (një rresht për porosi, `attempt_id` unik, statuset `pending_reconciliation | local_only | accepted | rejected`, `external_order_id`, `reconciled_by`, `reconciliation_evidence`).
- Rregulli aktual: leja për dërgim jepet **një herë**, brenda transaksionit që krijon porosinë. Timeout/gabim rrjeti → `pending_reconciliation`; **nuk ridërgohet kurrë automatikisht**, sepse kontrata e Zana-s nuk garanton idempotencë. Stafi pajton me provë (`reconcile_order_submission`). Faqja e porosive e shfaq “Për verifikim nga stafi”.
- `integration_logs` regjistron vetëm ok/failed, pa payload.

**Payload-i që dërgohet sot** (ndërtohet në `submit_process_order`, migrimi `20261114200000_order_unit_quantities.sql`):
`channel`, `customer{name, phone, city, address}`, `currency`, `totalAmount`, `items[1]{productId = products.external_id ?? id, variantId (UUID i agjenti), sku, productType, formatId = fields.collect_size, colorId = fields.collect_color, character = fields.collect_theme, options, quantity, unitAmount, currency}`.

**Infrastruktura e ripërdorshme**
- pg_cron + `CRON_SECRET` → `/api/cron/*` (p.sh. `workflow-inbound`, `mobile-notifications`, `business-attention`). Mund të shtohet një cron për dërgimin e porosive.
- Njoftime për stafin: `mobile_notification_events` → `deliverMobileNotifications` (lloji `notice`), dhe monitori `business-attention`. Ripërdorim i mundshëm për “sinkronizimi dështoi”.
- Nuk ka outbox të përgjithshëm; `order_submissions` është vendi natyral për të.

## 2. Rrjedha e propozuar

1. **Porosia ruhet lokalisht si sot** (asnjë thirrje HTTP brenda transaksionit). Në të njëjtin transaksion, nëse biznesi ka `orders_url` dhe ka aktivizuar sinkronizimin automatik, shkruhet në `order_submissions` statusi i ri **`queued`** (= ende i padërguar, i sigurt për t’u dërguar). Kjo vlen për të tri rrugët (agjent automatik, konfirmim nga stafi, manuale).
2. **Dërguesi** (`src/lib/orders/dispatch.ts`, i ri): merr rreshtat `queued` me lease (`for update skip locked`), i kalon në `pending_reconciliation` *para* `POST`-it, thërret `submitExternalOrder`, pastaj `finish_order_submission`. Thirret:
   - menjëherë pas krijimit (në Node, me `after()` / pas kthimit të RPC-së), dhe
   - nga cron-i `/api/cron/order-dispatch` për rastet kur procesi ra para dërgimit.
3. **Rifillimi:**
   - Para dërgimit (`queued`): rifillim automatik i sigurt, me `attempts` dhe `next_attempt_at` (backoff).
   - Pas dërgimit me rezultat të paqartë (timeout, 5xx): **ridërgim automatik vetëm nëse Zana konfirmon idempotencën** sipas `X-Agjenti-Submission-Id` (kthen të njëjtin `orderId` për të njëjtin ID). Pa këtë, mbetet `pending_reconciliation` + njoftim për stafin, si sot.
   - `rejected` (4xx me `ok:false`): nuk ridërgohet; njoftim për stafin me arsyen e sigurt.
4. **Statusi te porosia:** `orders.status`/`external_order_id` përditësohen si sot nga `finish_order_submission`; faqja e porosive shfaq edhe “Në radhë për Zana”. Mbetet pajtimi manual ekzistues.
5. **Njoftimi:** për `rejected` dhe `pending_reconciliation` më të vjetër se X minuta → `mobile_notification_events` (`notice`) për stafin e biznesit.

Asgjë nuk është e veçantë për Zana në motor: sjellja varet nga konfigurimi i integrimit të biznesit.

## 3. Ndryshimet e nevojshme

**Migrime (kërkojnë miratim; asnjë nuk është bërë)**
1. `order_submissions`: shto statusin `queued`, `attempts int`, `next_attempt_at`, `last_error_code`, `leased_until`/`lease_token`; lejo rreshta për porositë manuale (`confirmation_id` = id e porosisë, `executor_kind = 'owner_manual'`).
2. `integrations`: `orders_auto_sync boolean default false` (pëlqim i qartë i pronarit) dhe `orders_idempotent boolean default false` (deklarim që webi e respekton `X-Agjenti-Submission-Id`).
3. `submit_process_order`: në degën automatike dhe atë të stafit, kur `orders_auto_sync` është aktiv → `queued` në vend të `local_only` / `dispatch:true`.
4. `create_manual_order`: krijo rreshtin `queued` kur `orders_auto_sync` është aktiv; payload-i ndërtohet me të njëjtin funksion SQL (të ndahet në një helper, që të mos ketë dy formate).
5. RPC të reja: `claim_order_dispatch(...)`, `release_order_dispatch(...)`.
6. (Me koordinim) `product_variants.external_id` — **skedarët e varianteve i ka një sesion tjetër; nuk preken nga ky plan pa marrëveshje.**

**Kodi**
- `src/lib/orders/dispatch.ts` (i ri) + `src/app/api/cron/order-dispatch/route.ts` (i ri) + rreshti te `supabase/operations/workflow-worker-schedule.sql`.
- `src/lib/orders/submission.ts`: `settleReceipt` kalon te dërguesi i përbashkët.
- `src/lib/orders/manual.ts` dhe `src/lib/actions/operations/manual-surfaces.ts` (hiqet përjashtimi “nothing is sent externally” vetëm kur sinkronizimi është aktiv).
- `src/lib/integrations/zana.ts`: kërko `https:` për `orders_url` (sot lejohet edhe `http:`); dallo 408/429/5xx si “mund të riprovohet” vetëm kur `orders_idempotent`.
- `website-integration.tsx`: dy çelësat e rinj; `website-specifications.tsx`: kontrata e idempotencës.
- `src/app/b/[slug]/orders/page.tsx`: statusi `queued`, numri i provave, gabimi i fundit.
- Teste: porosi pa `orders_url` (mbetet lokale), dështim para/pas dërgimit, ridërgim me të njëjtin `attempt_id`, `rejected`, lease i humbur, dy dërgues njëkohësisht, porosi manuale, izolim mes bizneseve. Prova vetëm te “Biznes provë 2” me një endpoint mock lokal.

## 4. Rreziqe

- **Produkt pa `external_id`** (produkt i brendshëm te Zana): sot dërgohet UUID-i i agjenti si `productId`, që Zana nuk e njeh. Propozim: mos e dërgo; statusi `rejected` lokal me kod `unmapped_product` dhe njoftim.
- **Variantet:** payload-i dërgon `variantId` = UUID i agjenti; `formatId`/`colorId` merren nga fushat e vjetra `collect_size`/`collect_color`, ndërsa variantet e reja ruhen si `variant_<çelës>`. Me modelin e ri të varianteve këto ID ka shumë mundësi të dalin bosh/të gabuara për Zana. Duhet `external_id` te varianti ose mapping te formatet/ngjyrat e katalogut të Zana.
- **Çmimet:** porositë “sipas kërkesës”/nga–deri refuzohen tashmë para krijimit (`price_on_request`), pra nuk dërgohen. Mbetet pyetja nëse Zana pranon çmimin tonë apo e rillogarit.
- **Sasia:** rruga e agjentit mbështet vetëm një produkt dhe sasi 1 (ose sasi njësie); porosia manuale lejon sasi deri 999 — duhet të njëjtin format payload-i.
- **Të dhëna personale:** dërgohen vetëm emri, telefoni, qyteti, adresa; vetëm me HTTPS; asnjë payload në `integration_logs`; dërgimi ndodh vetëm kur pronari aktivizon sinkronizimin (duhet përmendur te kushtet/privatësia).
- **Kredencialet:** i njëjti sekret përdoret për katalogun dhe porositë; ruhet i enkriptuar dhe nuk printohet. Vërejtje e palidhur: faqja e integrimit e dekripton sekretin dhe ia jep UI-së (`storedSecret`) — vlen një rishikim më vete.
- **Dyfishimi:** pa idempotencë te Zana, ridërgimi pas timeout-i mund të krijojë dy porosi; prandaj rregulli “mos ridërgo” mbetet derisa Zana ta konfirmojë.

## 5. Pyetje për pronarin e Zana Store

1. A ekziston endpoint-i i porosive? URL-ja e plotë HTTPS (p.sh. `/api/integrations/agjenti/orders`) dhe a përdor të njëjtin sekret Bearer si katalogu?
2. A mund ta përdorë `X-Agjenti-Submission-Id` si çelës idempotence (i njëjti ID → e njëjta porosi, pa dyfishim, kthen të njëjtin `orderId`)?
3. Si identifikohet varianti te Zana: `formatId` + `colorId` nga katalogu, një ID varianti, apo SKU? A janë këto ID të qëndrueshme?
4. Cilat fusha janë të detyrueshme (email, qyteti nga listë, kodi postar, mënyra e pagesës, transporti, shënimi)? A duhet krijuar klienti veçmas apo mjafton `customer` brenda porosisë?
5. A e pranon Zana çmimin/totalin tonë apo e rillogarit vetë? Si trajtohet ndryshimi i çmimit?
6. Cilat kode gabimi kthen (produkt i panjohur, jashtë stokut, të dhëna të pavlefshme) dhe cilat janë të përkohshme?
7. A ka ambient testimi (staging) ku mund të dërgojmë porosi provë? Limite kërkesash?
8. A duhet të dërgohen edhe porositë manuale nga Inbox-i, apo vetëm ato të agjentit?
9. (Opsionale) A duan që Zana të na njoftojë për ndryshimin e statusit (webhook kthyes)?

## 6. Vendime për përdoruesin

- Miratimi i migrimeve 1–5 (dhe koordinimi për 6 me sesionin e varianteve).
- Sinkronizim automatik pa konfirmim stafi për porositë e agjentit, apo vetëm pas konfirmimit (siç punon sot)?
- Leje për të lexuar konfigurimin aktual të Zana-s (`orders_url`, produktet e lidhura, politika `local_orders`) pa printuar sekrete.

## 7. Kontrata v2: katalogu përshkruan edhe çfarë kërkon porosia

Ideja: webi i biznesit deklaron vetë **çfarë duhet zgjedhur dhe mbledhur** për çdo produkt. Agjenti.app nuk mban rregulla për Zana apo për lloje produktesh. Nga kjo deklaratë ndërtohen:
- variantet dhe zgjedhjet te produkti i lidhur;
- hapat që agjenti mbledh në bisedë (workflow-i i produktit);
- formulari “Krijo” në bisedë;
- payload-i i porosisë.

### Fushat dinamike që mund të ketë porosia e një biznesi

| Niveli | Lloji (`type`) | Shembull | Te agjenti.app bëhet |
|---|---|---|---|
| Produkt → opsion varianti | `choice` me `values[{id, name}]`, ndikon çmimin | formati/masa (A4 24 copëza, masa 6) | `product_variants` me `external_id` dhe `options` |
| Produkt → zgjedhje pa çmim | `choice` | ngjyra, druri, ana e majtë/djathtë | listë zgjedhjesh `attributes.<key>` me ID të jashtme |
| Produkt → shtesë | `addon` `{id, name, price, appliesToVariants?}` | “Bazë mbështetëse” +400 | zgjedhje opsionale me çmim shtesë |
| Artikull → e dhënë personalizimi | `text` (`maxLength`), `number` (`min`, `max`), `boolean`, `date` | emri në bluzë, personazhi, data e eventit | hap `text`/`choice` në workflow + fushë te “Krijo” |
| Artikull → skedar | `photo` / `file` (`min`, `max`, formatet) | foto referencë për puzzle | hap `photo`; URL e qëndrueshme |
| Porosi → klienti | `customer` (emri, telefoni, adresa, qyteti, email…) me `required` | email i detyrueshëm | hapi `customer` + formulari |
| Porosi → dorëzimi/pagesa | `choice` | korrier, marrje në dyqan, pagesë në dorëzim | fushë e porosisë |
| Porosi → shënim | `text` | “telefono para ardhjes” | `note` |

Çdo fushë ka: `key` (i qëndrueshëm), `label`, `type`, `required`, `appliesTo` (`order` ose `item`), dhe kushte të thjeshta deklarative kur vlen vetëm për disa raste, p.sh. `requiredWhen: {"variant": ["…"]}`. Kushtet janë të dhëna nga webi dhe validohen nga serveri, jo interpretim i tekstit.

### Kontrata e katalogut v2 (e pajtueshme me v1)
```json
{
  "version": 2,
  "currency": "ALL",
  "orderFields": [
    {"key": "email", "label": "Email", "type": "text", "appliesTo": "order", "required": false}
  ],
  "products": [{
    "id": "bluza-me-personazhe-mrrrnwz9",
    "name": "Bluza me Personazhe",
    "productType": "tshirt",
    "priceMode": "from", "price": 1200, "priceUnit": null,
    "options": [
      {"key": "size", "label": "Masa", "affectsPrice": true,
       "values": [{"id": "fmt_2", "name": "2"}, {"id": "fmt_10", "name": "10"}]},
      {"key": "color", "label": "Ngjyra", "affectsPrice": false,
       "values": [{"id": "e-bardhe", "name": "E bardhë"}]}
    ],
    "variants": [
      {"id": "fmt_2", "options": {"size": "fmt_2"}, "price": 1200, "active": true},
      {"id": "fmt_10", "options": {"size": "fmt_10"}, "price": 1400, "active": true}
    ],
    "addons": [],
    "fields": [
      {"key": "character", "label": "Personazhi", "type": "text", "appliesTo": "item", "required": true}
    ],
    "formats": [], "colors": []
  }]
}
```
`formats`/`colors` mbeten për pajtueshmëri; agjenti.app lexon v2 kur `version = 2`.

### Payload-i i porosisë v2
```json
{
  "version": 2,
  "channel": "instagram",
  "source": "owner_manual",
  "customer": {"name": "…", "phone": "…", "address": "…", "city": "…"},
  "fields": {"email": null},
  "note": null,
  "currency": "ALL",
  "expectedTotal": 1200,
  "items": [{
    "productId": "bluza-me-personazhe-mrrrnwz9",
    "variantId": "fmt_2",
    "options": {"size": "fmt_2", "color": "e-bardhe"},
    "addons": [],
    "fields": {"character": "Spiderman"},
    "files": [{"key": "photo", "url": "https://…", "contentType": "image/jpeg"}],
    "quantity": 1,
    "unitAmount": 1200
  }],
  "formatId": null
}
```
- Header-i `X-Agjenti-Submission-Id` është çelësi i idempotencës: i njëjti ID kthen të njëjtën porosi dhe nuk krijon një të re.
- Webi e rillogarit çmimin. Nëse ndryshon nga `expectedTotal`, kthen `{"ok": false, "error": "price_changed", "total": …}` dhe nuk e krijon porosinë.
- (Opsionale) `POST …/orders/quote` me të njëjtin body kthen `{ok, total, shipping, lines}` pa krijuar asgjë. Kështu pronari sheh totalin me transportin para “Krijo”.

## 8. Ndryshimet te Zana Store (repo `puzzle`)

1. **Katalogu** (`src/lib/integrations/agjenti-catalog-response.ts`): kthe `version: 2`.
   - `variants` = formatet e përputhshme me `format_id` si `id` dhe çmimin e vet; `priceMode: "from"` me çmimin më të ulët.
   - Opsioni `color` vetëm për llojet `apparel`, jo për puzzle.
   - `addons` nga `loadAddonsByFormatIds`, me `appliesToVariants`.
   - `fields` nga flamujt e llojit (`requiresCustomerPhoto` → `photo` i detyrueshëm; veshjet → `character` sipas `validateCartItemsForCheckout`), që rregullat t’i deklarojë webi.
   - Hiq ose shëno qartë rezervën “llojet si produkte” kur s’ka dizajne të publikuara.
2. **Porositë** (`src/lib/integrations/agjenti-orders.ts`):
   - Prano `variantId`/`options`, `fields`, `files` dhe `addons` (fusha v1 mbeten si rezervë).
   - Ruaj `X-Agjenti-Submission-Id` me indeks unik dhe kthe të njëjtin `orderId` për përsëritje; kjo kërkon migrim te Zana.
   - Krahaso `expectedTotal` me totalin e rillogaritur.
   - Kthe `error` (jo vetëm `reason`) dhe 409 për konflikte. Opsionalisht `…/orders/quote`.
3. **Testet** te `agjenti-orders.test.ts`: variant i panjohur, ngjyrë për produkt jo-veshje, foto e munguar, personazh i munguar, përsëritje me të njëjtin ID, çmim i ndryshuar.

## 9. Ndryshimet te agjenti.app që e bëjnë këtë të përgjithshme

- **Specifikimi dhe prompti** (`website-specifications.tsx`, `website-prompt-en.ts`): zëvendësohen me kontratën v2 (prompti më poshtë).
- **Importi i produkteve të lidhura:** krijon variantet, zgjedhjet, shtesat dhe fushat nga katalogu. “Rifresko nga webi” mban çmimet të sinkronizuara. Te produktet `linked`, çmimi dhe variantet janë vetëm për lexim. Kërkon `product_variants.external_id` (me koordinim).
- **Workflow-i i produktit:** fushat `item` të deklaruara bëhen hapa (`text`, `choice`, `photo`) të gjeneruar nga katalogu, jo të shkruar me dorë.
- **“Krijo” në bisedë** (`create_manual_order`): pranon zgjedhjet, fushat dhe skedarët. Formulari ndërtohet nga deklarata e produktit; serveri validon fushat e detyrueshme dhe ID-të.
- **Skedarët:** fotot nga Instagram/WhatsApp sot nuk ruhen në storage tonin (vetëm bucket-i `business-catalogs`), dhe URL-të e CDN-së skadojnë. Duhet ruajtje e qëndrueshme me URL të nënshkruar me afat për webin.
- **Aktivizimi:** një produkt i lidhur pa çmim dhe pa variant me çmim nuk duhet të aktivizohet (sot 4 produktet e Zana-s janë aktive pa çmim).

## 10. Prompti për zhvilluesin e webit (Integrimet → Webi i biznesit)

> Implemento në këtë repository lidhjen e webit me Agjenti.app, versioni 2 i kontratës. Agjenti lexon katalogun dhe, kur pronari e konfirmon në bisedë, krijon porosinë në sistemin ekzistues të webit.
>
> **Para ndryshimeve:** inspekto stack-un, modelet e produkteve, varianteve, çmimeve dhe shtesave, rregullat e validimit të porosisë (checkout), autorizimin dhe shërbimin e porosive. Ripërdor logjikën dhe databazën ekzistuese. Mos krijo një sistem porosish paralel; mos krijo të dhëna demonstrimi në prodhim.
>
> **1. Autorizimi:** sekreti `AGJENTI_APP_SECRET` (minimum 16 karaktere) ruhet vetëm në konfigurimin e serverit dhe vendoset edhe te Agjenti → Integrimet → Webi i biznesit. Çdo endpoint kërkon `Authorization: Bearer <sekreti>`; 401 për sekret të munguar ose të gabuar; refuzo kur serveri s’ka sekret. Në sistem me shumë biznese, kufizo të dhënat te biznesi i sekretit. JSON, HTTPS, përgjigje brenda 20 sekondave. Mos e shfaq sekretin në kod, logs, përgjigje ose raport.
>
> **2. Katalogu — `GET /api/integrations/agjenti/catalog`:** kthe `{"version": 2, "currency", "orderFields": [], "products": []}`.
> - Çdo produkt: `id`, `name` (string, të qëndrueshme); `productType`; `priceMode` (`fixed` | `from` | `range` | `request`), `price`, `priceMax`, `priceUnit`; `options[{key, label, affectsPrice, values[{id, name}]}]`; `variants[{id, options{key: valueId}, sku?, price, active}]`; `addons[{id, name, price, appliesToVariants?}]`; `fields[{key, label, type, appliesTo, required, requiredWhen?, min?, max?, maxLength?}]`.
> - `type` është një nga `text`, `number`, `boolean`, `date`, `choice` (me `values`), `photo`, `file`.
> - Deklaro **vetëm** atë që webi ka dhe kërkon realisht. Çdo rregull që checkout-i i webit e zbaton (masë, ngjyrë, foto, personazh, email, mënyrë dorëzimi) duhet të dalë si opsion ose fushë e detyrueshme, në mënyrë që Agjenti ta mbledhë para porosisë.
> - Mos jep opsione që nuk vlejnë për produktin (p.sh. ngjyra për një produkt pa ngjyra). Çmimet merren nga burimi live, pa rezerva të ruajtura. Mos ndrysho monedhën ose njësinë në heshtje.
> - Ruaj edhe `formats`/`colors` të v1 nëse ekzistojnë.
>
> **3. Porositë — `POST /api/integrations/agjenti/orders`** (kur webi ka sistem real porosish):
> - Body: `{version: 2, channel, source, customer{name, phone, address, city…}, fields{}, note, currency, expectedTotal, items[{productId, variantId, options{}, addons[], fields{}, files[{key, url, contentType}], quantity, unitAmount}]}`.
> - Valido në server me logjikën ekzistuese të checkout-it: produktin, përkatësinë e variantit dhe të opsioneve, fushat e detyrueshme, sasinë, skedarët (shkarkoji nga URL-ja brenda afatit dhe ruaji te storage i webit). Rillogarit çmimin dhe transportin.
> - Nëse totali ndryshon nga `expectedTotal`, mos e krijo porosinë: kthe 409 me `{"ok": false, "error": "price_changed", "total": …}`.
> - **Idempotenca:** `X-Agjenti-Submission-Id` është unik për çdo porosi. Ruaje me indeks unik; për të njëjtin ID kthe të njëjtën përgjigje dhe mos krijo porosi të dytë.
> - Sukses vetëm pas ruajtjes së konfirmuar: 2xx `{"ok": true, "orderId": "…", "orderNumber": 123}`. Dështim: status përkatës (400 të dhëna të pavlefshme, 409 konflikt, 5xx gabim i përkohshëm) me `{"ok": false, "error": "kod_i_sigurt", "field": "…"}`.
> - Mos shëno pagesë si të kryer.
> - Opsionale: `POST …/orders/quote` me të njëjtin body, që kthen `{ok, total, shipping, lines}` pa krijuar porosi.
>
> **4. Testet dhe dorëzimi:** testo autorizimin, katalogun bosh dhe me produkte reale testimi, çdo fushë të detyrueshme që mungon, variant/opsion të panjohur, opsion që nuk vlen për produktin, skedar të pavlefshëm, çmim të ndryshuar, përsëritjen me të njëjtin `X-Agjenti-Submission-Id` dhe gabim ruajtjeje. Mos krijo porosi reale pa autorizim. Dorëzo URL-të e plota HTTPS, migrimet/konfigurimet e nevojshme, testet e kryera dhe kufizimet. Dallo kodin lokal nga publikimi dhe mos jep sekretin.

## 11. Gjendja e implementimit (15.11.2026, lokal, pa commit)

**Zana Store (`puzzle`):**
- `agjenti-catalog-response.ts`: katalogu v2 (variante = formate, ngjyra vetëm për veshjet, shtesa, fusha nga flamujt e llojit; fushat v1 mbeten).
- `agjenti-order-requirements.ts`: një burim i vetëm për atë që kërkon artikulli (ngjyrë, personazh, foto), i përdorur nga katalogu dhe nga porosia.
- `agjenti-orders.ts` + route: pranon v1 dhe v2. Me `X-Agjenti-Submission-Id` kthen porosinë e parë për përsëritje (edhe në garë, me 23505). Kthen 409 `price_changed` kur `expectedTotal` ≠ shuma e artikujve. Fotot v2 i kopjon në storage-in e vet, dhe gabimet dalin si `error` + `field`.
- Migrim (i paaplikuar): `supabase/migrations/20261115090000_orders_agjenti_submission_id.sql`.
- Teste: 14 në `src/lib/integrations`.

**agjenti.app:**
- Migrim (i paaplikuar): `20261115160000_linked_catalog_orders.sql` — `product_variants.external_id`, `products.external_spec`, bucket privat `order-files`, `sync_linked_product`, `check_order_selection`, `create_manual_order(+p_selection)`, `begin_order_dispatch`. Provuar në PostgreSQL lokal me skemë minimale.
- `linked-catalog.ts` (normalizim v1/v2, me teste), `linked-sync.ts`, `linked-actions.ts` (“Rifresko nga webi”), `linkExternalProduct` sinkronizon pas lidhjes.
- “Krijo porosi”: zgjedhjet, shtesat, fushat dhe fotot e deklaruara (`order-files` route). Pas ruajtjes dërgohet një herë te webi (`dispatchManualOrder`), me mesazh për rezultatin.
- `submitExternalOrder`: 409 `price_changed` trajtohet si refuzim; kodi i gabimit ruhet te `integration_logs`.

**Mbetet:**
- Rruga e agjentit (porosi e konfirmuar nga stafi pas agjentit) dërgon ende v1, me `formatId` nga `collect_size`.
- Fushat e nivelit `order` (`orderFields`) nuk mblidhen ende.
- Nuk ka riprovim automatik pas një rezultati të paverifikuar.
- Fotot e klientit nga biseda zgjidhen te formulari (web dhe app): serveri i kopjon nga Instagram/WhatsApp te `order-files`, që webi të marrë lidhje të qëndrueshme. Nëse lidhja e kanalit ka skaduar, fotoja ngarkohet me dorë.
