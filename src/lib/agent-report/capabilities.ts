/**
 * Raporti "Aftësitë e Agjentit": çfarë di të bëjë agjenti i klientit dhe Asistenti, modul pas moduli,
 * i vlerësuar nga leximi i kodit. Shfaqet te Platform Admin → Shëndeti i Agjentit → Aftësitë e Agjentit.
 *
 * Kur një ndryshim shton, heq ose kufizon një aftësi, ndrysho këtu vlerësimin në të njëjtin ndryshim:
 * "po" (funksionon), "pjes" (vetëm me konfigurim ose pjesërisht), "jo" (nuk ekziston). Përditëso edhe
 * `capabilityReportUpdated`, dhe `currentState` / `mainProblems` nëse ndryshuan. Raporti mban gjendjen reale,
 * jo atë të synuar: kur një provë live, review ose test tregon se diçka punon më keq, ule vlerësimin.
 */
export type CapabilityStatus = "po" | "pjes" | "jo";
export type CapabilityModule = { name: string; items: [CapabilityStatus, string][] };

export const capabilityReportUpdated = "2026-11-24";

export const customerCapabilities: CapabilityModule[] = [
  {
    name: "Bisedat",
    items: [
      ["po", "Përgjigje automatike 24/7"],
      ["po", "Bashkon disa mesazhe të njëpasnjëshme"],
      ["po", "Postime, reels dhe story të shpërndara: lexon përshkrimin"],
      ["pjes", "Fotot që dërgon klienti: i ruan për porosinë, por nuk i shikon"],
      ["po", "Mesazhet zanore të klientit: i kthen në tekst dhe i përgjigjet"],
      ["pjes", "Videot e klientit: kupton vetëm çfarë thuhet, jo figurën"],
      ["po", "Përgjigjet në gjuhën e klientit"],
      ["po", "Ndalet kur ndërhyn stafi"],
      ["po", "Reagime me emoji"],
      ["po", "Kalimi te stafi: automatik kur klienti kërkon një person; mesazhin për klientin e cakton pronari te Komunikimi"],
      ["po", "Kupton vetë kur klienti është i pakënaqur dhe i duhet njeri: ia kalon stafit ose të njofton"],
      ["jo", "Jashtë orarit, i thotë klientit kur do t'i përgjigjet stafi"],
      ["jo", "Komentet në postime: përgjigje ose mesazh privat në DM"],
    ],
  },
  {
    name: "Fushatat",
    items: [
      ["po", "Kupton “dua / s'dua oferta”, me evidencë nga mesazhi"],
      ["po", "Përgjigjet për ofertën e fushatës"],
    ],
  },
  {
    name: "Njohuritë",
    items: [
      ["po", "Përgjigje nga njohuritë"],
      ["po", "Njohuritë ruajnë formën (lista, tabela) dhe burimin nga erdhën"],
      ["po", "Profili i biznesit: orari, adresa, kontakti"],
      ["po", "“Nuk e di, po të lidh me stafin”: kalim automatik te stafi"],
    ],
  },
  {
    name: "Katalogët (PDF)",
    items: [
      ["po", "Përgjigje nga dokumentet"],
      ["po", "Jep lidhjen e dokumentit"],
      ["pjes", "Lidh faqen e katalogut me produktin"],
    ],
  },
  {
    name: "Klientët",
    items: [
      ["po", "Mban mend emrin, telefonin dhe adresën"],
      ["po", "Njeh klientin që kthehet"],
      ["pjes", "Përditëson të dhënat kur klienti i ndryshon"],
    ],
  },
  {
    name: "Produktet",
    items: [
      ["po", "Emri, çmimi, detajet, variantet"],
      ["po", "Numëron, gjen më të lirin dhe më të shtrenjtin"],
      ["po", "Dërgon foton e produktit"],
      ["po", "Gjendja e stokut"],
      ["po", "Njeh produktin nga një postim i shpërndarë"],
      ["pjes", "Gjen produktin sipas nevojës: vetëm 20 më të përshtatshmit, pa filtër çmimi, jo përtej 1000 produkteve"],
      ["pjes", "Sugjeron alternativa: vetëm kur produkti ka mbaruar"],
      ["jo", "Sugjeron produkte shtesë që shkojnë me zgjedhjen (sipas cilësimit të biznesit)"],
      ["jo", "Lidhja drejt faqes së produktit"],
    ],
  },
  {
    name: "Leads",
    items: [
      ["po", "Biseda shënohet lead kur klienti shfaq interes: agjenti e kupton nga kuptimi i mesazhit (çmim, disponueshmëri, kontakt, blerje), me citim"],
      ["po", "Statusi i lead-it është te biseda: fitohet vetë me porosi ose rezervim, kalon “në kontakt” kur përgjigjet stafi"],
      ["pjes", "Vetëm kur agjenti e përpunon mesazhin: me përgjigjet automatike të fikura, interesi nuk shënohet"],
    ],
  },
  {
    name: "Kanalet",
    items: [
      ["po", "Instagram"],
      ["po", "WhatsApp"],
      ["jo", "Messenger ose chat në ueb"],
    ],
  },
  {
    name: "Shërbimet",
    items: [
      ["po", "Çmimi dhe kohëzgjatja"],
      ["po", "Lista e shërbimeve"],
      ["pjes", "Sugjerim sipas nevojës"],
      ["pjes", "Oraret e lira: vetëm brenda procesit të rezervimit (edhe para se klienti të zgjedhë datën)"],
      ["jo", "Foto e shërbimit"],
    ],
  },
  {
    name: "Porositë",
    items: [
      ["po", "Variantet, sasia dhe zgjedhjet"],
      ["po", "Pyetjet e pronarit për produktin (p.sh. teksti në bluzë): Agjenti i bën pas produktit dhe përgjigja hyn te përmbledhja dhe te porosia"],
      ["pjes", "Foto nga klienti për produktin (p.sh. dizajni): Agjenti e kërkon dhe e pret para përmbledhjes, por nuk e shikon; stafi e gjen te biseda"],
      ["po", "Konfirmimi para porosisë, me përmbledhje të qartë në gjuhën e klientit"],
      ["pjes", "Kërkon vetëm të dhënat që i duhen porosisë: kërkon qytetin dhe adresën edhe për produkte digjitale, një nga një, përveç kur biznesi i bën opsionale"],
      ["po", "Kontrolli i stokut nga serveri"],
      ["po", "Produkt publik ose draft: Agjenti e ofron dhe merr porosi vetëm për produktet publike; produktet e vjetra “vetëm për informim” i prezanton pa marrë porosi"],
      ["po", "Vetëm mblidh kërkesën: Agjenti mbledh të dhënat dhe konfirmimin, stafi e regjistron porosinë nga biseda (zgjedhje te Porositë)"],
      ["po", "Krijimi i porosisë: automatik për produktet aktive me çmim të caktuar ose variant me çmim"],
      ["po", "Statusi i porosisë: automatik kur Porositë janë të ndezura"],
      ["po", "Porosia shkon te faqja e biznesit kur ajo është e lidhur"],
      ["jo", "Rikthehet te klienti që e la porosinë në mes"],
      ["jo", "Shporta: disa produkte të ndryshme në një porosi"],
      ["jo", "Kuponët dhe zbritjet"],
      ["jo", "Ankesat, kthimet dhe produkti me defekt"],
      ["jo", "Kërkon vlerësim pas porosisë"],
      ["jo", "Ndryshim ose anulim nga klienti"],
      ["jo", "Pagesa dhe kostoja e dërgesës"],
    ],
  },
  {
    name: "Rezervimet",
    items: [
      ["po", "Konfirmimi para rezervimit"],
      ["po", "Krijimi nga oraret e lira, pasi pronari ndez “Agjenti rezervon vetë” dhe shërbimet, të dyja te Çfarë bën Agjenti"],
      ["po", "Oraret e lira: për ditën që zgjodhi klienti ose ditët në vijim, edhe në Chat Lab"],
      ["po", "Statusi i rezervimit të vet (rezervimet e bëra në bisedë)"],
      ["po", "Anulimi nga klienti, pas konfirmimit të tij"],
      ["po", "Zhvendosja në një orë tjetër të lirë, pas konfirmimit të tij"],
      ["pjes", "Kujtesa në mëngjes të ditës së rezervimit: vetëm kur klienti ka shkruar në 24 orët e fundit"],
      ["pjes", "Klienti mëson kur stafi e konfirmon, anulon ose zhvendos rezervimin: vetëm brenda 24 orëve"],
    ],
  },
];

export const businessCapabilities: CapabilityModule[] = [
  {
    name: "Shërbimet",
    items: [
      ["po", "Krijo dhe ndrysho shërbimin"],
      ["po", "Oraret dhe cilësimet e kalendarit"],
      ["pjes", "Fshirja: vetëm çaktivizim"],
    ],
  },
  {
    name: "Rezervimet",
    items: [
      ["po", "Krijo rezervim"],
      ["po", "Ndrysho ose anulo rezervim"],
      ["po", "Riprovo sinkronizimin"],
      ["po", "Disponueshmëria"],
      ["po", "Kërko rezervime"],
      ["po", "Konfirmo ose anulo kërkesat në pritje; klientit i shkon mesazh brenda 24 orëve"],
      ["po", "Njoftim te Kreu për çdo rezervim, anulim ose zhvendosje nga Agjenti"],
      ["jo", "Lidhja me Google Calendar: e bën vetëm pronari te Kalendari, me qëllim"],
    ],
  },
  {
    name: "Agjenti",
    items: [
      ["po", "Udhëzimet dhe stili i komunikimit"],
      ["po", "Menaxhimi i agjentit"],
      ["po", "Ruaj trajnimin"],
      ["po", "Ndrysho trajnimin"],
      ["jo", "Provë në Chat Lab"],
    ],
  },
  {
    name: "Proceset",
    items: [
      ["po", "Lexo procesin"],
      ["po", "Drejton te cilësimi përkatës në vend që të krijojë proces"],
      ["pjes", "Ndrysho, publiko, ndiz, rikthe: vetëm për biznes që ka publikuar procesin e vet"],
      ["po", "Fik procesin e personalizuar"],
      ["jo", "Simulimi"],
    ],
  },
  {
    name: "Produktet",
    items: [
      ["po", "Krijo produkt"],
      ["po", "Ndrysho produkt"],
      ["po", "Arkivo, fshi, rikthe"],
      ["po", "Konfigurim në grup"],
      ["po", "Ndrysho një fushë"],
      ["po", "Publiko ose kthe në draft"],
      ["po", "Numëron dhe krahason produktet në server. Shfaq rezultatet në tabelë dhe ruan rreshtat në bisedë."],
      ["pjes", "Importi"],
      ["pjes", "Foto: vetëm me URL, pa ngarkim"],
      ["po", "Rregullat e stokut"],
      ["po", "Struktura dhe fushat e produkteve"],
    ],
  },
  {
    name: "Raportet dhe Aktiviteti",
    items: [
      ["po", "Shfaq aktivitetin e periudhës me karta dhe lidhje te seksionet e biznesit"],
      ["po", "Njoftimet për vëmendje"],
      ["po", "Bisedat e fundit"],
      ["jo", "Suksesi i Agjentit në procese"],
      ["jo", "Pyetjet që Agjenti nuk diti, me propozim për njohuri të reja"],
    ],
  },
  {
    name: "Njohuritë",
    items: [
      ["po", "Shto dhe ndrysho"],
      ["po", "Fshi"],
      ["jo", "Import FAQ nga burime të jashtme"],
    ],
  },
  {
    name: "Bisedat",
    items: [
      ["po", "Formaton përgjigjet për pronarin me paragrafë, lista, theksim dhe lidhje"],
      ["po", "Lexon bisedat e fundit"],
      ["po", "Ndalo dhe rinis Agjentin në një bisedë"],
      ["po", "Njoftime për bisedat që presin"],
      ["jo", "Dërgo mesazh klientit"],
      ["jo", "Reagime"],
    ],
  },
  {
    name: "Porositë",
    items: [
      ["po", "Krijo porosi nga biseda"],
      ["po", "Verifiko porosinë"],
      ["po", "Kërko porositë"],
      ["po", "Ndiz porositë për biznesin"],
      ["jo", "Ndrysho dërgesën ose shënimin"],
      ["jo", "Ndrysho statusin"],
      ["jo", "Ndrysho artikujt"],
    ],
  },
  {
    name: "Kalendari",
    items: [
      ["po", "Cilësimet e kalendarit"],
      ["jo", "Lidhja me Google: vetëm pronari te Kalendari, me qëllim; sinkronizimi dhe oraret e zëna punojnë pasi lidhet"],
    ],
  },
  {
    name: "Katalogët",
    items: [
      ["po", "I përdor si material"],
      ["jo", "Ngarko dokument"],
    ],
  },
  {
    name: "Cilësimet",
    items: [
      ["po", "Përgjigjet automatike"],
      ["po", "Verifikimi i biznesit"],
      ["po", "Modulet: shfaq ose fshih seksione"],
      ["po", "Lloji, fushat, pyetjet për klientin dhe stoku"],
      ["pjes", "Integrimet: gjendja, prova e lidhjes dhe rifreskimi nga webi; lidhja dhe kredencialet vetëm me dorë"],
    ],
  },
  {
    name: "Klientët",
    items: [
      ["po", "Kërko klientë"],
      ["jo", "Ndrysho klientin"],
      ["jo", "Fshi klientin"],
    ],
  },
  {
    name: "Leads",
    items: [
      ["po", "Numrat te përmbledhja"],
      ["jo", "Ndrysho statusin e lead-it"],
    ],
  },
  {
    name: "Fushatat",
    items: [
      ["jo", "Krijo dhe dërgo fushatë (vetëm pronari, me konfirmim)"],
    ],
  },
  {
    name: "Burimet dhe Onboarding",
    items: [
      ["po", "Pyetjet e profilit të biznesit në bisedë"],
      ["po", "Rifreskon njohuritë nga Instagram-i dhe faqja e biznesit, si propozim për shqyrtim"],
      ["po", "Mëson nga bisedat e vjetra (importi i bisedave), me shqyrtim nga pronari"],
    ],
  },
  {
    name: "Integrimet",
    items: [
      ["jo", "Lidh faqen ose katalogun e jashtëm (kredenciale)"],
    ],
  },
  {
    name: "Pagesat dhe Ekipi",
    items: [
      ["jo", "Abonimi dhe pagesat"],
      ["jo", "Anëtarët dhe ftesat"],
    ],
  },
  {
    name: "Kanalet",
    items: [
      ["jo", "Lidh ose shkëput Instagram/WhatsApp (OAuth)"],
    ],
  },
];

/** Modulet e Asistentit që mbeten me qëllim vetëm me dorë (vendime sigurie), jashtë mesatares së tretë. */
export const securityOnlyModules = ["Fushatat", "Kanalet", "Integrimet", "Pagesat dhe Ekipi"];

/** Ku gjendja reale sot ndryshon nga ajo që thonë aftësitë. */
export const currentState = [
  "Llogaria OpenAI është e pronarit dhe ka kredi; Agjenti përgjigjet sërish (verifikuar live më 18 nëntor).",
  "Procesi automatik është live (migrimi u aplikua). Te Filiz Store, pa workflow të vizatuar, Agjenti e çoi porosinë deri te konfirmimi. Rezervimet janë të fikura te çdo biznes: askush nuk ka ndezur ende “Agjenti rezervon vetë” dhe asnjë shërbim nuk pranon rezervime, ndaj platforma ka 0 rezervime.",
  "Të gjitha cilësimet e Agjentit janë në një vend, te “Çfarë bën Agjenti”: porositë (regjistrim ose vetëm kërkesë), pyetjet për klientin, rezervimet, kalimi te stafi, mesazhet zanore dhe klienti i pakënaqur.",
  "Çdo hyrje dhe dalje e aftësive regjistrohet, edhe punët në sfond dhe integrimet (Instagram, WhatsApp, Google, POK); skeda Shëndeti tregon çfarë shkoi keq me kodin e shkakut, lidhjet që duken aktive por nuk punojnë dhe punët e ngecura. Të dhënat reale janë ende pak.",
  "Te Lende Drusore Destani, Instagram-i është i lidhur por Meta nuk aktivizoi mesazhet (subscribed_apps): Agjenti nuk merr DM derisa llogaria të rilidhet si profesionale me të gjitha lejet.",
  "Pagesat e paketës funksionojnë me faqen e POK (mjedis prove): një pagesë prove Enterprise u regjistrua dhe paketa u aktivizua deri më 20 dhjetor. Rinovimi është me dorë; rinovimi automatik pret dokumentimin e Subscriptions të POK.",
  "Mesazhet zanore, videot dhe kalimi te stafi kur klienti është i pakënaqur janë live, por ende pa u provuar me klientë të vërtetë.",
];

export const mainProblems: { title: string; detail: string }[] = [
  { title: "Realtime në pajisje dhe vazhdimi i punëve kërkojnë verifikim.", detail: "Migrimi realtime është aplikuar në databazën reale dhe kanali privat, izolimi dhe marrja e njoftimit janë verifikuar. Worker-i çdo minutë është aktiv. Publikimi i klientëve, rikuperimi pas humbjes së vazhdimit dhe sjellja në sfond në pajisje reale mbeten të paverifikuara." },
  { title: "Editori i workflow-ve nuk hiqet dot plotësisht.", detail: "Pa proces të publikuar, serveri e ndërton vetë procesin nga produktet dhe cilësimet, dhe të gjitha cilësimet e Agjentit janë te “Çfarë bën Agjenti”. Agjenti.app ka ende nevojë për editorin, sepse rrjedha “Regjistrim biznesi” krijon biznes dhe ftesë, gjë që procesi i zakonshëm nuk e bën." },
  { title: "Rezervimet nuk janë provuar me klientë të vërtetë.", detail: "Klienti rezervon, pyet, anulon dhe zhvendos rezervimin e tij, por asnjë biznes nuk i ka ndezur ende. Kujtesat dhe mesazhet për vendimet e stafit dërgohen vetëm brenda 24 orëve nga mesazhi i fundit i klientit (rregulli i Instagram/WhatsApp, pa shabllone)." },
  { title: "Porositë pas krijimit bëhen me dorë.", detail: "Klienti nuk e ndryshon dot porosinë, dhe Asistenti nuk ndryshon dot statusin apo dërgesën." },
  { title: "Asistenti nuk lidh integrimet.", detail: "Asistenti ndryshon stokun, fushat, pyetjet, llojin dhe seksionet, provon lidhjen me webin dhe rifreskon produktet, por lidhjen e re, kredencialet dhe shkëputjen i bën vetëm pronari te Integrimet." },
  { title: "Pronari nuk e sheh suksesin e Agjentit.", detail: "Platforma e mat tani çdo hyrje dhe dalje të aftësive (skeda Shëndeti), por pronari te paneli i vet dhe Asistenti nuk e dinë sa porosi u lanë në mes ose sa mesazhe mbetën pa përgjigje." },
  { title: "Porosia kërkon të dhëna që nuk i duhen.", detail: "Për një PDF që shkarkohet, Agjenti kërkon qytetin dhe adresën, një nga një. Të dhënat e kërkuara varen nga cilësimi i biznesit, jo nga mënyra si merret produkti." },
  { title: "Komentet në Instagram injorohen.", detail: "Webhook-u merr vetëm mesazhet në DM; komentet si “Sa kushton?” nën postime nuk i arrijnë Agjentit, ndonëse aty nis shumica e shitjeve." },
  { title: "Porosia ka vetëm një produkt.", detail: "Pa shportë, kuponë, ankesa apo kthime, çdo kërkesë përtej një produkti të vetëm i kalon stafit." },
  { title: "Agjenti nuk i sheh fotot.", detail: "Në Instagram dhe WhatsApp, kur klienti dërgon foto, Agjenti e di vetëm që u dërgua; mesazhet zanore dhe zërin e videove i kthen në tekst, por figurën e videos nuk e sheh. Në prova (Chat Lab) fotot i sheh, ndaj prova duket më mirë se realiteti." },
  { title: "Agjenti nuk rikthehet te klienti.", detail: "Kur klienti e lë porosinë ose rezervimin në mes, askush nuk e kujton. Njoftimet i shkojnë vetëm pronarit, për lead-et pa përgjigje." },
  { title: "Burimet rilexohen, por pa krahasim të plotë.", detail: "Rifreskimi (me dorë, nga Asistenti ose çdo javë) sjell propozime për çfarë është e re ose ndryshe dhe shënon njohuritë që faqja nuk i thotë më, por Instagram-i lexohet vetëm nga postimet e fundit dhe një profil publik lexohet vetëm një herë." },
  { title: "Varësia nga OpenAI pa sinjal.", detail: "Kur mbarojnë kreditë, ndalet gjithçka dhe pronari nuk paralajmërohet." },
];

const statusScore: Record<CapabilityStatus, number> = { po: 1, pjes: 0.5, jo: 0 };

/** Përqindja e një moduli: Po = 1, Pjesërisht = 0.5, Jo = 0, mesatarja e aftësive. */
export const modulePercent = (module: CapabilityModule) =>
  Math.round((100 * module.items.reduce((sum, [status]) => sum + statusScore[status], 0)) / module.items.length);

/** Mesatarja e moduleve, si në raportin origjinal. */
export const averagePercent = (modules: CapabilityModule[]) =>
  Math.round(modules.reduce((sum, m) => sum + modulePercent(m), 0) / modules.length);

export const statusCounts = (module: CapabilityModule) =>
  module.items.reduce((counts, [status]) => ({ ...counts, [status]: counts[status] + 1 }), { po: 0, pjes: 0, jo: 0 } as Record<CapabilityStatus, number>);
