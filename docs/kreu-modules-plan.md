# Kreu: modulet që përdor biznesi dhe ato që mund të aktivizojë

Status: plan, pa implementim. Kërkon miratim të drejtimit.
Data: 2026-11-13. Prek: web (`agjenti`) dhe mobile (`agjenti-mobile`).

## Çfarë ekziston sot (gjetjet)

**Web, `src/app/b/[slug]/page.tsx`** (commit 69d4aeb): titulli "Përmbledhja e biznesit", periudha (Sot / 7 / 30 ditë), karta "Mesazhe hyrëse" dhe një kartë për çdo modul nga `loadHomeSummary` (`src/lib/home/summary.ts`): produktet, shërbimet, porositë, rezervimet, leads, klientët, njohuritë, katalogët. Çdo kartë: numër, "+N të reja", dhe maksimum një gjë për t'u bërë (`HomeCard` në `src/lib/home/model.ts`). Mbi to `ReadyStrip` ("Gati për klientët") derisa Agjenti të jetë live (`shell.tsx:437`).

**Modeli i moduleve** (`src/lib/dashboard/modules/*`, `profile/service.ts`):
- `allowed_business_modules` (RPC, server): çfarë lejon paketa. Sot lejon *të gjitha* modulet për çdo biznes, pra "i bllokuar nga paketa" nuk ndodh ende, por UI-ja e Modulet e mbështet (`is-locked`).
- `dashboard_profile.hiddenModules`: preferencë e menysë, jo autorizim. Profili i gjeneruar nga onboarding-u fsheh modulet që nuk lidhen me biznesin; `refreshGeneratedProfile` nuk fsheh kurrë modul që ka të dhëna (`business_used_modules`).
- `moduleDependencies`: porositë kërkojnë produkte, rezervimet kërkojnë shërbime, kalendari kërkon rezervime. `withRequiredModules` i shfaq bashkë.
- Shfaqja e një moduli: `showModuleFor` (server) → RPC `save_business_modules`, që lejon vetëm pronarin ose administratorin e platformës. Ekziston si server action (`showModule`) dhe si `POST /api/business-modules` për mobile.
- **Gabim i vogël aktual:** Kreu i jep `loadHomeSummary` listën `profile.enabledModules`, e cila pas `applyModuleEntitlements` është lista e *lejuar*, jo e *shfaqur*. Pra Kreu shfaq karta edhe për modulet që pronari i ka fshehur.

**"Ftesat"** nuk janë modul i menysë. Janë aftësia partnere `business.provision` (krijo biznes për klient + ftesë pronësie), te `settings/actions`, tabela `business_invitations` (`source_business_id`, `status`, `expires_at`). Shfaqet vetëm kur `can_execute_business_action(..., 'business.provision')` është true.

**Mobile, `agjenti-mobile/src/components/home.tsx`**: Kreu është native. Ngarkon `GET /api/business-assistant/briefing` (mesazhe, porosi, klientë, rezervime të krijuara në periudhë, me status `available | unavailable | disabled`) dhe `/attention` (`business-insights.tsx`), 3 bisedat e fundit, `ReadyCard` nga `bootstrap.readiness`. Moduli shihet vetëm te `bootstrap.navigation`/`modules`. Faqet e moduleve hapen në WebView.

**Dy burime të së vërtetës sot:** web përdor `loadHomeSummary`, mobile përdor `loadBriefing`. Numrat ndryshojnë në kuptim (p.sh. web: rezervime që fillojnë sot; mobile: rezervime të krijuara në periudhë). Ky plan i bashkon.

## Plani (5 pika)

1. **Rezultati.** Kreu, në web dhe mobile, tregon për biznesin aktual: (a) modulet në përdorim, secili me numrin kryesor, çfarë u shtua dhe një gjë për t'u bërë, ose një gjendje bosh me hapin e parë ("Shto produktin e parë", "Importo nga CSV", "Shto shërbimin e parë"); (b) seksionin "Mund të aktivizosh": modulet e lejuara por të fshehura, me përshkrim të shkurtër dhe butonin "Shfaq" (përfshin varësitë, p.sh. Rezervimet shfaq edhe Shërbimet); (c) për partnerët me `business.provision`, kartën "Ftesat" (në pritje, të pranuara, të skaduara). Mesazhet mbeten karta e parë. Menjëherë pas onboarding-ut, kur gjithçka është 0, Kreu tregon modulet e zgjedhura nga onboarding-u me hapin e parë dhe të tjerat si të aktivizueshme.

2. **Çfarë ruhet.** `ReadyStrip`/`ReadyCard`, karta e mesazheve dhe periudhat, bisedat e fundit dhe "attention" në mobile, faqja Cilësimet → Modulet (mbetet vendi i plotë për ndezje/fikje), `showModuleFor` + `save_business_modules` si e vetmja rrugë shkrimi, `allowed_business_modules` si autorizim, rregulli që fshehja nuk kufizon Agjentin dhe nuk fshin të dhëna, `business_used_modules`. `HomeCard` zgjerohet, nuk zëvendësohet.

3. **Çfarë përjashtohet.** Nuk ndryshojnë paketat/entitlements, nuk shtohen module të reja, nuk ka fikje modulesh nga Kreu (fikja mbetet te Modulet), nuk ka grafikë të rinj ose raporte, nuk ka rekomandime nga AI apo nga teksti i bisedave (renditja e "Mund të aktivizosh" është `navigationOrder`; nëse duam renditje sipas onboarding-ut, përdoren vetëm sinjalet e strukturuara ekzistuese `DashboardSignals`, jo fraza). Mobile nuk shfaq lidhje te paketat/çmimet (`plansPage` i fsheh në store builds): për "locked" tregon vetëm tekstin. `loadBriefing` mbetet për asistentin; Kreu mobile thjesht nuk e përdor më për kartat.

4. **Kriteret e pranimit.**
   - Një kontratë serveri e vetme, `loadHomeModules(business, user, period)` në `src/lib/home/`, e përdorur nga faqja web (direkt) dhe nga `GET /api/mobile/home?slug=&period=` (mobile). Asnjë numër i Kreut nuk llogaritet në klient.
   - Moduli i fshehur nuk ka kartë në "Në përdorim"; shfaqet te "Mund të aktivizosh". Moduli i fshehur që ka të dhëna shënohet "ka të dhëna".
   - "Shfaq" punon vetëm për pronarin/adminin (RPC e refuzon ndryshe); për anëtarët e tjerë butoni nuk shfaqet (`canManageModules` nga serveri) dhe teksti thotë që e ndryshon pronari. Pas suksesit, karta kalon te "Në përdorim" pa rifreskim manual; në gabim shfaqet gabimi i kontrolluar, jo sukses.
   - Çdo kartë dështon veçmas (`status: "unavailable"`), jo e gjithë faqja. Asnjë modul nga një biznes tjetër (izolim me `requireBusinessAccess` + `business_id` në çdo pyetje).
   - Teste: modeli i gjendjeve (active/available/locked, varësitë, ka të dhëna), route-i mobile (401/403/periudhë e pavlefshme, forma e përgjigjes), dhe kontroll vizual në web (desktop + 375px) dhe në simulator.

5. **Pjesa e parë e vogël (për kontroll vizual).** Vetëm web: rregullo `enabledModules` → modulet e shfaqura; shto seksionin "Mund të aktivizosh" me butonin "Shfaq" (thërret `showModule` ekzistues); shto gjendjen bosh te kartat ekzistuese kur numri është 0 (Produktet, Shërbimet, Klientët). Me një biznes të sapo-onboarduar dhe një me të dhëna, kontrollo pamjen. Pas miratimit vizual: (2) nxirr `loadHomeModules` + `/api/mobile/home` dhe kalo web-in në të; (3) kartat Ftesat dhe Kalendari; (4) mobile native Kreu mbi të njëjtin endpoint.

## Gjendjet e një moduli (llogariten në server)

| Gjendja | Kushti | Çfarë tregon Kreu | Veprimi |
|---|---|---|---|
| `active` | i lejuar dhe jo në `hiddenModules` | kartë me numra ose gjendje bosh | hap modulin / hapi i parë |
| `available` | i lejuar, por i fshehur | rresht te "Mund të aktivizosh" + `hasData` | "Shfaq" (pronar/admin) |
| `locked` | jo në `allowed_business_modules` | rresht i zbehur, "Nuk përfshihet në paketë" | web: lidhje te paketat; mobile: asnjë |

Modulet `core` (inbox, agents, sources, channels, settings, dashboard) nuk janë karta modulesh. `activity` dhe `reports` janë faqe leximi: shfaqen vetëm te "Mund të aktivizosh" kur janë të fshehura, pa kartë numrash.

## Të dhënat për çdo kartë dhe burimi

Të gjitha me `business_id = biznesi aktual`, pas `requireBusinessAccess`. Shumica ekzistojnë tashmë te `loadHomeSummary`.

| Moduli | Numri kryesor | Detaji | Një gjë për t'u bërë | Gjendja bosh / hapi i parë | Burimi |
|---|---|---|---|---|---|
| Produktet | produkte aktive (`products`, `archived_at is null`, `item_kind=product`) | +N të reja | N pa çmim | Shto produkt · Importo CSV | ekziston |
| Shërbimet | `booking_services` aktive | +N të reja | N pa çmim (jo `price_mode=request`) | Shto shërbimin e parë | ekziston |
| Porositë | porosi jo-draft në periudhë | vlera sipas monedhës | N `failed`/`pending_reconciliation` | "Porositë vijnë nga bisedat"; lidhje te workflow i porosisë | ekziston |
| Takimet (Rezervimet) | sot, jo të anuluara | N nesër | N `pending` në të ardhmen | Shto shërbim / cakto orarin | ekziston |
| Kalendari | slotet e lira sot (ose "orari i pacaktuar") | — | "Orari nuk është caktuar" | Cakto orarin | **i ri**: `business_calendar_settings` |
| Klientët | `customers` aktivë | +N të rinj | — | "Klientët shtohen nga bisedat" · Shto klient | ekziston |
| Leads | gjithsej | +N të reja | N presin përgjigje | — | ekziston |
| Njohuritë | `knowledge_entries` aktive | — | N për konfirmim | Shto njohuri / lexo burimet | ekziston |
| Katalogët | aktivë | — | N me gabim indeksimi | Ngarko katalog | ekziston |
| Workflow | të publikuara/aktive | — | draft i papublikuar | Krijo nga shabllon | **i ri**: `visual_workflows`/`workflows` |
| Ftesat (vetëm partner) | në pritje dhe të vlefshme | N të pranuara në periudhë | N të skaduara | Krijo biznes për klient | **i ri**: `business_invitations` me `source_business_id`; vetëm kur `can_execute_business_action('business.provision')` |

## Kontrata e përbashkët

Një funksion serveri, një formë të dhënash. Web e thërret direkt në Server Component; mobile përmes route-it.

```ts
// src/lib/home/modules.ts
type HomeModule = {
  id: ModuleId | "invitations";
  state: "active" | "available" | "locked";
  label: string; description: string; href: string; icon: string;
  hasData: boolean;                       // business_used_modules
  requires: ModuleId[];                   // withRequiredModules, për tekstin "shfaq edhe ..."
  card?: {                                // vetëm për active
    status: "available" | "unavailable";
    value: number | null; caption: string;
    detail?: string; detailTone?: "up";
    attention?: { text: string; href: string; tone: "warning" | "danger" };
    empty?: { text: string; action: { label: string; href: string } };  // kur value === 0
  };
};
type HomeData = {
  period: HomePeriod;
  messages: HomeMessages | null;
  modules: HomeModule[];
  canManageModules: boolean;              // pronar ose admin; UI vetëm, RPC mbetet autoriteti
};
```

- `GET /api/mobile/home?slug=&period=`: `getRequestUser` → `requireBusinessAccess` → `loadHomeModules`; `Cache-Control: private, no-store`; tekstet përkthehen me `translator` si te `bootstrap`.
- Aktivizimi: web `showModule` (server action ekzistuese), mobile `POST /api/business-modules` (ekzistues). Asnjë endpoint i ri shkrimi.
- `href` jepet nga serveri; mobile e hap me `openWeb` dhe pranon vetëm rrugë brenda `/b/{slug}/` (si `insightPath`).
- Migrimi: web kalon nga `loadHomeSummary` te `loadHomeModules` në një hap (funksioni i vjetër hiqet, jo dy versione paralele). Mobile kalon kartat nga `briefing` te `/api/mobile/home`; `briefing` mbetet për asistentin. Kthimi prapa: revert i commit-it të web-it; mobile i vjetër vazhdon të punojë sepse `briefing` nuk ndryshon.

## Rreziqe dhe vendime të hapura

- Performanca: ~20 pyetje `count` paralele për hapje. Sot janë tashmë ~18; shtimi i 3 kartave është i vogël. Nëse duhet, një RPC e vetme numërimi më vonë, jo tani.
- "Takimet" vs "Rezervimet": etiketa vjen nga `moduleRegistry`/konfigurimi; nuk ndryshojmë emrin pa vendim tëndin.
- Anëtarët jo-pronarë shohin "Mund të aktivizosh" pa buton. Alternativë: ta fshehim krejt për ta. Rekomandim: ta tregojmë, që ta dinë çfarë ekziston.
