# Plan: modeli i tregtisë në Agjenti (produkte, porosi, klientë) dhe porositë e agjentit me v2

Statusi: propozim, 15.11.2026. Asgjë nuk është ndryshuar. Migrimet ekzekutohen vetëm me miratimin e pronarit.

Vendimet e pronarit (15.11.2026):
- **Agjenti e përcakton strukturën; webet i përshtaten asaj.** Zana Store, si çdo e-commerce tjetër, e përshtat katalogun dhe API-në e porosive me kontratën e Agjentit. Agjenti nuk shton kod për formën e një webi të veçantë.
- Agjenti ka një model të vetëm, të organizuar mirë, për produktet, porositë, klientët dhe të tjerat, që vlen për çdo lloj tregtie (veshje, puzzle me foto, mobilje, ushqim, materiale me njësi).
- Workflow-i i produktit krijohet ose përditësohet vetë te «Rifresko nga webi».
- Workflow-et e Zanës mund të lexohen (vetëm konfigurimi) dhe të rigjenerohen.
- Fotot që shkojnë te webi i zgjedh pronari ose stafi kur konfirmon porosinë, jo agjenti; për çdo fushë foto zgjidhen foto të veçanta.
- API-në e Zanës e përshtat Agjenti (ky plan), pasi faza A të jetë publikuar: kështu Zana nuk humbet porositë e agjentit gjatë kalimit.
- Për provat e porosive gjatë zhvillimit lejohet Zana Store, vetëm biseda me @bora.mato24; porositë provë fshihen pas provës.

## 1. Parimet

1. **Një model, shumë burime.** Një produkt ka të njëjtën strukturë, qoftë i krijuar në Agjenti, i importuar nga CSV ose i lidhur me një web. Burimi ndryshon vetëm se kush i shkruan të dhënat dhe kush mban ID-të e jashtme.
2. **Kontrata është e Agjentit.** Katalogu dhe porosia që shkëmbehen me webet janë një skemë e publikuar dhe me version (sot v2). Një web që do të lidhet e implementon atë skemë. Përjashtime për një web të caktuar nuk ka.
3. **Asgjë e veçantë për një biznes në kod.** Çelësat e fushave (`format`, `character`, `photo`…) janë të dhëna të katalogut të biznesit, jo emra në kodin e Agjentit.
4. **Një rrugë porosie.** Pronari («Krijo porosi»), agjenti dhe konfirmimi nga stafi krijojnë të njëjtin rresht porosie dhe të njëjtat artikuj, me të njëjtat kontrolle dhe me të njëjtin payload drejt webit.
5. **Logjika e biznesit mbetet në server.** Aplikacioni mobile vetëm shfaq dhe dërgon atë që pyet serveri.

## 2. Modeli i Agjentit

### Produkti
| Pjesa | Ku ruhet sot | Modeli i synuar |
|---|---|---|
| Identiteti: emri, përshkrimi, foto, statusi, arkivimi | `products` | Si sot |
| Lloji i artikullit (produkt, shërbim, banesë…) | `products.item_kind`, `businesses.item_kind` | Si sot |
| Çmimi: `price_mode` (fixed, from, range, request), `price_unit` (m³, kg…), monedha | `products` | Si sot |
| Atributet përshkruese (materiali, përmasat) | `products.attributes`, fushat te `businesses.product_fields` | Si sot: përshkruajnë produktin, nuk i pyesen klientit |
| **Opsionet** që zgjedh klienti dhe ndryshojnë variantin (madhësia, ngjyra, formati) | Produkt vendas: `product_fields` me `variant`; produkt i lidhur: `external_spec.options` | **Një vend për të dy:** `products.spec.options` |
| **Variantet** (kombinimi i opsioneve, SKU, çmimi, gjendja) | `product_variants` (+ `external_id` për të lidhurit) | Si sot |
| **Shtesat** me çmim (tabaka, kuti dhuratë) | Vetëm `external_spec.addons` | `products.spec.addons` për çdo produkt |
| **Personalizimi** që jep klienti për artikullin (teksti, personazhi, data, foto, skedar) | Produkt vendas: vetëm te workflow-i; produkt i lidhur: `external_spec.fields` | `products.spec.fields` për çdo produkt |
| Fushat e porosisë (email, ora e dorëzimit) | `external_spec.fields` me `appliesTo: order` | `businesses.order_fields` (një herë për biznesin) |
| ID-të e jashtme | `products.external_id`, `product_variants.external_id`, ID-të brenda `external_spec` | Si sot; ID-të e vlerave mbeten brenda `spec` |

`products.spec` merr formën e sotme të `LinkedSpec` (`src/lib/integrations/linked-catalog.ts`): `{version, options[], addons[], fields[]}`. Te produkti i lidhur e shkruan «Rifresko nga webi»; te produkti vendas e shkruan redaktori i produktit. Kolona `external_spec` riemërtohet në `spec`, ose mbahet si alias gjatë kalimit.

### Porosia
| Pjesa | Sot | Modeli i synuar |
|---|---|---|
| Porosia: biznesi, biseda, klienti, statusi, monedha | `orders` | Si sot |
| Totalet | Vetëm `total_amount` (= artikujt) | `items_amount`, `shipping_amount`, `discount_amount`, `total_amount`. Transporti dhe totali që kthen webi ruhen kur webi i dërgon. |
| Klienti dhe adresa e dorëzimit | Brenda `orders.payload.customer` | Kolona të strukturuara: emri, telefoni, qyteti, adresa, shënimi; `payload` mbetet vetëm për historikun |
| Artikujt | `order_items` (+ `variant_id`, `selection`, `position`) | Si sot, plus `line_amount` dhe `extras_amount`. `selection = {options, fields, files, addons}` me çelësat e `spec`. |
| Kolonat e vjetra të Zanës | `order_items.product_type_key`, `external_format_id` | Hiqen pasi të mos lexohen më |
| Dërgimi te webi | `order_submissions` | Si sot, plus arsyeja e refuzimit (`reason`, `field`, `item`), që të duket te Porositë |
| Statusi i porosisë te webi | `orders.status`, `external_order_id` | Si sot; më vonë një webhook kthyes për statusin (opsional) |

### Klienti
`customers` ka sot vetëm emrin, telefonin dhe ID-të e kanalit. Qyteti, adresa dhe email-i mbeten te gjendja e bisedës. Modeli i synuar: kolonat `email`, `city`, `address` te `customers`, të përditësuara nga porosia e fundit dhe nga «Ruaj kontaktin». Kështu Inbox-i, porositë dhe aplikacioni lexojnë nga një vend.

### Kontrata me webet (v2, e Agjentit)
- **Katalogu** (`GET catalog_url`): produktet me `options`, `variants`, `addons`, `fields`, çmimet dhe `orderFields`. Është e njëjta skemë si `products.spec`.
- **Porosia** (`POST orders_url`): `version: 2`, `source` (`owner_manual`, `agent`), `customer`, `fields`, `note`, `currency`, `expectedTotal` (artikujt), `items[]` me `productId`, `variantId`, `options`, `fields`, `files`, `addons`, `quantity`, `unitAmount` (të gjitha me ID-të e webit).
- **Përgjigjja:** sukses `{ok, orderId, orderNumber, total?, shipping?}`; dështim `{ok:false, error, field?, item?}`.
- Kontrata v1 (`formats`, `colors`, `formatId`, `colorId`, `character`, `photoUrls`) del jashtë përdorimit me një datë të njoftuar. Pas saj, Agjenti nuk e lexon dhe nuk e dërgon më.

## 3. Çfarë është sot jashtë këtij modeli

1. **Rruga e agjentit dërgon v1** (`submit_process_order`, `20261114200000_order_unit_quantities.sql`):
   - `formatId = fields.collect_size`, `colorId = fields.collect_color`, `character = fields.collect_theme` janë çelësat e workflow-t të puzzle-it të Zanës;
   - `variantId` është UUID-i i Agjentit, jo `external_id`;
   - nuk dërgon foto;
   - dërgon UUID-in e Agjentit për produktet pa `external_id`.
2. **Edhe rruga v2** (`begin_order_dispatch`) u shton artikujve `formatId`, `colorId` dhe `character` vetëm për Zanën.
3. **Personalizimi i produktit vendas** ekziston vetëm te workflow-i, jo te produkti. Prandaj i njëjti produkt përshkruhet në dy vende: produkti dhe workflow-i.
4. **Dy modele opsionesh:** `businesses.product_fields` dhe `external_spec.options`.
5. **Transporti dhe totali i webit** nuk ruhen. Porosia #483 kushton 3300 Lek te Zana dhe 3000 Lek në Agjenti.
6. **Klienti dhe adresa** janë të shpërndara te `orders.payload`, `conversation_states` dhe `customers`.
7. **Mbetje të Zanës në kod:**
   - `PUZZLE_STEPS` dhe `APPAREL_STEPS` (`src/lib/workflows/engine.ts`, nuk përdoren);
   - `product_types` me `external_key` `personalized`/`puzzle`, si dhe `order_items.product_type_key` dhe `external_format_id`;
   - leximi i katalogut v1 te `linked-catalog.ts` (`fromV1`).

## 3a. Fushat hyrëse dhe fushat dalëse (fotot e përpunuara)

Një artikull ka dy lloje të dhënash:
- **Hyrëse:** atë që jep klienti që porosia të krijohet (masa, personazhi, fotoja e tij). Agjenti i pyet, dhe pa të detyrueshmet porosia nuk dërgohet.
- **Dalëse:** atë që prodhon biznesi për artikullin: dizajni ose fotoja e përpunuar, provë që i tregohet klientit, foto e produktit të përfunduar. Klienti nuk i jep, agjenti nuk i pyet, dhe nuk e ndalojnë krijimin e porosisë. Te Zana është `processedImages`, ndërsa fotot e klientit janë `customImages`. (Vendim 16.11.2026: «Foto e produktit të gatshëm» / `completionPhotos` nuk deklarohet; Agjenti mban vetëm foton e përpunuar si fushë dalëse.)

**Kontrata (katalogu v2):** çdo fushë merr `role: "input" | "output"` (parazgjedhja `input`). Shembull te Zana: `{"key": "processed", "label": "Foto e përpunuar", "type": "photo", "role": "output", "appliesTo": "item", "max": 5}`.

**Nga vjen një foto dalëse** (të katër burimet ruhen njësoj):
1. Ngarkohet te webi i biznesit (te Zana, `processedImages` në panelin e saj ose nga AI) → Agjenti e lexon nga webi.
2. Biznesi ia ka dërguar klientit në bisedë (mesazh `outbound` me `media`) → zgjidhet nga fotot e bisedës.
3. Ngarkohet me dorë në Agjenti gjatë bisedës, para porosisë («Krijo porosi» / «Konfirmo porosinë»).
4. Ngarkohet me dorë pasi porosia është krijuar (te Porositë ose paneli i klientit).

**Modeli në Agjenti:** tabelë e re `order_item_files` (një rresht për çdo skedar): `order_item_id`, `field_key`, `role`, `path` (bucket `order-files`), `source` (`customer_chat`, `business_chat`, `upload`, `website`), `external_url`, `created_by`, `created_at`, `synced_at`. Fotot hyrëse të sotme (`selection.files`) kalojnë aty gradualisht; fotot dalëse jetojnë vetëm aty, sepse ndryshojnë pas krijimit të porosisë.

**Sinkronizimi me webin (kontrata e re):**
- Me porosinë: fotot dalëse që ekzistojnë dërgohen si `files` me çelësin e tyre, si fotot hyrëse.
- Pas porosisë: `POST {orders_url}/{orderId}/files` me `{"items": [{"item": 1, "key": "processed", "files": [{"id": "…", "url": "…"}]}]}`, idempotent sipas `id` të skedarit.
- Nga webi te Agjenti: `GET {orders_url}/{orderId}` kthen artikujt me skedarët dalës (`files` me `role: output`). Agjenti e thërret kur hapet porosia ose me «Rifresko nga webi» te porosia, dhe i ruan me `source: website`.

**Ku duken:**
- Te porosia (web dhe aplikacion) dalin të ndara «Fotot e klientit» dhe «Fotot e përpunuara», me butonin «Shto foto të përpunuar» (nga pajisja ose nga fotot e bisedës, në të dyja drejtimet).
- Hap i mëvonshëm: agjenti mund t'ia dërgojë klientit foton e përpunuar për miratim.

**Fazat:**
- **O1:** kontrata `role` dhe migrimi `order_item_files`, plus fotot dalëse te «Krijo porosi» dhe «Konfirmo porosinë».
- **O2:** shtimi pas porosisë dhe `POST …/files`.
- **O3:** leximi nga webi (`GET …/{orderId}`).
- **Zana:** katalogu deklaron `processed`, porositë pranojnë `files` me `processed` → `processedImages`, dhe shtohen dy endpoint-et.

## 4. Fazat

| Faza | Çfarë | Migrim | Prek |
|---|---|---|---|
| **A** | Një ndërtues artikulli (`order_item_payload`) për të gjitha rrugët; agjenti dërgon v2; `unmapped_product`; hiqen çelësat v1 nga payload-i | Po | Web |
| **B** | Stafi zgjedh fotot kur konfirmon porosinë e agjentit | Po (`p_files`, i njëjti migrim si A) | Web + mobile (release) |
| **C** | Pyetjet e agjentit nga `spec` në çast (zëvendëson workflow-et e ruajtura) | Jo | Web |
| **D** | `products.spec` për çdo produkt: redaktori i produktit vendas shkruan opsionet, shtesat dhe personalizimin; `product_fields` mbetet biblioteka e fushave të biznesit; workflow-i gjenerohet edhe për produktet vendase | Po | Web + mobile (shfaqja e produktit) |
| **E** | Porosia: kolonat e totaleve, transporti dhe totali nga përgjigjja e webit, adresa e strukturuar, arsyeja e refuzimit te `order_submissions` | Po | Web + mobile (Porositë, paneli i klientit) |
| **F** | Klienti: `email`, `city`, `address` te `customers` | Po | Web + mobile |
| **G** | Kontrata: dokumentimi i v2 si e vetmja kontratë, `item` dhe `total`/`shipping` në përgjigje, data e daljes së v1; Zana përshtat API-në e saj | Jo (Agjenti) | Web + repo `puzzle` |
| **H** | Pastrimi pas datës së v1: `fromV1`, `product_type_key`, `external_format_id`, `PUZZLE_STEPS`, `collect_*` te `compatibility-prompts.ts` | Po | Web |

A, B dhe C zgjidhin problemin e menjëhershëm (porositë e agjentit për çdo web të lidhur). D–F e plotësojnë modelin. G dhe H e mbyllin kontratën e vjetër.

## 5. Faza A në detaje

### Ndërtuesi i artikullit
Funksion i ri `public.order_item_payload(p_business uuid, p_product uuid, p_variant uuid, p_selection jsonb, p_quantity numeric, p_unit numeric) returns jsonb`. Përmbajtja merret nga cikli i `begin_order_dispatch` (`20261115180000_manual_order_lines.sql`), pa ndryshuar sjelljen:
- produkti duhet të jetë `source = 'linked'` me `external_id`, përndryshe kthen `{"reason":"unmapped_product"}`;
- pa `external_spec` kthen `not_synced`;
- varianti pa `external_id` kthen `unmapped_variant`;
- opsionet e variantit përkthehen nga emri te ID-ja e webit, pastaj shtohen zgjedhjet e tjera, fushat, skedarët, shtesat, sasia dhe çmimi për njësi.

`begin_order_dispatch` e thërret për çdo rresht. Hiqen `formatId`, `colorId` dhe `character`. Webi i Zanës i lexon tashmë fushat v2 (`agjenti-orders.ts`, `v2 = input.version === 2`). Kjo verifikohet me një porosi provë para publikimit.

### Rruga e agjentit
Te `submit_process_order` ndryshon vetëm ndërtimi i `request_payload`; kontrollet para tij mbeten siç janë.
- Funksion i ri `process_order_selection(p_spec jsonb, p_facts jsonb, p_files jsonb)`:
  - opsionet nga `facts[key]`, nga emri i vlerës te ID-ja (edhe vetë ID-ja pranohet);
  - fushat jo-foto nga `facts[key]`;
  - fushat foto nga fotot që zgjodhi stafi (faza B).
- `items` ndërtohet me `order_item_payload`. Kur kthen `reason`, porosia mbetet lokale me arsyen, si te pronari.
- Payload-i: `version: 2`, `source: "agent"`, `expectedTotal`, `customer`, `note`.
- Rezultati kalon nga `dispatchManualOrder` dhe `refusedField`, me të njëjtat kode dhe të njëjtën pamje për pronarin.

Për Zanën, deri në fazën C, porositë e agjentit kthehen të refuzuara me fushën që mungon (p.sh. «mungon «Personazhi»») në vend që të dërgohen me të dhëna të gabuara.

## 6. Faza B: stafi zgjedh fotot

- Kur produkti ka fusha foto te `spec`, «Konfirmo porosinë» (web: `thread-client.tsx`; aplikacioni: `inbox-options.tsx`) hap përmbledhjen e porosisë dhe zgjedhësin e fotove të bisedës për secilën fushë foto. Është i njëjti zgjedhës si te «Krijo porosi» (`order-files`, `listCustomerPhotos`, `readCustomerPhoto`, vetëm nga hostet e Meta-s) dhe lejon edhe ngarkimin nga pajisja.
- `POST …/orders` dërgon `files: {çelësi: [path]}`. Serveri pranon vetëm path-e të këtij biznesi dhe kësaj bisede te `order-files`, dhe kontrollon `min`/`max` të fushës.
- `submit_process_order` merr `p_files`. `signFiles` i jep webit lidhje të përkohshme.
- Pa foton e detyrueshme, «Dërgo» nuk aktivizohet («Zgjidh foton për «Fotoja»»).
- Agjenti nuk zgjedh foto. Rruga e re regjistrohet te `src/lib/actions/operations/manual-surfaces.ts`.

## 7. Faza C: workflow-i nga `spec`

- Te «Rifresko nga webi» (`src/lib/products/linked-sync.ts`), për çdo produkt të lidhur krijohet ose përditësohet vetë një workflow linear: `choice` për çdo opsion, `text`/`number`/`date` për fushat, `photo` për fushat foto, pastaj `customer` dhe `confirm`. `fieldKey` është çelësi i `spec`.
- Pronari mund t'i ndryshojë pyetjet, por jo çelësat. Rifreskimi i radhës shton hapat për fushat e reja dhe heq ato që `spec` nuk i ka më, duke ruajtur pyetjet e ndryshuara.
- **Gatishmëria** (`workflow-readiness.ts`): kur workflow-i nuk mbledh një fushë të detyrueshme, produkti dhe Workflows tregojnë «Porositë e agjentit nuk mund të dërgohen te webi: mungon «Personazhi»».
- **Zana:** lexohen workflow-et ekzistuese (vetëm konfigurimi), ruhet një kopje dhe rigjenerohen nga katalogu.

## 8. Çfarë duhet të bëjë Zana Store (repo `puzzle`)

Zana i përshtatet kontratës së Agjentit:
1. Katalogu: e dërgon tashmë v2 (`agjenti-catalog-response.ts`, `version: 2`). Duhet vetëm të deklarojë çdo fushë që i kërkon klientit (personazhi, tema, foto) te `fields`, me `required` dhe kufijtë.
2. Porositë: të lexojë vetëm v2 (`options`, `fields`, `files`, `variantId`) dhe të heqë leximin e `formatId`, `colorId`, `character` dhe `photoUrls` pas datës së daljes së v1.
3. Gabimet: të kthejë `item` (numri i artikullit) bashkë me `field`.
4. Suksesi: të kthejë `total` dhe `shipping`, që Agjenti të tregojë totalin e vërtetë (faza E).

Ndryshimet te `puzzle` bëhen në atë repo, me miratim.

## 9. Kontrolli i migrimeve

Pas çdo migrimi kontrollohet që asnjë funksion të mos jetë mbishkruar me një version më të vjetër (pika 8 e listës):

```sql
select proname, position('order_item_payload' in prosrc) > 0 as ok
from pg_proc where proname in ('begin_order_dispatch', 'submit_process_order');
```

Rregull: një migrim që rishkruan një funksion ka gjithmonë timestamp më të ri se migrimi i fundit që e ka prekur atë funksion.

## 10. Testet

- **Vitest:**
  - `rejectionDetail` me `item`;
  - konfirmimi me foto të zgjedhura, me path të një biznesi tjetër (refuzohet) dhe pa foto të detyrueshme;
  - gjenerimi dhe rifreskimi i workflow-t nga `spec` (pyetjet e ndryshuara ruhen);
  - gatishmëria.
- **SQL** (te «Biznes provë 2», me një endpoint lokal provë si web):
  - variant dhe opsion me ID-të e webit;
  - fushë tekst dhe foto arrijnë te payload-i;
  - produkt i brendshëm mbetet `local_only` me `unmapped_product`;
  - biznes pa `orders_url` mbetet lokal;
  - asnjë katalog apo foto nuk kalon nga një biznes te tjetri.
- **Pas publikimit:** një porosi provë drejt webit të Zanës vetëm me miratim, pastaj anulimi i saj.
- Kontrollet: web `npx tsc --noEmit`, `npx eslint src`, `npx vitest run`; mobile `npx tsc --noEmit`, `npx expo lint`, `npm test`.

## 11. Gjendja

- **Faza A (15.11.2026):** migrimi `20261115200000_agent_orders_v2.sql` dhe kodi janë gati, pa commit. U provua në një bazë lokale me të 132 migrimet: `supabase/tests/agent_orders_v2.sql` dhe `order_unit_quantities.sql` kalojnë. Testet `order_submission*.sql` dhe `order_write_boundary.sql` dështonin edhe para këtij ndryshimi (`conversation_states_native_snapshot`). Migrimi ekzekutohet para publikimit të kodit, sepse kodi i ri dërgon `p_files`.
- Faza A u ekzekutua në prodhim dhe u provua me @bora.mato24: Zana pranoi porosinë v2 (#484, pastaj u fshi).
- **Zana (pjesë e fazës G), 15.11.2026:** pranon vetëm v2 (`unsupported_version`); emërton fushën e klientit që mungon (`missing_field`, `customer.address`); gabimet e artikullit kanë `item`; suksesi kthen `total` (me transportin) dhe `shipping`. Agjenti i lexon dhe ia tregon pronarit. Mbetet push-i i repo-s `puzzle` dhe prova.
- **Faza B, 15.11.2026:** kodi është gati (web + mobile, pa migrim të ri: `p_files` erdhi me fazën A). `pendingOrder` mban `actionId` dhe `photoFields` vetëm kur biznesi ka URL porosish; «Konfirmo porosinë» hap kartën me zgjedhësin e fotove (web: paneli i klientit `#konfirmo-porosine`; aplikacioni: pamja «Konfirmo porosinë»). Mbetet prova me një porosi të vërtetë të agjentit te biseda @bora.mato24 dhe release i aplikacionit (0.3.14).
- **Faza C, 15.11.2026 (ndryshuar me miratim):** pyetjet nuk ruhen si workflow. Pas zgjedhjes së produktit të lidhur, `composeSpecChoices` (`src/lib/orchestration/order-context.ts`) shton pyetjet nga `external_spec`: variantin (`variant_<çelësi>`, vetëm vlerat aktive), opsionet e tjera dhe fushat e artikullit me çelësat e katalogut. Pyeten vetëm fushat e detyrueshme; ato opsionale pranohen kur klienti i përmend dhe shkojnë me porosinë. «Rifresko nga webi» i përditëson menjëherë. Zana nuk kishte workflow për produktet e lidhura (`workflow_id` bosh), ndaj nuk ka asgjë për të rigjeneruar.
- Mbeten fazat D–F dhe H.
