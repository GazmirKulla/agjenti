# Plani: importi CSV që lexon skedarin e klientit + çmime fleksibël

Rasti: një biznes druri (CSV `katalogu_drurit.csv`) me kolonat
`Produkti, Çmimi minimal (ALL), Çmimi maksimal (ALL), Njësia e çmimit, Gjatësia (m), Trashësia (cm), Gjerësia, Përmasa / seksioni, Shënime`.
Qelizat kanë disa vlera (`2; 3; 4`), çmime nga–deri për m³, dhe "Çmimi sipas kërkesës".

**Parimi:** klienti nuk mëson strukturën tonë. AI propozon një *plan leximi*, kodi e zbaton në mënyrë
deterministe, pronari e rishikon me fjalë të thjeshta dhe e miraton. AI nuk shkruan vlera, çmime ose stok.

## Çfarë është bërë (në main)

- `cf06532` (ueb) dhe `b8269cf` (mobile): fushat e biznesit, variantet me SKU/çmim, CSV me kolona shtesë
  dhe grupim në variante, agjenti pyet për variantin, porosia merr çmimin e variantit.
  Migrimi `20261114120000_product_fields_variants.sql` u aplikua në Supabase.

## Hapi 1: Çmimi fleksibël për produktet

Migrimi `supabase/migrations/20261114180000_product_price_modes_choices.sql` **është shkruar dhe kalon
në Postgres lokal, por NUK është aplikuar ende.** Ai shton:
- `products.price_mode` (`fixed` | `from` | `range` | `request`), `products.price_max`, `products.price_unit` (m³, copë, m…).
- `businesses.product_import_plans` (plani i leximit të CSV-së, i mbajtur sipas titujve të kolonave).
- `apply_product_csv_import_before_actions` pranon `price_mode`, `price_max`, `price_unit`.
- `submit_process_order` dhe `create_manual_order`: pa çmim varianti, porositet vetëm produkti me çmim `fixed`
  (përndryshe `price_on_request`); kontrollon vlerat nga lista e zgjedhjeve të produktit.

Kodi që mbetet:
- `src/lib/products/parse.ts`, `commands.ts`: lexojnë/ruajnë `price_mode`, `price_max`, `price_unit`
  (te rruga vizuale, përditësim pas ruajtjes, sepse `save_products_with_visual_flow` nuk i njeh).
- `src/lib/products/activation.ts`: lejon aktivizimin pa çmim kur `price_mode = request`.
- `src/components/dashboard/product-fields.tsx`: zgjedhja e mënyrës së çmimit, "deri", njësia.
- `src/lib/products/catalog.ts` `productMoney` dhe lista: "70 000–80 000 Lekë / m³", "Sipas kërkesës".
- `src/lib/orchestration/order-context.ts` `readOrderTerms`: jo-fikse pa variant → `product_unavailable`.
- `src/app/api/.../products/route.ts`: porosia manuale tregon vetëm produktet që kanë çmim të porositshëm.

## Hapi 2: Vlerat e lejuara për produkt (zgjedhje pa rreshta variantesh)

- Fusha me "Zgjedh klienti" mban te produkti një listë: `attributes.gjatesia = ["2","3","4"]`.
  Rreshtat e varianteve mbeten vetëm kur një zgjedhje ka çmim/SKU tjetër (rreshtat fitojnë).
- `src/lib/items/kinds.ts` / `fields.ts`: tipi i vlerës lejon `string[]`; forma ka "Vlerat që zgjedh klienti (ndaji me ;)".
- `src/lib/orchestration/order-context.ts` `composeVariantChoices`: merr vlerat nga rreshtat ose nga lista.
- `src/lib/agents/business-grounding.ts`: "Gjatësia: 2, 3, 4 m"; `price()` tregon nga–deri, njësinë, sipas kërkesës.

## Hapi 3: Plani i leximit me AI

- `src/lib/products/import-model.ts`:
  - fusha të reja importi `price_max`, `price_unit`; njohje e titujve "Çmimi minimal/maksimal", "Njësia", "Shënime" → përshkrim;
  - qelizat me `;` ose `|` ndahen në disa vlera për fushat "Zgjedh klienti";
  - fjalët "Të ndryshme", "-", "sipas kërkesës" nuk janë vlera (pa kufizim);
  - rresht pa çmim + tekst "sipas kërkesës" → `price_mode = request`; min+max → `range`;
  - njësia nga titulli: "Gjatësia (m)" → fusha "Gjatësia", njësia "m".
- `src/lib/products/import-evaluation.ts` + `prompts/katalogu/importi-csv.md`: AI kthen edhe propozime për kolonat
  e panjohura (`fushë` | `zgjedhje` | `çmimi maksimal` | `njësia` | `përshkrim` | `injoro`, emri, njësia).
- `src/components/dashboard/product-csv-import.tsx`: "Plani i leximit" me fjali ("Gjatësia (m): klienti zgjedh 2, 3, 4"),
  butoni "Prano propozimet" (krijon fushat dhe lidh kolonat), pastaj rishikimi i rreshtave si sot.
- Pas miratimit, plani ruhet te `businesses.product_import_plans`; CSV me të njëjtët tituj lexohet vetë.

## Hapi 4: Shablloni

- Butoni "Shkarko shabllonin" krijon CSV me kolonat tona + fushat e biznesit (në klient, pa server).

## Mobile

- `src/components/import-review.tsx`: emrat e `price_max`, `price_unit`, `price_mode`; vlerat-listë.
- `src/components/conversation-forms.tsx`: produktet "sipas kërkesës" nuk shfaqen te porosia manuale.

## Provat

1. Postgres lokal me të gjitha migrimet (skripti në scratchpad: stub-et e Supabase + `apply.sh`).
2. `npx tsc --noEmit`, `npx eslint src`, `npx vitest run`; mobile `npx tsc --noEmit`, `npx expo lint`, `npm test`.
3. Te "Biznes provë 2": importo `katalogu_drurit.csv`, kontrollo planin, produktet (çmimi nga–deri / m³,
   sipas kërkesës), listat e gjatësive/trashësive, çfarë sheh agjenti; pastaj fshi të dhënat e provës.
4. Apliko migrimin para push-it të kodit; push në main për të dy repot.

## Kufizime të mbetura

- Sasia te porosia e agjentit është ende 1; çmimi për m³ kërkon sasi me presje (p.sh. 0.5 m³). Hap më vete.
- Stoku për variant (Faza 3 e mëparshme) nuk është bërë.

## Si u zbatua (ndryshime nga plani)

- Migrimi u zgjerua (ende i paaplikuar): `save_products_with_visual_flow` ruan vetë `price_mode`, `price_max`, `price_unit`
  (pa përditësim pas ruajtjes), dhe `configure_product_batch` aktivizon produktet "sipas kërkesës" pa çmim
  (`product_price_ready`). Kufizim i ri: `range` kërkon të dy çmimet.
- Nuk ka lista fjalësh për "Të ndryshme", "-" ose "sipas kërkesës". AI propozon te plani, për çdo kolonë, vlerat që
  nuk janë vlerë (serveri i pranon vetëm nëse ndodhen në atë kolonë) dhe, për gjithë skedarin, nëse rreshtat pa asnjë
  çmim janë "sipas kërkesës". Pronari i sheh si fjali dhe i miraton.
- Plani: `src/lib/products/import-plan.ts` (validimi, fjalitë, lidhja me fushat); `acceptImportPlan` shton fushat,
  ruan planin sipas titujve dhe krahason rreshtat. Fusha të reja shton vetëm pronari.
- Qelizë me disa vlera (`2; 3; 4`) → listë te produkti; atëherë të gjitha kolonat "Zgjedh klienti" të rreshtit bëhen lista.
  Rreshta me të njëjtin emër dhe lista → konflikt.
- Shablloni njihet pa AI: "Çmimi maksimal" dhe "Njësia e çmimit" lexohen nga titulli ynë.
- Te ueb-i pronari ndryshon çdo kolonë te karta e planit (çfarë është, emri dhe njësia e fushës së re, "Sipas kërkesës"); plani përfshin gjithmonë të gjitha kolonat.
- Mobile: rishikimi tregon planin dhe "Prano propozimet" (`mode: accept_plan`); porosia manuale nuk ndryshoi,
  sepse lista vjen nga serveri.
