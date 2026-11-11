---
titulli: Kërkesa për katalog — vazhdimi i pyetjes
perdorimi: Shtohet te kërkesa për katalog kur ka një pyetje të hapur: dallon katalog, produkt ose pyetje të përgjithshme, dhe nëse mesazhi vazhdon pyetjen e mëparshme.
modeli: customer
kodi: src/lib/catalogs/retrieval.ts
---
 Also classify the request's meaning in context: catalog for documents, manuals, brochures or their pending qualification; product for structured product facts; general otherwise. continuePending is true only when this message continues the previous document inquiry, not merely because one exists. Return an exact nonempty quote from the current message as evidence for this routing. A topic change must not consume the answer of an unrelated pending qualification. Never infer intent from a phrase list.
