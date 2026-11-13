# Kreu: modulet e përshtatshme me theks, të tjerat te "Shiko të gjitha"

Status: plan, pa implementim. Drejtimi u miratua më 2026-11-14 (theks për modulet e përshtatshme, pa hap aktivizimi te Kreu).
Prek: web (`agjenti`) dhe mobile (`agjenti-mobile`).

## Çfarë ekziston sot (gjetjet)

**Web, `src/app/b/[slug]/page.tsx`** (commit 69d4aeb): titulli "Përmbledhja e biznesit", periudha (Sot / 7 / 30 ditë), karta "Mesazhe hyrëse" dhe një kartë për çdo modul nga `loadHomeSummary` (`src/lib/home/summary.ts`): produktet, shërbimet, porositë, rezervimet, leads, klientët, njohuritë, katalogët. Çdo kartë: numër, "+N të reja", dhe maksimum një gjë për t'u bërë (`HomeCard` në `src/lib/home/model.ts`). Mbi to `ReadyStrip` ("Gati për klientët") derisa Agjenti të jetë live (`shell.tsx:437`).

**Modeli i moduleve** (`src/lib/dashboard/modules/*`, `profile/*`):
- `allowed_business_modules` (RPC, server): çfarë lejon paketa. Sot lejon *të gjitha* modulet për çdo biznes.
- `dashboard_profile.hiddenModules`: preferencë e menysë, jo autorizim. Fshehja nuk kufizon Agjentin dhe nuk fshin të dhëna.
- `generateDashboardProfile` / `inferModules` (`profile/generate.ts`): nga sinjalet e strukturuara të onboarding-ut (`DashboardSignals`: lloji i biznesit, kodet e ofertës, përdorimet e zgjedhura, aftësitë e Agjentit, shablloni i workflow-it) nxjerr modulet që lidhen me biznesin.
- `business_used_modules` (RPC): cilat module kanë të dhëna.
- `moduleDependencies`: porositë → produkte, rezervimet → shërbime, kalendari → rezervime.
- **Gabim aktual:** Kreu i jep `loadHomeSummary` listën `profile.enabledModules`, që është lista e *lejuar*. Pra kartat dalin pa lidhje me përshtatshmërinë apo me menynë.

**"Ftesat"** nuk janë modul i menysë. Janë aftësia partnere `business.provision` (krijo biznes për klient + ftesë pronësie), te `settings/actions`, tabela `business_invitations` (`source_business_id`, `status`, `expires_at`). Vetëm kur `can_execute_business_action(..., 'business.provision')` është true.

**Mobile, `agjenti-mobile/src/components/home.tsx`**: Kreu native. Numrat vijnë nga `GET /api/business-assistant/briefing` (`business-insights.tsx`), punët e hapura nga `/attention`, 3 bisedat e fundit, `ReadyCard` nga `bootstrap.readiness`. Faqet e moduleve hapen në WebView.

**Dy burime të së vërtetës sot:** web `loadHomeSummary`, mobile `loadBriefing`, me kuptim të ndryshëm të numrave (p.sh. web: rezervime që fillojnë sot; mobile: rezervime të krijuara në periudhë). Ky plan i bashkon.

## Plani (5 pika)

1. **Rezultati.** Kreu, në web dhe mobile, ka tre pjesë: (a) mesazhet, si sot; (b) "Për biznesin tënd": karta me theks për modulet e përshtatshme, me numra, çfarë u shtua dhe një gjë për t'u bërë, ose me hapin e parë kur janë bosh ("Shto produkt · Importo CSV", "Shto shërbimin e parë"); (c) "Shiko të gjitha modulet": rreshta të qetë me përshkrim dhe "Hap →" për të gjitha modulet e tjera të lejuara. Nuk ka hap aktivizimi te Kreu. Partnerët me `business.provision` shohin edhe kartën "Ftesat".

2. **Çfarë ruhet.** `ReadyStrip`/`ReadyCard`, karta e mesazheve dhe periudhat, bisedat e fundit dhe "attention" në mobile, faqja Cilësimet → Modulet, fshehja si preferencë e menysë anësore (me `showModule`, `POST /api/business-modules` dhe njoftimin pas ndryshimeve të asistentit), `allowed_business_modules` si autorizim, `generateDashboardProfile` dhe `business_used_modules`. `HomeCard` zgjerohet, nuk zëvendësohet.

3. **Çfarë përjashtohet.** Heqja e fshehjes nga menyja (vendim i veçantë navigimi, më vonë mund të ndjekë të njëjtin rregull: të përshtatshmet lart, të tjerat te "Më shumë"); paketat/entitlements; module të reja; fikja e moduleve nga Kreu; grafikë ose raporte të rinj; rekomandime nga AI ose nga teksti i bisedave. Mobile nuk shfaq lidhje te paketat/çmimet. `loadBriefing` mbetet për asistentin; Kreu mobile nuk e përdor më për kartat.

4. **Kriteret e pranimit.**
   - Një kontratë serveri e vetme, `loadHomeModules(business, period)` në `src/lib/home/`, e përdorur nga faqja web (direkt) dhe nga `GET /api/mobile/home?slug=&period=`. Asnjë numër apo vendim theksi nuk llogaritet në klient.
   - Moduli me të dhëna del gjithmonë me theks. Moduli i përshtatshëm pa të dhëna del me theks dhe me hapin e parë. Çdo modul tjetër i lejuar del te "Shiko të gjitha". Fshehja në meny ndikon te Kreu vetëm kur pronari e ka zgjedhur menynë me dorë (profil "manual"), dhe kurrë për një modul me të dhëna.
   - Përshtatshmëria vjen vetëm nga sinjalet e strukturuara të onboarding-ut dhe nga të dhënat ekzistuese, pa tekst bisede. Regex-et aktuale mbi çelësat e shablloneve te `inferModules` zëvendësohen me një hartë të qartë çelës → modul.
   - Çdo kartë dështon veçmas (`status: "unavailable"`), jo e gjithë faqja. Izolimi: `requireBusinessAccess` + `business_id` në çdo pyetje.
   - Teste: përshtatshmëria (sinjale të ndryshme, modul me të dhëna por jo i përshtatshëm, profil manual, profil pa sinjale), route-i mobile (401/403/periudhë e pavlefshme, forma e përgjigjes), dhe kontroll vizual në web (desktop + 375px) dhe në simulator.

5. **Pjesa e parë e vogël (për kontroll vizual).** Vetëm web: `loadHomeModules` me `highlighted` + `hasData`; faqja Kreu me "Për biznesin tënd" (kartat ekzistuese + gjendja bosh për Produktet, Shërbimet, Klientët) dhe "Shiko të gjitha modulet". Kontrollo me një biznes të sapo-onboarduar dhe me një që ka të dhëna. Pas miratimit vizual: (2) `/api/mobile/home` dhe testet e route-it; (3) kartat Ftesat, Kalendari, Workflow; (4) Kreu native në mobile mbi të njëjtin endpoint.

## Rregulli i theksit (llogaritet në server)

```
highlighted(m) = m ∈ allowed  AND  (m ∈ suitable OR m ∈ used)
suitable       = modulet nga inferModules(signals)        // sinjale të strukturuara të onboarding-ut
used           = business_used_modules(business)
të tjerët      = allowed − highlighted − core             // te "Shiko të gjitha"
```

- Pa sinjale (biznes i vjetër, profil "legacy"): `suitable` = modulet që shfaqen në meny, që Kreu të mos dalë bosh.
- Profil "manual" (pronari ka zgjedhur vetë modulet): `suitable` = modulet që ai ka lënë të dukshme. Kështu zgjedhja e tij respektohet, pa e bërë fshehjen kusht te Kreu.
- Modulet `core` (inbox, agents, sources, channels, settings, dashboard) nuk janë karta modulesh. `activity` dhe `reports` janë faqe leximi: dalin vetëm te "Shiko të gjitha".
- Te "Shiko të gjitha", rreshti tregon varësinë kur ka ("kërkon Shërbimet"), nga `moduleDependencies`.
- Renditja: `navigationOrder` në të dyja pjesët.

## Të dhënat për çdo kartë dhe burimi

Të gjitha me `business_id = biznesi aktual`, pas `requireBusinessAccess`. Shumica ekzistojnë tashmë te `loadHomeSummary`.

| Moduli | Numri kryesor | Detaji | Një gjë për t'u bërë | Gjendja bosh / hapi i parë | Burimi |
|---|---|---|---|---|---|
| Produktet | produkte aktive (`products`, `archived_at is null`, `item_kind=product`) | +N të reja | N pa çmim | Shto produkt · Importo CSV | ekziston |
| Shërbimet | `booking_services` aktive | +N të reja | N pa çmim (jo `price_mode=request`) | Shto shërbimin e parë | ekziston |
| Porositë | porosi jo-draft në periudhë | vlera sipas monedhës | N `failed`/`pending_reconciliation` | "Porositë vijnë nga bisedat"; lidhje te workflow i porosisë | ekziston |
| Rezervimet (takimet) | sot, jo të anuluara | N nesër | N `pending` në të ardhmen | Shto shërbim / cakto orarin | ekziston |
| Kalendari | ditë pune në javë (nga `hours`) | Google Calendar i lidhur | Agjenti nuk rezervon vetë (`agent_booking_enabled`) | Cakto orarin (kur s'ka cilësime) | `business_calendar_settings`, `google_calendar_connections`. Slotet e lira sot u lanë jashtë: kërkojnë llogaritjen e disponueshmërisë për çdo shërbim. |
| Klientët | `customers` aktivë | +N të rinj | — | "Klientët shtohen nga bisedat" · Shto klient | ekziston |
| Leads | gjithsej | +N të reja | N presin përgjigje | — | ekziston |
| Njohuritë | `knowledge_entries` aktive | — | N për konfirmim | Shto njohuri / lexo burimet | ekziston |
| Katalogët | aktivë | — | N me gabim indeksimi | Ngarko katalog | ekziston |
| Workflow | rrjedha (vizuale + lineare të mëparshme) | N aktive | N të papublikuara | Krijo rrjedhën e parë | `visual_workflows` + versioni i publikuar, `workflows` |
| Ftesat (vetëm partner) | në pritje dhe të vlefshme | N të pranuara në periudhë | N të skaduara | Krijo biznes për klient | **i ri**: `business_invitations` me `source_business_id`; vetëm kur `can_execute_business_action('business.provision')` |

## Kontrata e përbashkët

Një funksion serveri, një formë të dhënash. Web e thërret direkt në Server Component; mobile përmes route-it.

```ts
// src/lib/home/modules.ts
type HomeModule = {
  id: ModuleId | "invitations";
  highlighted: boolean;                   // "Për biznesin tënd" ose "Shiko të gjitha"
  hasData: boolean;                       // business_used_modules
  label: string; description: string; href: string; icon: string;
  requires: ModuleId[];                   // nga moduleDependencies, për tekstin "kërkon ..."
  card?: {                                // vetëm kur highlighted
    status: "available" | "unavailable";
    value: number | null; caption: string;
    detail?: string; detailTone?: "up";
    attention?: { text: string; href: string; tone: "warning" | "danger" };
    empty?: { text: string; action: { label: string; href: string } };  // kur value === 0
  };
};
type HomeData = { period: HomePeriod; messages: HomeMessages | null; modules: HomeModule[] };
```

- Numrat llogariten vetëm për modulet me theks; rreshtat e "Shiko të gjitha" nuk kërkojnë pyetje numërimi.
- `GET /api/mobile/home?slug=&period=`: `getRequestUser` → `requireBusinessAccess` → `loadHomeModules`; `Cache-Control: private, no-store`; tekstet përkthehen me `translator` si te `bootstrap`.
- `href` jepet nga serveri; mobile e hap me `openWeb` dhe pranon vetëm rrugë brenda `/b/{slug}/` (si `insightPath`).
- Asnjë endpoint i ri shkrimi: Kreu vetëm lexon.
- Migrimi: web kalon nga `loadHomeSummary` te `loadHomeModules` në një hap (funksioni i vjetër hiqet, jo dy versione paralele). Mobile kalon kartat nga `briefing` te `/api/mobile/home`; `briefing` mbetet për asistentin. Kthimi prapa: revert i commit-it të web-it; mobile i vjetër vazhdon të punojë sepse `briefing` nuk ndryshon.

## Pamja

1. Lart: titulli, periudha, karta e mesazheve (kur s'ka kanal, hapi i parë është lidhja e kanalit).
2. "Për biznesin tënd": rrjetë kartash; kartat bosh tregojnë hapin e parë, ato me të dhëna numrat dhe një gjë për t'u bërë.
3. "Shiko të gjitha modulet": listë rreshtash (ikonë, emër, përshkrim i shkurtër, varësia, "Hap →"), jo karta. Në mobile mund të hapet/mbyllet.
4. Në mobile, i njëjti rend vertikal në Kreun native.

## Rreziqe dhe vendime të hapura

- Performanca: numërimet bëhen vetëm për modulet me theks, pra zakonisht më pak se sot (~18 pyetje).
- Mospërputhje mes menysë dhe Kreut: një modul i fshehur në meny mund të dalë me theks te Kreu nëse ka të dhëna. E pranueshme: Kreu është vendi i zbulimit; faqja e modulit hapet gjithsesi.
- "Takimet" vs "Rezervimet": etiketa mbetet "Rezervimet" nga `moduleRegistry` derisa të vendoset ndryshe.
