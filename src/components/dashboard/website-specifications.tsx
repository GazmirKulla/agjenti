/** Version 2 of the website contract. The v1 fields (formats, colors, formatId, colorId) stay for compatibility. */
const catalogExample = {
  version: 2,
  currency: "ALL",
  orderFields: [
    { key: "email", label: "Email", type: "text", appliesTo: "order", required: false },
  ],
  products: [{
    id: "produkt-1", name: "Produkt shembull", productType: "tipi-1",
    priceMode: "from", price: 1200, priceMax: null, priceUnit: null, currency: "ALL",
    options: [
      { key: "size", label: "Masa", affectsPrice: true,
        values: [{ id: "format-1", name: "Standard" }, { id: "format-2", name: "E madhe" }] },
      { key: "color", label: "Ngjyra", affectsPrice: false, values: [{ id: "ngjyra-1", name: "E bardhë" }] },
    ],
    variants: [
      { id: "format-1", options: { size: "format-1" }, sku: null, price: 1200, active: true },
      { id: "format-2", options: { size: "format-2" }, sku: null, price: 1500, active: true },
    ],
    addons: [{ id: "shtese-1", name: "Paketim dhuratë", price: 300, appliesToVariants: ["format-2"] }],
    fields: [
      { key: "personalization", label: "Teksti në produkt", type: "text", appliesTo: "item", required: true, maxLength: 40 },
      { key: "photo", label: "Foto referencë", type: "photo", appliesTo: "item", required: false, max: 3 },
    ],
    formats: [{ id: "format-1", name: "Standard", price: 1200 }, { id: "format-2", name: "E madhe", price: 1500 }],
    colors: [{ id: "ngjyra-1", name: "E bardhë" }],
  }],
};
/** What Agjenti sends today (v1) and what it will send once v2 sending is enabled. */
const orderExample = {
  channel: "instagram",
  customer: { name: "Klient shembull", phone: "+355…", city: "Tiranë", address: "Adresë shembull" },
  items: [{ productId: "produkt-1", productType: "tipi-1", formatId: "format-1", colorId: "ngjyra-1", quantity: 1, character: null }],
};
const orderExampleV2 = {
  version: 2,
  channel: "instagram",
  source: "owner_manual",
  customer: { name: "Klient shembull", phone: "+355…", city: "Tiranë", address: "Adresë shembull" },
  fields: { email: null },
  note: null,
  currency: "ALL",
  expectedTotal: 1200,
  items: [{
    productId: "produkt-1", variantId: "format-1", options: { size: "format-1", color: "ngjyra-1" },
    addons: [], fields: { personalization: "Ana" },
    files: [{ key: "photo", url: "https://…", contentType: "image/jpeg" }],
    quantity: 1, unitAmount: 1200,
  }],
};

export const developerPrompt = `Implemento në këtë repository lidhjen e webit me Agjenti.app (kontrata versioni 2).

Qëllimi
Agjenti lexon katalogun e webit dhe, kur pronari e konfirmon në bisedë, krijon porosinë në sistemin ekzistues të webit. Katalogu duhet të tregojë jo vetëm produktet dhe çmimet, por edhe çfarë duhet zgjedhur dhe mbledhur që porosia të jetë e vlefshme, që Agjenti ta mbledhë para se ta dërgojë.
Inspekto stack-un, routes, modelet e produkteve/varianteve/çmimeve/shtesave, rregullat e validimit të porosisë (checkout), autorizimin dhe shërbimin e porosive para ndryshimeve. Ripërdor logjikën dhe databazën ekzistuese; ruaj funksionalitetin e webit. Mos ndërto një sistem porosish paralel dhe mos krijo katalog ose porosi demonstrimi në prodhim.

1. Autorizimi në server
Përdor një sekret të ruajtur në konfigurimin e serverit si AGJENTI_APP_SECRET. I njëjti sekret vendoset te Integrimet → Webi i biznesit në Agjenti; minimumi është 16 karaktere. Nëse ka një sekret ekzistues, ruaje. Mos e përfshi sekretin në kod, browser, logs, përgjigje ose raportin përfundimtar. Dokumento vetëm emrin e variablës dhe mënyrën e vendosjes së saj.
Çdo endpoint verifikon Authorization: Bearer <sekreti>. Kthe HTTP 401 për sekret të munguar ose të gabuar; nëse serveri nuk ka sekret të konfiguruar, refuzo kërkesën. Në një sistem me disa biznese, kufizo katalogun dhe porositë te biznesi që përfaqëson ky sekret.
Kthe JSON, përdor HTTPS në prodhim dhe përfundo kërkesat brenda 20 sekondave. Ky është komunikim server-me-server.

2. Katalogu — GET /api/integrations/agjenti/catalog
Mund të përdorësh një route tjetër nëse konventat e projektit e kërkojnë; jep URL-në e plotë përfundimtare në dorëzim.
Kthe HTTP 200 me {"version":2,"currency":"ALL","orderFields":[],"products":[]}; products është array edhe kur është bosh.
Çdo produkt ka:
- id dhe name si string; ID-të e produkteve, varianteve, vlerave të opsioneve dhe shtesave janë të qëndrueshme dhe janë ato që pranon endpoint-i i porosive.
- productType (string ose null); priceMode: "fixed" | "from" | "range" | "request"; price dhe priceMax (numër ose null); priceUnit (p.sh. "m²", ose null); currency; image (lidhje https e fotos kryesore të produktit, ose null).
- options: [{key, label, affectsPrice, values: [{id, name}]}] — zgjedhjet e klientit (masa, formati, ngjyra, materiali).
- variants: [{id, options: {key: valueId}, sku, price, active}] — çdo kombinim që ka çmimin ose kodin e vet.
- addons: [{id, name, price, appliesToVariants}] — shtesa opsionale me çmim.
- fields: [{key, label, type, appliesTo, required, requiredWhen, min, max, maxLength}] — të dhënat që porosia kërkon për artikullin. type është një nga text, number, boolean, date, choice (me values), photo, file.
orderFields përdor të njëjtën formë për të dhënat e gjithë porosisë (p.sh. email, mënyra e dorëzimit), përveç emrit, telefonit dhe adresës që Agjenti i dërgon gjithmonë.
Deklaro vetëm atë që webi ka dhe kërkon realisht. Çdo rregull që checkout-i i webit e zbaton (masë, ngjyrë, foto, tekst personalizimi, email, dorëzim) duhet të dalë si opsion ose fushë me required: true, me requiredWhen për rastet e kushtëzuara (p.sh. {"variant":["format-2"]}). Mos jep opsione që nuk vlejnë për produktin, si ngjyra për një produkt pa ngjyra. Çmimet merren nga burimi live, pa rezerva të ruajtura; mos ndrysho monedhën ose njësinë në heshtje dhe mos shpik variante.
Për pajtueshmëri, ruaj edhe fushat e versionit 1 kur ekzistojnë: formats [{id, name, price}] dhe colors [{id, name}].
Shembull ilustrues:
${JSON.stringify(catalogExample, null, 2)}

3. Porositë — POST /api/integrations/agjenti/orders (opsionale)
Implementoje kur webi ka një sistem real porosish. Nëse mungon, dorëzo katalogun funksional dhe shpjego çfarë mungon; mos ndërto një sistem të ri porosish pa sqaruar scope-in.
Prano Content-Type: application/json dhe të njëjtin autorizim Bearer. Prano të dyja format:
- Versioni 1, që dërgon ende rruga e porosive të konfirmuara nga stafi pas agjentit: formatId dhe colorId janë ID-të e formats/colors; character mund të jetë null; customer.city mund të mungojë.
${JSON.stringify(orderExample, null, 2)}
- Versioni 2 ("version": 2), që dërgon porosia e krijuar nga pronari në bisedë («Krijo porosi»), me variantin, zgjedhjet, shtesat, fushat dhe skedarët e deklaruar në katalog. Për pajtueshmëri përfshin edhe formatId, colorId dhe character:
${JSON.stringify(orderExampleV2, null, 2)}
Valido në server përmes logjikës ekzistuese të checkout-it: produktin, përkatësinë e variantit, opsioneve dhe shtesave, fushat e detyrueshme, sasinë dhe skedarët. Skedarët shkarkoji nga URL-ja menjëherë (URL-të kanë afat) dhe ruaji te storage i webit. Rillogarit çmimin, transportin dhe disponueshmërinë; mos shëno pagesë si të kryer vetëm sepse erdhi kjo kërkesë.
expectedTotal është shuma e artikujve (çmimi i variantit plus shtesat, herë sasinë), pa transportin. Nëse kjo shumë e rillogaritur ndryshon nga expectedTotal, mos e krijo porosinë: kthe HTTP 409 me {"ok":false,"error":"price_changed","total":1300}.
Idempotenca: Agjenti dërgon header-in X-Agjenti-Submission-Id, unik për çdo porosi. Ruaje me indeks unik; për të njëjtin ID kthe të njëjtën përgjigje dhe mos krijo porosi të dytë.
Kthe sukses vetëm pas ruajtjes së konfirmuar: HTTP 2xx me {"ok":true,"orderId":"id-reale","orderNumber":123}. orderId është string opsional, orderNumber number opsional. Për dështim kthe status përkatës (400 të dhëna të pavlefshme, 409 konflikt, 5xx gabim i përkohshëm) dhe {"ok":false,"error":"kod_i_sigurt","field":"çelësi i fushës kur ka"}.
Opsionale: POST /api/integrations/agjenti/orders/quote me të njëjtin body kthen {"ok":true,"total":1500,"shipping":300,"lines":[...]} pa krijuar porosi.

4. Verifikimi dhe dorëzimi
Testo autorizimin e munguar/të gabuar, konfigurimin pa sekret, katalogun bosh dhe katalogun me produkte reale testimi. Nëse implementon porositë, testo payload v1 dhe v2, çdo fushë të detyrueshme që mungon, variant/opsion/shtesë të panjohur, opsion që nuk vlen për produktin, skedar të pavlefshëm, çmim të ndryshuar, përsëritjen me të njëjtin X-Agjenti-Submission-Id dhe gabim ruajtjeje. Mos krijo porosi reale për test pa autorizim.
Jep përmbledhjen e ndryshimeve, testet e kryera, konfigurimet/migrimet e nevojshme dhe çfarë mbetet për publikim. Dallo kodin lokal nga endpoint-et e publikuara; mos pretendo sukses të integrimit pa provë.
Dorëzo URL-në e plotë HTTPS të katalogut dhe URL-në e porosive nëse është implementuar. Nëse domeni nuk dihet, përdor placeholder të qartë dhe kërko domenin për URL-në përfundimtare. Mos jep sekretin në raport.
Udhëzo pronarin t'i vendosë URL-të dhe sekretin te Agjenti → Integrimet → Webi i biznesit, të përdorë Testo lidhjen, të ruajë konfigurimin dhe të lidhë produktet nga Produktet. Testi i Agjenti kontrollon vetëm katalogun, nuk ruan konfigurimin dhe nuk verifikon/dërgon porosi.
`;

export function WebsiteSpecifications({ language = "sq" }: { language?: "sq" | "en" }) {
  if (language === "en") return <EnglishWebsiteSpecifications />;
  return <details>
    <summary>Specifikimet teknike</summary>
    <div className="grid gap-4 mt-4">
    <p className="muted-copy">Programuesi i webit duhet të përgatisë adresat API më poshtë. Vendos adresën e plotë të API-së, jo faqen kryesore të webit. Shembujt janë ilustrues.</p>
    <ol className="list-decimal pl-5 space-y-2">
      <li>Përgatit API-në e katalogut dhe, nëse nevojitet, API-në e porosive në webin e klientit.</li>
      <li>Vendos të njëjtin API key në serverin e webit dhe në këtë formular (të paktën 16 karaktere). Në integrimin ekzistues përdoret emri <code>AGJENTI_APP_SECRET</code>.</li>
      <li>Testo katalogun, ruaj lidhjen, pastaj lidh produktet nga faqja Produkte. Testi nuk ruan konfigurimin dhe nuk dërgon porosi.</li>
    </ol>
    <details>
      <summary>Autorizimi dhe përgjigjet</summary>
      <p className="muted-copy">Kërkesat dërgohen nga serveri i Agjenti me <code>Authorization: Bearer API_KEY</code>. Webi duhet ta verifikojë çelësin në server dhe të kthejë JSON. Përdor HTTPS. Afati i pritjes është 20 sekonda për kërkesë; për çelës të pavlefshëm kthe HTTP 401.</p>
    </details>
    <details>
      <summary>Katalogu · GET · i nevojshëm</summary>
      <p className="muted-copy">Shembull adrese: <code>https://webi-juaj.al/api/integrations/agjenti/catalog</code>. Përgjigjja ka <code>{'"version": 2'}</code> dhe <code>products[]</code>; çdo produkt ka <code>id</code> dhe <code>name</code> si tekst. Mbaj ID-të të qëndrueshme.</p>
      <p className="muted-copy">Çmimi: <code>priceMode</code> (<code>fixed</code>, <code>from</code>, <code>range</code>, <code>request</code>), <code>price</code>, <code>priceMax</code>, <code>priceUnit</code>. Zgjedhjet e klientit janë te <code>options</code>, kombinimet me çmim te <code>variants</code>, shtesat te <code>addons</code>. Të dhënat që kërkon porosia (tekst, numër, datë, zgjedhje, foto, skedar) janë te <code>fields</code> për artikullin dhe te <code>orderFields</code> për gjithë porosinë, me <code>required</code> dhe <code>requiredWhen</code>.</p>
      <p className="muted-copy">Deklaro vetëm atë që webi kërkon realisht. Fushat e versionit 1 (<code>formats</code>, <code>colors</code>) mbeten të vlefshme. Katalogu bosh kthehet si <code>{'{"version": 2, "products": []}'}</code>.</p>
      <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(catalogExample, null, 2)}</code></pre>
    </details>
    <details>
      <summary>Porositë · POST · opsionale</summary>
      <p className="muted-copy">Shembull adrese: <code>https://webi-juaj.al/api/integrations/agjenti/orders</code>. Agjenti dërgon <code>Content-Type: application/json</code> dhe <code>X-Agjenti-Submission-Id</code>, unik për çdo porosi: për të njëjtin ID mos krijo porosi të dytë. Porositë e konfirmuara nga stafi pas agjentit dërgohen ende në versionin 1:</p>
      <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(orderExample, null, 2)}</code></pre>
      <p className="muted-copy">«Krijo porosi» në bisedë dërgon versionin 2, me variantin, zgjedhjet, shtesat, fushat dhe skedarët e katalogut (lidhjet e skedarëve skadojnë pas një ore):</p>
      <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(orderExampleV2, null, 2)}</code></pre>
      <p className="muted-copy"><code>expectedTotal</code> është shuma e artikujve pa transportin. Webi e rillogarit; kur ndryshon, kthe HTTP 409 me <code>{'{"ok": false, "error": "price_changed", "total": 1300}'}</code>. Për sukses kthe HTTP 2xx dhe <code>{'{"ok": true, "orderId": "porosi-1", "orderNumber": 123}'}</code>; <code>orderId</code> (tekst) dhe <code>orderNumber</code> (numër) janë opsionalë. Për dështim kthe status gabimi dhe <code>{'{"ok": false, "error": "kodi", "field": "fusha"}'}</code>. Pa URL porosish, ky integrim nuk dërgon porosi në web. Testi i katalogut nuk verifikon API-në e porosive.</p>
    </details>
  </div></details>;
}

function EnglishWebsiteSpecifications() {
  return <details>
    <summary>Technical specifications</summary>
    <div className="grid gap-4 mt-4">
      <p className="muted-copy">Your website developer must prepare the API endpoints below. Enter the complete API URL, not the website homepage. Examples are illustrative.</p>
      <ol className="list-decimal pl-5 space-y-2">
        <li>Prepare the catalog API and, if needed, the orders API on the business website.</li>
        <li>Set the same API key on the website server and in this form (at least 16 characters). The existing integration uses <code>AGJENTI_APP_SECRET</code>.</li>
        <li>Test the catalog, save the connection, then link products from Products. The test does not save configuration or submit orders.</li>
      </ol>
      <details><summary>Authorization and responses</summary>
        <p className="muted-copy">Agjenti’s server sends requests with <code>Authorization: Bearer API_KEY</code>. The website must verify the key on the server and return JSON. Use HTTPS. Requests time out after 20 seconds; return HTTP 401 for an invalid key.</p>
      </details>
      <details><summary>Catalog · GET · required</summary>
        <p className="muted-copy">Example URL: <code>https://your-website.com/api/integrations/agjenti/catalog</code>. The response has <code>{'"version": 2'}</code> and <code>products[]</code>; each product has string <code>id</code> and <code>name</code> fields. Keep IDs stable.</p>
        <p className="muted-copy">Price: <code>priceMode</code> (<code>fixed</code>, <code>from</code>, <code>range</code>, <code>request</code>), <code>price</code>, <code>priceMax</code>, <code>priceUnit</code>. Customer choices go in <code>options</code>, priced combinations in <code>variants</code>, extras in <code>addons</code>. Data the order requires (text, number, date, choice, photo, file) goes in <code>fields</code> for the item and <code>orderFields</code> for the whole order, with <code>required</code> and <code>requiredWhen</code>.</p>
        <p className="muted-copy">Declare only what the website really requires. Version 1 fields (<code>formats</code>, <code>colors</code>) remain valid. Return an empty catalog as <code>{'{"version": 2, "products": []}'}</code>.</p>
        <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(catalogExample, null, 2)}</code></pre>
      </details>
      <details><summary>Orders · POST · optional</summary>
        <p className="muted-copy">Example URL: <code>https://your-website.com/api/integrations/agjenti/orders</code>. Agjenti sends <code>Content-Type: application/json</code> and <code>X-Agjenti-Submission-Id</code>, unique per order: never create a second order for the same ID. Orders confirmed by staff after the agent are still sent as version 1:</p>
        <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(orderExample, null, 2)}</code></pre>
        <p className="muted-copy">“Create order” in a conversation sends version 2, with the variant, choices, extras, fields and files from the catalog (file links expire after one hour):</p>
        <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(orderExampleV2, null, 2)}</code></pre>
        <p className="muted-copy"><code>expectedTotal</code> is the items total without shipping. The website recalculates it; when it differs, return HTTP 409 with <code>{'{"ok": false, "error": "price_changed", "total": 1300}'}</code>. On success return HTTP 2xx and <code>{'{"ok": true, "orderId": "order-1", "orderNumber": 123}'}</code>; <code>orderId</code> (string) and <code>orderNumber</code> (number) are optional. On failure return an error status and <code>{'{"ok": false, "error": "code", "field": "field"}'}</code>. Without an orders URL, this integration does not submit orders to the website. The catalog test does not verify the orders API.</p>
      </details>
    </div>
  </details>;
}
