# Plan: dërgimi i fotos së përpunuar te klienti (për miratim)

Statusi: në prodhim, 16.11.2026. Migrimi `20261116090000_staff_media_messages.sql` u ekzekutua; kodi web `577ec79`, mobile `3766c62` (butoni në aplikacion vjen me 0.3.16). Provë reale te @bora.mato24: fotoja e përpunuar dhe shënimi u dërguan në Instagram (dy pjesë, të dyja me ID), mesazhi u ruajt me foton; porosia provë u fshi në të dyja anët.

## Qëllimi

Biznesi i tregon klientit në bisedë foton e përpunuar të artikullit (dizajni i puzzle-it, bluza me personazhin) që ta miratojë para prodhimit. Fotoja mbetet te webi i biznesit (te Zana `processedImages`); Agjenti e dërgon nga atje, pa e ruajtur.

## Gjendja e sotme

- Inbox-i (web dhe aplikacioni) dërgon vetëm tekst. Mesazhi i stafit kalon nga radha e transportit:
  - `enqueue_transport_operation` (`20261105010902_instagram_human_agent_window.sql`) pranon vetëm `body` me 1–20000 karaktere dhe e ruan te `workflow_inbound_queue.reply`;
  - `runWorkflowQueue` → `sendPrepared` (`src/lib/conversations/workflow-queue.ts`) e dërgon me `channelAdapter(...).send`, pra `sendInstagramText` ose `sendWhatsAppText`;
  - `record_transport_part` dhe `finish_workflow_send` ruajnë dëftesën dhe mesazhin `outbound` te `messages`, pa `media`.
- Sigurinë e dërgimit e mbajmë njësoj: një kërkesë = një dërgim. Një përgjigje e paqartë nuk ridërgohet kurrë. Afatet: Instagram 24 orë, ose 7 ditë me `HUMAN_AGENT` për stafin; WhatsApp 24 orë.
- Fotot e përpunuara lexohen nga webi me `GET {orders_url}/{id}` (`fetchExternalOrder`). Faqja Porositë dhe aplikacioni i tregojnë që tani.

## Ndryshimet

### 1. Radha e transportit pranon një foto (migrim)

`<timestamp>_staff_media_messages.sql`, me timestamp më të ri se migrimi i fundit:
- `enqueue_transport_operation`: pranon edhe `p_payload.media = {"kind": "image", "url": "https://…"}`. `body` bëhet opsional kur ka foto (shënimi nën foto), por mbetet i detyrueshëm pa foto. URL-ja duhet të jetë `https`, deri në 2000 karaktere. Fingerprint-i përfshin URL-në, që e njëjta kërkesë të mos dërgohet dy herë.
- Puna e radhës mban `media` te `payload`, pranë `channel` dhe `timestamp`.
- `finish_workflow_send` dhe `record_transport_part` e ruajnë mesazhin `outbound` me `media = [{"kind": "image", "sourceUrl": …, "caption": …}]`. Kështu fotoja duket te biseda dhe del te «Nga biseda» si foto e biznesit.
- `retry_staff_transport` nuk ndryshon: riprova lejohet vetëm kur dërgimi dështoi qartë.
- Kontrolli i rendit të migrimeve (pika 8): `begin_workflow_send`, `finish_workflow_send` dhe `enqueue_transport_operation` duhet të jenë versioni i ri.

### 2. Dërgimi i fotos në kanal (kod)

- `src/lib/instagram/send.ts`: `sendInstagramImage({ accountId, token, to, url, caption?, humanAgent? })` dërgon `message: { attachment: { type: "image", payload: { url, is_reusable: false } } }`, me të njëjtat rregulla për afatin dhe `HUMAN_AGENT` si teksti. Shënimi, nëse ka, dërgohet si mesazh teksti pas fotos. Çdo pjesë ka dëftesën e vet (`onPart`), si sot.
- `src/lib/whatsapp/api.ts`: `sendWhatsAppImage` dërgon `type: "image", image: { link: url, caption }`.
- `channelAdapter` merr `sendImage`. `sendPrepared` zgjedh `sendImage` kur puna ka `media`.
- URL-ja duhet të arrihet nga Meta: përdoret URL-ja publike e webit të biznesit (te Zana `order-photos` është publik). Për një foto të ngarkuar në Agjenti përdoret lidhja e nënshkruar e `order-files`, me afat 1 orë, mjaftueshëm sa radha ta dërgojë.
- Mesazhi «echo» që Instagram kthen për foton e dërguar njihet nga `external_message_id` dhe nuk ruhet dy herë.

### 3. Butoni «Dërgoja klientit» (kod)

- Te «Fotot e artikujve» (faqja Porositë në web dhe aplikacioni), çdo foto e përpunuar merr butonin «Dërgoja klientit». Ai hap një shënim opsional, p.sh. «Ja si do dalë puzzle-i. A ju pëlqen?», dhe dërgon.
- Rruga: `POST /api/businesses/[id]/conversations/[conversationId]/messages` me `{ requestId, body?, media: { orderId, item, key, url } }`. Serveri lejon vetëm:
  - një foto që i përket asaj porosie, të lexuar sërish nga webi (`fetchExternalOrder`) dhe e njëjtë me URL-në e dërguar;
  - ose një skedar `order-files` i kësaj bisede.

  URL nga klienti nuk pranohet kurrë. Rruga është tashmë te `manual-surfaces.ts` («Human-to-customer communication remains explicit manual sending»); përshkrimi përditësohet me fotot.
- Statusi i dërgimit shfaqet njësoj si për tekstin: «po dërgohet», «u dërgua», «nuk u konfirmua». Për WhatsApp jashtë 24 orëve dhe Instagram jashtë 7 ditëve, butoni nuk aktivizohet dhe tregon arsyen.
- Hap i mëvonshëm (jo në këtë plan): butoni «Foto» te composer-i i bisedës, për çdo foto, jo vetëm për ato të porosisë.

### 4. Miratimi (pa automatizim në këtë fazë)

- Përgjigjen e klientit («po, më pëlqen») e lexon stafi në bisedë; agjenti nuk e ndryshon porosinë vetë.
- Opsionale më vonë: te porosia shënohet «Dërguar për miratim» / «Miratuar», dhe ndryshimi dërgohet te webi (`POST …/orders/{id}/status`, kontratë e re).

## Testet

- **SQL** (baza lokale me të gjitha migrimet):
  - foto pa shënim pranohet, tekst bosh pa foto refuzohet;
  - URL jo `https` refuzohet;
  - e njëjta kërkesë nuk krijon dy punë;
  - mesazhi i ruajtur ka `media`.
- **Vitest:**
  - trupi i kërkesës për Instagram dhe WhatsApp;
  - pjesët dhe dëftesat (foto + shënim);
  - afati i mbyllur;
  - përgjigja e paqartë nuk ridërgohet;
  - rruga refuzon një URL që nuk është e porosisë.
- **Provë reale:** vetëm te biseda me @bora.mato24 te Zana Store, me një foto të përpunuar provë. Mesazhi në Instagram mbetet te klienti provë, sepse nuk fshihet dot nga API.

## Rreziqe

- Meta duhet ta shkarkojë URL-në menjëherë: një lidhje e skaduar ose një web i ngadaltë e bën dërgimin «të paqartë», dhe ai nuk riprovohet vetë.
- Instagram mund ta refuzojë një foto shumë të madhe (mbi 8 MB). Kufiri kontrollohet para dërgimit.
- Një aplikacion i vjetër nuk e njeh butonin; ai shtohet në një version të ri (0.3.16).
