const catalogExample = {
  products: [{
    id: "produkt-1", name: "Produkt shembull", productType: "tipi-1", price: 1500,
    currency: "ALL", formats: [{ id: "format-1", name: "Standard", price: 1500 }],
    colors: [{ id: "ngjyra-1", name: "E bardhë" }],
  }],
};
const orderExample = {
  channel: "instagram",
  customer: { name: "Klient shembull", phone: "+355…", city: "Tiranë", address: "Adresë shembull" },
  items: [{ productId: "produkt-1", productType: "tipi-1", formatId: "format-1", colorId: "ngjyra-1", quantity: 1, character: null }],
};

export const developerPrompt = `Implemento në këtë repository lidhjen e webit me Agjenti.app.

Qëllimi
Agjenti lexon katalogun e webit dhe mund të dërgojë porosi në sistemin ekzistues. Inspekto stack-un, routes, modelet e produkteve/varianteve, autorizimin dhe shërbimin e porosive para ndryshimeve. Ripërdor logjikën dhe databazën ekzistuese; ruaj funksionalitetin e webit. Mos krijo katalog ose porosi demonstrimi në prodhim.

1. Autorizimi në server
Përdor një sekret të ruajtur në konfigurimin e serverit si AGJENTI_APP_SECRET. I njëjti sekret vendoset te Integrimet → Webi i klientit në Agjenti; minimumi është 16 karaktere. Nëse ka një sekret ekzistues, ruaje. Mos e përfshi sekretin në kod, browser, logs, përgjigje ose raportin përfundimtar. Dokumento vetëm emrin e variablës dhe mënyrën e vendosjes së saj.
Çdo endpoint verifikon Authorization: Bearer <sekreti>. Kthe HTTP 401 për sekret të munguar ose të gabuar; nëse serveri nuk ka sekret të konfiguruar, refuzo kërkesën. Në një sistem me disa biznese, kufizo katalogun dhe porositë te biznesi që përfaqëson ky sekret.
Kthe JSON, përdor HTTPS në prodhim dhe përfundo kërkesat brenda 20 sekondave. Ky është komunikim server-me-server.

2. Katalogu — GET /api/integrations/agjenti/catalog
Mund të përdorësh një route tjetër nëse konventat e projektit e kërkojnë; jep URL-në e plotë përfundimtare në dorëzim.
Kthe HTTP 200 me objektin products, që është array edhe kur është bosh: {"products":[]}.
Çdo produkt ka id dhe name si string. ID-të e produkteve dhe varianteve duhet të jenë të qëndrueshme dhe të përputhen me ID-të që pranon endpoint-i i porosive.
productType: string ose null; price: number ose null; currency: string opsional (p.sh. ALL ose EUR). Përshtat njësinë e çmimit nga modeli ekzistues dhe dokumentoje; mos ndrysho monedhën ose shkallën e çmimit në heshtje.
formats është array opsional me {id: string, name: string, price: number | null}; colors është array opsional me {id: string, name: string}. Mos shpik variante që webi nuk i ka.
Shembull ilustrues i përgjigjes:
${JSON.stringify(catalogExample, null, 2)}

3. Porositë — POST /api/integrations/agjenti/orders (opsionale)
Implementoje kur webi ka një sistem real porosish. Nëse mungon, dorëzo katalogun funksional dhe shpjego çfarë mungon; mos ndërto një sistem të ri porosish pa sqaruar scope-in.
Prano Content-Type: application/json dhe të njëjtin autorizim Bearer. Rrjedha ekzistuese e Agjenti për dërgimin nga bisedat Instagram dërgon këtë formë:
${JSON.stringify(orderExample, null, 2)}
Fushat e varianteve dhe character mund të jenë null; customer.city mund të mungojë ose të jetë null. Valido në server emrin, telefonin dhe adresën, produktet, sasitë dhe përkatësinë e varianteve. Llogarit çmimet dhe kontrollo disponueshmërinë përmes logjikës ekzistuese të webit. Mos shëno pagesë si të kryer vetëm sepse erdhi kjo kërkesë.
Krijo porosinë përmes shërbimit ekzistues dhe kthe sukses vetëm pas ruajtjes së konfirmuar: HTTP 2xx me {"ok":true,"orderId":"id-reale","orderNumber":123}. orderId është string opsional, orderNumber number opsional. Për dështim kthe status HTTP përkatës dhe {"ok":false,"error":"Përshkrim i sigurt i gabimit"}.
Kontrata aktuale nuk dërgon një çelës idempotence ose ID unike të kërkesës. Mos kërko fusha të reja të detyrueshme që Agjenti nuk i dërgon; raporto kufizimin për dërgime të përsëritura.

4. Verifikimi dhe dorëzimi
Testo autorizimin e munguar/të gabuar, konfigurimin pa sekret, katalogun bosh dhe katalogun me produkte reale testimi. Nëse implementon porositë, testo payload të pavlefshëm, produkt/variant të panjohur, gabim ruajtjeje dhe porosi të vlefshme në ambient testimi. Mos krijo porosi reale për test pa autorizim.
Jep përmbledhjen e ndryshimeve, testet e kryera, konfigurimet/migrimet e nevojshme dhe çfarë mbetet për publikim. Dallo kodin lokal nga endpoint-et e publikuara; mos pretendo sukses të integrimit pa provë.
Dorëzo URL-në e plotë HTTPS të katalogut dhe URL-në e porosive nëse është implementuar. Nëse domeni nuk dihet, përdor placeholder të qartë dhe kërko domenin për URL-në përfundimtare. Mos jep sekretin në raport.
Udhëzo pronarin t'i vendosë URL-të dhe sekretin te Agjenti → Integrimet → Webi i klientit, të përdorë Testo lidhjen, të ruajë konfigurimin dhe të lidhë produktet nga Produktet. Testi i Agjenti kontrollon vetëm katalogun, nuk ruan konfigurimin dhe nuk verifikon/dërgon porosi.
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
      <p className="muted-copy">Shembull adrese: <code>https://webi-juaj.al/api/integrations/agjenti/catalog</code>. Përgjigjja duhet të ketë <code>products[]</code>; çdo produkt ka <code>id</code> dhe <code>name</code> si tekst. Mbaj ID-të të qëndrueshme. <code>productType</code> dhe <code>price</code> mund të jenë null; <code>currency</code>, <code>formats</code> dhe <code>colors</code> janë opsionale. Çmimet jepen si numra. Katalogu bosh kthehet si <code>{'{"products": []}'}</code>.</p>
      <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(catalogExample, null, 2)}</code></pre>
    </details>
    <details>
      <summary>Porositë · POST · opsionale</summary>
      <p className="muted-copy">Shembull adrese: <code>https://webi-juaj.al/api/integrations/agjenti/orders</code>. Agjenti dërgon <code>Content-Type: application/json</code>. Rrjedha ekzistuese e dërgimit të porosive nga bisedat Instagram përdor këtë strukturë; vlerat e varianteve varen nga të dhënat e mbledhura:</p>
      <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(orderExample, null, 2)}</code></pre>
      <p className="muted-copy">Për sukses kthe HTTP 2xx dhe <code>{'{"ok": true, "orderId": "porosi-1", "orderNumber": 123}'}</code>. <code>orderId</code> është tekst dhe <code>orderNumber</code> numër; të dy janë opsionalë. Për dështim kthe status gabimi dhe <code>{'{"ok": false, "error": "Arsyeja"}'}</code>. Pa URL porosish, ky integrim nuk dërgon porosi në web. Testi i katalogut nuk verifikon API-në e porosive.</p>
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
        <p className="muted-copy">Example URL: <code>https://your-website.com/api/integrations/agjenti/catalog</code>. The response must contain <code>products[]</code>; each product has string <code>id</code> and <code>name</code> fields. Keep IDs stable. <code>productType</code> and <code>price</code> may be null; <code>currency</code>, <code>formats</code> and <code>colors</code> are optional. Prices are numbers. Return an empty catalog as <code>{'{"products": []}'}</code>.</p>
        <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(catalogExample, null, 2)}</code></pre>
      </details>
      <details><summary>Orders · POST · optional</summary>
        <p className="muted-copy">Example URL: <code>https://your-website.com/api/integrations/agjenti/orders</code>. Agjenti sends <code>Content-Type: application/json</code>. The existing order flow from Instagram conversations uses this structure; variant values depend on the collected data:</p>
        <pre className="overflow-x-auto text-sm p-3"><code>{JSON.stringify(orderExample, null, 2)}</code></pre>
        <p className="muted-copy">On success return HTTP 2xx and <code>{'{"ok": true, "orderId": "order-1", "orderNumber": 123}'}</code>. <code>orderId</code> is a string and <code>orderNumber</code> a number; both are optional. On failure return an error status and <code>{'{"ok": false, "error": "Reason"}'}</code>. Without an orders URL, this integration does not submit orders to the website. The catalog test does not verify the orders API.</p>
      </details>
    </div>
  </details>;
}
