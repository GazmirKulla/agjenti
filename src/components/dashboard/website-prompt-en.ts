/** English counterpart of the existing website integration instructions (contract version 2). */
export const developerPromptEn = `Implement the website connection to Agjenti.app in this repository (contract version 2).

Goal
Agjenti reads the website catalog and, when the owner confirms it in a conversation, creates the order in the website's existing system. The catalog must describe not only products and prices but also what has to be chosen and collected for an order to be valid, so Agjenti collects it before sending.
Inspect the stack, routes, product/variant/price/extra models, the order validation rules (checkout), authorization and the order service before making changes. Reuse existing logic and storage; preserve website functionality. Do not build a parallel order system and do not create demonstration products or orders in production.

1. Server authorization
Use a secret stored in server configuration as AGJENTI_APP_SECRET. Enter the same secret in Integrations → Business website in Agjenti; the minimum length is 16 characters. Preserve any existing secret. Never include it in source code, the browser, logs, responses or the final report. Document only the variable name and how to configure it.
Each endpoint must verify Authorization: Bearer <secret>. Return HTTP 401 for missing or incorrect credentials; reject requests if the server has no secret configured. In a multi-business system, restrict catalog and orders to the business represented by the secret.
Return JSON, use HTTPS in production and complete requests within 20 seconds. This is server-to-server communication.

2. Catalog — GET /api/integrations/agjenti/catalog
You may use a different route if project conventions require it; provide the complete final URL.
Return HTTP 200 with {"version":2,"currency":"ALL","orderFields":[],"products":[]}; products is an array even when empty.
Each product has:
- string id and name; product, variant, option value and extra IDs are stable and are the ones the orders endpoint accepts.
- productType (string or null); priceMode: "fixed" | "from" | "range" | "request"; price and priceMax (number or null); priceUnit (e.g. "m²", or null); currency.
- options: [{key, label, affectsPrice, values: [{id, name}]}] — the customer's choices (size, format, color, material).
- variants: [{id, options: {key: valueId}, sku, price, active}] — each combination with its own price or code.
- addons: [{id, name, price, appliesToVariants}] — optional priced extras.
- fields: [{key, label, type, appliesTo, required, requiredWhen, min, max, maxLength}] — data the order requires for the item. type is one of text, number, boolean, date, choice (with values), photo, file.
orderFields uses the same shape for data about the whole order (e.g. email, delivery method), apart from the name, phone and address that Agjenti always sends.
Declare only what the website really has and requires. Every rule the website's checkout enforces (size, color, photo, personalization text, email, delivery) must appear as an option or a field with required: true, with requiredWhen for conditional cases (e.g. {"variant":["format-2"]}). Do not offer options that do not apply to the product, such as colors for a product without colors. Read prices from the live source with no stored fallback; do not silently change currency or units and do not invent variants.
For compatibility, keep the version 1 fields where they exist: formats [{id, name, price}] and colors [{id, name}].
Illustrative response:
{"version":2,"currency":"ALL","orderFields":[{"key":"email","label":"Email","type":"text","appliesTo":"order","required":false}],"products":[{"id":"product-1","name":"Example product","productType":"type-1","priceMode":"from","price":1200,"priceMax":null,"priceUnit":null,"currency":"ALL","options":[{"key":"size","label":"Size","affectsPrice":true,"values":[{"id":"format-1","name":"Standard"},{"id":"format-2","name":"Large"}]},{"key":"color","label":"Color","affectsPrice":false,"values":[{"id":"color-1","name":"White"}]}],"variants":[{"id":"format-1","options":{"size":"format-1"},"sku":null,"price":1200,"active":true},{"id":"format-2","options":{"size":"format-2"},"sku":null,"price":1500,"active":true}],"addons":[{"id":"extra-1","name":"Gift wrap","price":300,"appliesToVariants":["format-2"]}],"fields":[{"key":"personalization","label":"Text on the product","type":"text","appliesTo":"item","required":true,"maxLength":40},{"key":"photo","label":"Reference photo","type":"photo","appliesTo":"item","required":false,"max":3}],"formats":[{"id":"format-1","name":"Standard","price":1200},{"id":"format-2","name":"Large","price":1500}],"colors":[{"id":"color-1","name":"White"}]}]}

3. Orders — POST /api/integrations/agjenti/orders (optional)
Implement this when the website has a real order system. Otherwise deliver the working catalog and explain the gap; do not create a new order system without clarifying scope.
Accept Content-Type: application/json and the same Bearer authorization. Accept both shapes:
- Version 1, still sent for orders staff confirm after the agent: formatId and colorId are the formats/colors IDs; character may be null; customer.city may be omitted.
{"channel":"instagram","customer":{"name":"Example customer","phone":"+355…","city":"Tirana","address":"Example address"},"items":[{"productId":"product-1","productType":"type-1","formatId":"format-1","colorId":"color-1","quantity":1,"character":null}]}
- Version 2 ("version": 2), sent when the owner creates the order in a conversation ("Create order"), with the variant, choices, extras, fields and files declared in the catalog. For compatibility it also carries formatId, colorId and character:
{"version":2,"channel":"instagram","source":"owner_manual","customer":{"name":"Example customer","phone":"+355…","city":"Tirana","address":"Example address"},"fields":{"email":null},"note":null,"currency":"ALL","expectedTotal":1200,"items":[{"productId":"product-1","variantId":"format-1","options":{"size":"format-1","color":"color-1"},"addons":[],"fields":{"personalization":"Ana"},"files":[{"key":"photo","url":"https://…","contentType":"image/jpeg"}],"quantity":1,"unitAmount":1200}]}
Validate on the server with the existing checkout logic: the product, ownership of the variant, options and extras, required fields, quantity and files. Download files from their URL right away (the URLs expire) and store them in the website's storage. Recalculate price, shipping and availability; do not mark payment as completed merely because this request arrived.
expectedTotal is the items total (variant price plus extras, times quantity) without shipping. If that recalculated sum differs from expectedTotal, do not create the order: return HTTP 409 with {"ok":false,"error":"price_changed","total":1300}.
Idempotency: Agjenti sends the X-Agjenti-Submission-Id header, unique per order. Store it with a unique index; for the same ID return the same response and never create a second order.
Return success only after confirmed persistence: HTTP 2xx with {"ok":true,"orderId":"real-id","orderNumber":123}. orderId is an optional string, orderNumber an optional number. On failure return the matching status (400 invalid data, 409 conflict, 5xx temporary error) and {"ok":false,"error":"safe_code","field":"field key when relevant"}.
Optional: POST /api/integrations/agjenti/orders/quote with the same body returns {"ok":true,"total":1500,"shipping":300,"lines":[...]} without creating an order.

4. Verification and delivery
Test missing/incorrect authorization, missing server secret, an empty catalog and a catalog with real test products. If implementing orders, test v1 and v2 payloads, each missing required field, unknown variants/options/extras, an option that does not apply to the product, an invalid file, a changed price, a repeat with the same X-Agjenti-Submission-Id and a persistence failure. Do not place real test orders without authorization.
Summarize changes, tests, required configuration/migrations and outstanding deployment work. Distinguish local code from deployed endpoints; do not claim successful integration without evidence.
Provide the full HTTPS catalog URL and orders URL if implemented. If the domain is unknown, use a clear placeholder and ask for the domain for the final URL. Do not disclose the secret in the report.
Instruct the owner to enter the URLs and secret in Agjenti → Integrations → Business website, test the connection, save configuration, and link products from Products. Agjenti's test checks only the catalog; it does not save configuration or verify/submit orders.
`;
