/** English counterpart of the existing website integration instructions. */
export const developerPromptEn = `Implement the website connection to Agjenti.app in this repository.

Goal
Agjenti reads the website catalog and can submit orders to the existing system. Inspect the stack, routes, product/variant models, authorization and order service before making changes. Reuse existing logic and storage; preserve website functionality. Do not create demonstration products or orders in production.

1. Server authorization
Use a secret stored in server configuration as AGJENTI_APP_SECRET. Enter the same secret in Integrations → Business website in Agjenti; the minimum length is 16 characters. Preserve any existing secret. Never include it in source code, the browser, logs, responses or the final report. Document only the variable name and how to configure it.
Each endpoint must verify Authorization: Bearer <secret>. Return HTTP 401 for missing or incorrect credentials; reject requests if the server has no secret configured. In a multi-business system, restrict catalog and orders to the business represented by the secret.
Return JSON, use HTTPS in production and complete requests within 20 seconds. This is server-to-server communication.

2. Catalog — GET /api/integrations/agjenti/catalog
You may use a different route if project conventions require it; provide the complete final URL.
Return HTTP 200 with a products array, including when empty: {"products":[]}.
Each product has string id and name fields. Product and variant IDs must be stable and match those accepted by the orders endpoint.
productType: string or null; price: number or null; currency: optional string (e.g. ALL or EUR). Adapt and document price units from the existing model; do not silently change currency or price scale.
formats is an optional array of {id: string, name: string, price: number | null}; colors is an optional array of {id: string, name: string}. Do not invent variants.
Illustrative response:
{"products":[{"id":"product-1","name":"Example product","productType":"type-1","price":1500,"currency":"ALL","formats":[{"id":"format-1","name":"Standard","price":1500}],"colors":[{"id":"color-1","name":"White"}]}]}

3. Orders — POST /api/integrations/agjenti/orders (optional)
Implement this when the website has a real order system. Otherwise deliver the working catalog and explain the gap; do not create a new order system without clarifying scope.
Accept Content-Type: application/json and the same Bearer authorization. The existing Agjenti flow for sending orders from Instagram conversations uses:
{"channel":"instagram","customer":{"name":"Example customer","phone":"+355…","city":"Tirana","address":"Example address"},"items":[{"productId":"product-1","productType":"type-1","formatId":"format-1","colorId":"color-1","quantity":1,"character":null}]}
Variant fields and character may be null; customer.city may be omitted or null. Validate names, phone numbers, addresses, products, quantities and variant ownership on the server. Calculate prices and check availability using the existing website logic. Do not mark payment as completed merely because this request arrived.
Create the order through the existing service and return success only after confirmed persistence: HTTP 2xx with {"ok":true,"orderId":"real-id","orderNumber":123}. orderId is an optional string, orderNumber an optional number. On failure return an appropriate HTTP status and {"ok":false,"error":"Safe error description"}.
The current contract sends no idempotency key or unique request ID. Do not require new fields that Agjenti does not send; report the limitation for repeated submissions.

4. Verification and delivery
Test missing/incorrect authorization, missing server secret, an empty catalog and a catalog with real test products. If implementing orders, test invalid payloads, unknown products/variants, persistence failure and valid orders in a test environment. Do not place real test orders without authorization.
Summarize changes, tests, required configuration/migrations and outstanding deployment work. Distinguish local code from deployed endpoints; do not claim successful integration without evidence.
Provide the full HTTPS catalog URL and orders URL if implemented. If the domain is unknown, use a clear placeholder and ask for the domain for the final URL. Do not disclose the secret in the report.
Instruct the owner to enter the URLs and secret in Agjenti → Integrations → Business website, test the connection, save configuration, and link products from Products. Agjenti's test checks only the catalog; it does not save configuration or verify/submit orders.
`;
