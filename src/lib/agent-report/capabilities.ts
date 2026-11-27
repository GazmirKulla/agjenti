/**
 * Raporti "Aftësitë e Agjentit": çfarë di të bëjë agjenti i klientit dhe Asistenti, modul pas moduli,
 * i vlerësuar nga leximi i kodit. Shfaqet te Platform Admin → Shëndeti i Agjentit → Aftësitë e Agjentit.
 *
 * Kur një ndryshim shton, heq ose kufizon një aftësi, ndrysho këtu vlerësimin në të njëjtin ndryshim:
 * "po" (funksionon), "pjes" (vetëm me konfigurim ose pjesërisht), "jo" (nuk ekziston). Përditëso edhe
 * `capabilityReportUpdated`, dhe `currentState` / `mainProblems` nëse ndryshuan. Raporti mban gjendjen reale,
 * jo atë të synuar: kur një provë live, review ose test tregon se diçka punon më keq, ule vlerësimin.
 * Një veprim që me qëllim mbetet vetëm me dorë (pagesat, ekipi, kredencialet, lidhjet me Meta/Google, fshirjet
 * e pakthyeshme) nuk është mangësi: shkon te `manualByDesign`, jo si "jo" në një modul.
 */
export type CapabilityStatus = "po" | "pjes" | "jo";
export type CapabilityModule = { name: string; items: [CapabilityStatus, string][] };

export const capabilityReportUpdated = "2026-11-27";

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
      ["po", "Jep kontaktet, adresën dhe orarin e hapjes nga profili i biznesit (Agjenti → Biznesi); ditët dhe fushat që mungojnë i thotë si të panjohura (provuar live më 25 nëntor)"],
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
      ["pjes", "Mban mend emrin, telefonin dhe adresën: live më 27 nëntor profili i ruajtur i klientit ishte bosh dhe porosia e pyeti sërish për emrin; tani emri dhe kontakti i dhënë më parë në të njëjtën bisedë ripërdoren për porosinë ose rezervimin tjetër (pret provën live)"],
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
      ["pjes", "Kontrollon oraret edhe për pyetje para rezervimit, kur procesi është aktiv dhe shërbimi identifikohet qartë"],
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
      ["po", "Statusi i porosisë: automatik kur Porositë janë të ndezura; numër i përhershëm për biznesin në vend të UUID-së (kërkon migrimin readable_order_numbers)"],
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
      ["pjes", "Krijimi nga oraret e lira, pasi pronari ndez “Agjenti rezervon vetë” dhe shërbimet, të dyja te Çfarë bën Agjenti (provuar live nga Instagram më 27 nëntor: kontrolloi orarin dhe rezervoi)"],
      ["pjes", "Oraret e ditës ose ditëve në vijim. Në Chat Lab prova përdor vetëm orarin e konfiguruar"],
      ["po", "Statusi i rezervimit të vet (rezervimet e bëra në bisedë)"],
      ["po", "Anulimi nga klienti, pas konfirmimit të tij (provuar live më 27 nëntor: u anulua dhe orari u lirua). Ajo provë kërkoi tre konfirmime dhe tregoi ID-të e brendshme; korrigjimi (një konfirmim, pa fusha teknike) pret provën e radhës"],
      ["pjes", "Zhvendosja në një orë tjetër të lirë, pas konfirmimit të tij: live më 27 nëntor ngeci dy herë dhe në fund ia kaloi stafit. Shkaku: korrigjimi i orës pas leximit të rezervimeve refuzohej (correction_requires_new_instance), ndaj asnjë datë a orë e re nuk ruhej. Korrigjuar në kod; pret provën live"],
      ["pjes", "Kujtesa në mëngjes të ditës së rezervimit: vetëm kur klienti ka shkruar në 24 orët e fundit (provuar live më 27 nëntor: mbërriti në Instagram në 07:30)"],
      ["pjes", "Klienti mëson kur stafi e konfirmon, anulon ose zhvendos rezervimin: vetëm brenda 24 orëve"],
    ],
  },
];

export const businessCapabilities: CapabilityModule[] = [
  {
    name: "Shërbimet",
    items: [
      ["po", "Krijo dhe ndrysho shërbimin"],
      ["po", "Çaktivizo shërbimin (fshirja nuk lejohet, sepse rezervimet e vjetra i referohen)"],
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
      ["po", "Orari i rezervimeve, ditët e mbyllura dhe mënyra e konfirmimit (në panel te Rezervimet → Orari)"],
    ],
  },
  {
    name: "Agjenti",
    items: [
      ["pjes", "Një ndryshim i konfigurimit me disa pjesë (njohuri, udhëzime, komunikim, sjellje, mësime, leja e rezervimit për shërbim/kalendar) me një konfirmim, si tërësi; 3 versione të plota me Rikthe. Migrimi është aplikuar dhe ndryshimet nga paneli ruhen si versione (33 deri më 27 nëntor), por asnjë ndryshim me disa pjesë nuk është bërë ende nga Asistenti live"],
      ["po", "Udhëzimet dhe stili i komunikimit: zbatohen pas konfirmimit si version i ri, që mund të rikthehet"],
      ["po", "Menaxhimi i agjentit"],
      ["pjes", "Ruaj trajnimin: shembuj dhe mësime për procese; toni dhe stili për gjithë biznesin shkojnë te udhëzimet"],
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
      ["pjes", "Grafikë të porosive të krijuara për 7, 30 ose 90 ditët e fundit, me tabelë dhe ruajtje në historik; i njëjti komponent si Raportet. Kërkon migrimin shared_report_chart_data; ende pa provë live me AI."],
      ["pjes", "Numëron dhe krahason produktet në server. Kërkimet e reja shfaqin tabela të strukturuara. Tabelat Markdown shfaqen edhe në historik (deri në 60 rreshta, 12 kolona dhe buxhetin e tekstit); formati që zgjedh modeli nuk garantohet."],
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
      ["pjes", "Përgatit njohuri, udhëzime dhe memorie nga konteksti i pronarit, me kontroll të pavarur dhe miratim të versionit përfundimtar; ende pa provë live me AI"],
      ["po", "Fshi"],
    ],
  },
  {
    name: "Bisedat",
    items: [
      ["po", "Tituj semantikë për biseda të reja të Asistentit dhe provës (provuar live nga pronari më 27 nëntor)"],
      ["po", "Formaton përgjigjet për pronarin me paragrafë, lista, theksim dhe lidhje"],
      ["po", "Lexon bisedat e fundit"],
      ["po", "Ndalo dhe rinis Agjentin në një bisedë"],
      ["po", "Njoftime për bisedat që presin"],
      ["jo", "Dërgo mesazh klientit, me konfirmim, brenda 24 orëve të Instagram/WhatsApp"],
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
      ["po", "Integrimet: gjendja, prova e lidhjes dhe rifreskimi i produkteve nga webi"],
    ],
  },
  {
    name: "Klientët",
    items: [
      ["po", "Kërko klientë"],
      ["jo", "Ndrysho emrin ose kontaktin e klientit"],
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
      ["jo", "Përgatit draftin e fushatës (tekstin dhe audiencën) për ta parë dhe dërguar pronari te Fushatat"],
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
    name: "Kanalet",
    items: [
      ["po", "Tregon gjendjen e Instagram/WhatsApp (lidhja, skadimi i token-it, dërgimet që dështojnë) dhe jep lidhjen te Integrimet"],
    ],
  },
];

/**
 * Veprime që mbeten me qëllim vetëm me dorë: nuk janë mangësi dhe nuk llogariten. Mbahen këtu që të mos
 * rishfaqen si "jo" në module.
 */
export const manualByDesign: string[] = [
  "Abonimi, paketa dhe pagesat: vetëm pronari te Paketa dhe pagesat.",
  "Anëtarët e ekipit dhe ftesat: vetëm pronari te Cilësimet.",
  "Lidhja dhe shkëputja e Instagram/WhatsApp: hyrja te Meta dhe miratimi i lejeve i bën pronari te Integrimet (Asistenti tregon gjendjen dhe jep lidhjen).",
  "Lidhja me Google Calendar: hyrja te Google e bën pronari te Rezervimet → Orari.",
  "Lidhja e faqes ose katalogut të jashtëm dhe kredencialet (çelësat API): vetëm pronari te Integrimet.",
  "Dërgimi i një fushate te klientët: e konfirmon vetëm pronari te Fushatat.",
  "Fshirja e klientit dhe e të dhënave të tij: vetëm me dorë, sepse është e pakthyeshme.",
];

/** Ku gjendja reale sot ndryshon nga ajo që thonë aftësitë. */
export const currentState = [
  "Llogaria OpenAI është e pronarit dhe ka kredi; Agjenti përgjigjet sërish (verifikuar live më 18 nëntor).",
  "Procesi automatik është live (migrimi u aplikua). Te Filiz Store, pa workflow të vizatuar, Agjenti e çoi porosinë deri te konfirmimi. Rezervimet nga kanalet janë ndezur vetëm te Filiz Store (për provë): më 27 nëntor Agjenti krijoi dhe anuloi rezervime nga Instagram; te bizneset e tjera “Agjenti rezervon vetë” është i fikur.",
  "Të gjitha cilësimet e Agjentit janë në një vend, te “Çfarë bën Agjenti”: porositë (regjistrim ose vetëm kërkesë), pyetjet për klientin, rezervimet, kalimi te stafi, mesazhet zanore dhe klienti i pakënaqur.",
  "Çdo hyrje dhe dalje e aftësive regjistrohet, edhe punët në sfond dhe integrimet (Instagram, WhatsApp, Google, POK); skeda Shëndeti tregon çfarë shkoi keq me kodin e shkakut, lidhjet që duken aktive por nuk punojnë dhe punët e ngecura. Të dhënat reale janë ende pak.",
  "Te Lende Drusore Destani, Instagram-i është i lidhur por Meta nuk aktivizoi mesazhet (subscribed_apps): Agjenti nuk merr DM derisa llogaria të rilidhet si profesionale me të gjitha lejet.",
  "Pagesat e paketës funksionojnë me faqen e POK (mjedis prove): një pagesë prove Enterprise u regjistrua dhe paketa u aktivizua deri më 20 dhjetor. Rinovimi është me dorë; rinovimi automatik pret dokumentimin e Subscriptions të POK.",
  "Mesazhet zanore, videot dhe kalimi te stafi kur klienti është i pakënaqur janë live, por ende pa u provuar me klientë të vërtetë.",
  "Përgjigjet e Agjentit (1–27 nëntor, live): 85 të dërguara; 495 mesazhe pa përgjigje sepse pronari i kishte fikur përgjigjet automatike; 4 dështime (3 radhë të dështuara më 23 nëntor, 1 token i refuzuar më 22 nëntor).",
];

export const mainProblems: { title: string; detail: string }[] = [
  { title: "Formati i përgjigjeve të Asistentit varet ende nga modeli.", detail: "Renderimi Markdown u korrigjua dhe shembulli i raportuar me 18 produkte kalon testet për mesazhe të reja dhe historike. Kërkimet e serverit ruajnë tabelat e tyre. Korrigjimi nuk detyron modelin të zgjedhë tabelë; tabelat jashtë kufijve mbeten tekst i lexueshëm. Ende pa verifikim në prodhim." },
  { title: "Realtime në pajisje dhe vazhdimi i punëve kërkojnë verifikim.", detail: "Migrimi realtime është aplikuar në databazën reale dhe kanali privat, izolimi dhe marrja e njoftimit janë verifikuar. Worker-i çdo minutë është aktiv. Publikimi i klientëve, rikuperimi pas humbjes së vazhdimit dhe sjellja në sfond në pajisje reale mbeten të paverifikuara." },
  { title: "Editori i workflow-ve nuk hiqet dot plotësisht.", detail: "Pa proces të publikuar, serveri e ndërton vetë procesin nga produktet dhe cilësimet, dhe të gjitha cilësimet e Agjentit janë te “Çfarë bën Agjenti”. Agjenti.app ka ende nevojë për editorin, sepse rrjedha “Regjistrim biznesi” krijon biznes dhe ftesë, gjë që procesi i zakonshëm nuk e bën." },
  { title: "Bisedat e rezervimit kërkojnë verifikim live pas korrigjimeve.", detail: "Prova nga Instagram më 27 nëntor krijoi rezervimin, por ID-ja e shërbimit doli te klienti, udhëzime të brendshme (në anglisht) u përsëritën, anulimi kërkoi tre konfirmime dhe një fjali të saktë, emri u kërkua sërish dhe zhvendosja ngeci (edhe pas korrigjimeve të para: çdo korrigjim i orës pas leximit të rezervimeve refuzohej, ndaj gjendja nuk ndryshonte dhe Agjenti pyeste për muajin). Korrigjimet në kod (korrigjimi i lejuar pas një leximi, shenjat e shërbimit, përmbledhja pa fusha teknike, një rezervim zgjidhet vetë, data dhe ora lokale e biznesit, oraret e plota të ditës së rezervimit, emri dhe kontakti nga e njëjta bisedë) presin provën live. Mesazhet bosh (reagime) marrin ende përgjigje. Kujtesat dhe mesazhet për vendimet e stafit dërgohen vetëm brenda 24 orëve nga mesazhi i fundit i klientit (rregulli i Instagram/WhatsApp, pa shabllone)." },
  { title: "Porositë pas krijimit bëhen me dorë.", detail: "Klienti nuk e ndryshon dot porosinë, dhe Asistenti nuk ndryshon dot statusin apo dërgesën." },
  { title: "Pronari nuk e sheh suksesin e Agjentit.", detail: "Platforma e mat tani çdo hyrje dhe dalje të aftësive (skeda Shëndeti), por pronari te paneli i vet dhe Asistenti nuk e dinë sa porosi u lanë në mes ose sa mesazhe mbetën pa përgjigje." },
  { title: "Porosia kërkon të dhëna që nuk i duhen.", detail: "Për një PDF që shkarkohet, Agjenti kërkon qytetin dhe adresën, një nga një. Të dhënat e kërkuara varen nga cilësimi i biznesit, jo nga mënyra si merret produkti." },
  { title: "Komentet në Instagram injorohen.", detail: "Webhook-u merr vetëm mesazhet në DM; komentet si “Sa kushton?” nën postime nuk i arrijnë Agjentit, ndonëse aty nis shumica e shitjeve." },
  { title: "Porosia ka vetëm një produkt.", detail: "Pa shportë, kuponë, ankesa apo kthime, çdo kërkesë përtej një produkti të vetëm i kalon stafit." },
  { title: "Agjenti nuk i sheh fotot.", detail: "Në Instagram dhe WhatsApp, kur klienti dërgon foto, Agjenti e di vetëm që u dërgua; mesazhet zanore dhe zërin e videove i kthen në tekst, por figurën e videos nuk e sheh. Në prova (Chat Lab) fotot i sheh, ndaj prova duket më mirë se realiteti." },
  { title: "Agjenti nuk rikthehet te klienti.", detail: "Kur klienti e lë porosinë ose rezervimin në mes, askush nuk e kujton. Njoftimet i shkojnë vetëm pronarit, për lead-et pa përgjigje." },
  { title: "Burimet rilexohen, por pa krahasim të plotë.", detail: "Rifreskimi (me dorë, nga Asistenti ose çdo javë) sjell propozime për çfarë është e re ose ndryshe dhe shënon njohuritë që faqja nuk i thotë më, por Instagram-i lexohet vetëm nga postimet e fundit dhe një profil publik lexohet vetëm një herë." },
  { title: "Varësia nga OpenAI pa sinjal.", detail: "Kur mbarojnë kreditë, ndalet gjithçka dhe pronari nuk paralajmërohet." },
  { title: "Njoftimet në celular nuk dërgohen.", detail: "Nga 1 deri më 27 nëntor, 292 përpjekje dërgimi te Expo dështuan të gjitha (send:unexpected) dhe asnjë njoftim nuk doli: 121 presin, 58 u hoqën. Pajisja ka token të vlefshëm Expo. Shkaku nuk dihet, sepse kodi nuk ruan gabimin e Expo-s (statusin HTTP ose details.error)." },
  { title: "Lidhja e Instagram-it dështon shpesh te webhook-u.", detail: "Nga 6 lidhje (18–23 nëntor), 4 dështuan me meta_100 kur aktivizohej webhook-u (subscribed_apps); llogaria duket e lidhur, por Agjenti nuk merr DM derisa pronari ta rilidhë si llogari profesionale me të gjitha lejet." },
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
