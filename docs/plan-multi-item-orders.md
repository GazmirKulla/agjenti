# Multi-item orders (each item with its own choices): handoff plan

This plan is written to be executed by another agent without this conversation. It is self-contained: repos, current state, files, functions to reuse, contracts, tests and the release procedure.

## Context

Customers often order several things in one conversation, e.g. two T-shirts with a different color, theme and character, or a T-shirt plus a photo puzzle. Today every order in Agjenti has exactly one product:

| Path | Where | Limitation |
|---|---|---|
| Owner's "Krijo porosi" (web panel and mobile app) | `create_manual_order` RPC | One product (one `order_items` row) with one selection |
| Agent in the conversation | `submit_process_order` RPC | One product, quantity 1. A non-empty `cart` raises `unsupported_order_scope` |
| Sending to the business website | `begin_order_dispatch` RPC | Reads `order_items … limit 1` and builds `items[]` with one element |

Already in place:
- `order_items` holds many rows per order.
- The Zana store's order API (`createAgjentiOrder`) accepts `items[]` and validates each item on its own (variant, options, fields, photos). It compares `expectedTotal` with the sum of item totals.
- `conversation_states.cart jsonb` exists since `init`, but is only ever `[]`.

**Goal:** one order holds many lines. Each line has its own product, variant, choices, extras, fields, photos and quantity. Prices always come from the catalog, never from the client. The order is sent to the website exactly once, with all lines.

**Delivery in two phases:**
- **Phase 1:** owner's form (web and app) and dispatch.
- **Phase 2:** the agent builds a basket in the conversation.

Phase 1 is shippable alone. Phase 2 reuses its database functions.

## Repositories and current state (15.11.2026)

All three repos are clean on `main` and pushed:

| Repo | Path | Stack | Deploy |
|---|---|---|---|
| **agjenti** (web and server) | `/Users/gazmirkulla/Documents/projects/agjenti` | Next.js 15, Supabase, Vitest | Vercel on push to `main` |
| **agjenti-mobile** | `/Users/gazmirkulla/Documents/projects/agjenti-mobile` | Expo SDK 58, React Native 0.88 | Version in `app.config.ts`, last release **0.3.10** |
| **puzzle** (Zana store) | `/Users/gazmirkulla/Documents/projects/puzzle` | Next.js, Biome, Vitest | Push to `main` |

Notes for the agjenti repo:
- **Migrations are applied by hand** in Supabase, in filename order (README).
- Earlier docs said `20261115160000_linked_catalog_orders.sql` was "not applied". **Check in Supabase that it is applied before building on it.** The new migration depends on its functions (`check_order_selection`, `create_manual_order` with `p_selection`, `begin_order_dispatch`, `order-files` bucket, `products.external_spec`, `product_variants.external_id`).

Notes for agjenti-mobile:
- Read `AGENTS.md` first. Expo APIs change by SDK; check the versioned docs before touching Expo APIs.

Notes for puzzle:
- Format with `npx biome check --write`.

Background doc: `agjenti/docs/plan-porosite-zana.md` (Albanian). It covers the v2 website contract, what Zana's checkout requires, and what is open.

---

## Phase 1: "Krijo porosi" with several items

### 1.1 Database: new migration `agjenti/supabase/migrations/<timestamp>_manual_order_lines.sql`

Model it on `20261115160000_linked_catalog_orders.sql`: `begin; … notify pgrst, 'reload schema'; commit;`, `security definer set search_path=public,pg_temp`, `revoke … from public,anon,authenticated; grant … to service_role`.

1. **`alter table public.order_items add column if not exists selection jsonb;`**
   - Holds the line's raw selection with website ids: `{options, fields, files, addons}`.
   - Add a check: `selection is null or (jsonb_typeof(selection)='object' and octet_length(selection::text)<=8192)`.
   - Today the selection lives in `orders.payload.selection`, which only works for one line.

2. **`public.manual_order_line(p_business uuid, p_conversation uuid, p_index integer, p_line jsonb) returns jsonb`**
   - Extract, without changing behaviour, the per-line part of `create_manual_order` (see the last migration):
     - product active and not archived (`product_unavailable`);
     - variant active / `variant_required` / `variant_unavailable`;
     - `price_on_request` and `price_missing`;
     - `extra := check_order_selection(...)` (existing, reuse as is);
     - quantity rules: whole 1–999 when `price_unit is null`, else `order_unit_quantity_ok`;
     - the readable `chosen` options loop.
   - `p_line = {productId, variantId?, quantity, selection?}`.
   - Returns:

     ```json
     {"product_id":…, "variant_id":…, "product_name":…, "currency":…, "unit":…, "unit_amount":…, "extra_amount":…,
      "quantity":…, "line_total":…, "options":<variant.options || chosen || selection.fields>, "selection":…, "price_unit":…}
     ```
   - **Error codes carry the line number.** Catch and re-raise as `'<code>:' || p_index`, e.g. `selection_required:2`, so the UI can point at the item. Use `begin … exception when raise_exception then raise exception '%:%', sqlerrm, p_index; end`.

3. **`public.create_manual_order_lines(p_business, p_user, p_conversation, p_lines jsonb, p_customer jsonb, p_note text, p_request_key text) returns uuid`**
   - **Same preamble as `create_manual_order`:** membership check, request key 8–200, idempotency by `payload->>'requestKey'` (return the existing order id), customer name/phone checks, note ≤ 1000, conversation `for update`.
   - **Lines:** `p_lines` is an array of 1–10 lines (`invalid_lines` otherwise). Call `manual_order_line` for each.
   - **Totals:** all lines must share one currency (`mixed_currency`). `total := sum(line_total)`.
   - **Customer:** the same resolve/fill block as `create_manual_order`. Keep it identical: fill only missing fields, never overwrite.
   - **Insert one `orders` row**, `status='confirmed'`, with payload:

     ```json
     {"source":"manual","requestKey":…,"createdBy":…,"lines":[{product_id,product_name,variant_id,variant,quantity,unit,extra_amount,line_total}],
      "customer":{…},"note":…}
     ```
     Single-line orders also keep the legacy top-level keys (`product_id`, `product_name`, `variant_id`, `variant`, `quantity`, `unit`, `selection`, `extra_amount`), so existing readers (order list, own-orders) keep working. Grep for `payload->>'product_name'` / `payload.product_name` readers and make them use `lines` when present.
   - **Insert N `order_items` rows** with `selection`.

4. **Replace `create_manual_order(... p_variant, p_selection)`** (same signature, so `CREATE OR REPLACE`). It becomes a wrapper that calls `create_manual_order_lines` with one line. Error codes from a single line must keep their old names, without the `:1` suffix, so app 0.3.10 and the current `errors` map keep working.

5. **Change `begin_order_dispatch(p_business, p_user, p_order)`**
   - Loop over all `order_items` of the order, ordered by insertion. Add `order by` on a stable column. If none exists, add `position integer` to `order_items` in this migration and set it on insert.
   - **Per line:**
     - same checks as today (linked product, `external_spec` not null, variant `external_id`);
     - selection = `it.selection`, falling back to `o.payload->'selection'` for legacy single-line orders;
     - build options (variant option names → website value ids, plus chosen options), files and addons exactly like today.
   - **If any line cannot be sent**, return `local_only` for the whole order with `reason` and `line` (1-based). No partial dispatch.
   - **`items` holds all lines.** `expectedTotal = o.total_amount`. Keep the v1 compatibility keys per item (`formatId`, `colorId`, `character`).
   - The idempotency part (`order_submissions` row, single permission) stays unchanged.

`agjenti/src/lib/orders/dispatch.ts` → `signFiles` already iterates `payload.items`; no change needed. `finish_order_submission` is unchanged.

### 1.2 Server

- **`agjenti/src/lib/orders/manual.ts`**
  - Add `createManualOrderLines(input: { businessId, userId, conversationId, lines: ManualOrderLine[], customer, note, requestKey })`, calling RPC `create_manual_order_lines`.
  - Parse `code:n` errors into `"Artikulli n: <message>"` using the existing `errors` map. Add `invalid_lines` and `mixed_currency` messages (Albanian).
  - Keep `createManualOrder` as a thin wrapper.
- **`agjenti/src/app/api/businesses/[id]/conversations/[conversationId]/order/route.ts`**
  - Accept `{ lines: [{ productId, variantId?, quantity, selection? }], customer, note, requestKey }`, at most 10 lines.
  - Also accept the old body `{ productId, variantId, quantity, selection, ... }` as one line. App 0.3.10 sends this.
  - Reuse `readSelection` per line. `dispatchManualOrder` is unchanged.
  - Response unchanged: `{ ok, orderId, submission }`.
- **`.../products/route.ts`**: no change. It already returns `declared`, `sendsToWebsite`, `image`, `variants` (with `externalId`).
- **Order displays:** check where an order's product is shown and render all `order_items`/`payload.lines`:
  - inbox order chips, `src/lib/conversations/inbox-read.ts` (`CustomerOrder`);
  - `src/lib/orders/own-orders.ts`;
  - the Porositë (orders) page;
  - mobile `context.orders`.

### 1.3 Web form: `agjenti/src/components/dashboard/conversation-panel-controls.tsx`

Today `ManualOrderForm` has one product, a variant `<select>`, `DeclaredInputs` (choices, extras, fields, photos incl. "pick from conversation photos") and a quantity.

- **Extract `OrderLineEditor`:** `{ base, line, onChange, onRemove?, index }` containing search, product select, variant, `DeclaredInputs` and quantity. The line state is `{ key, productId, chosenName, variantId, quantity, selection }`. Each line has its own product search state and its own `useChatPhotos` (or lift `useChatPhotos` to the form and pass the photos down, so the list loads once).
- **`ManualOrderForm`:**
  - holds `lines[]`, with "Shto artikull" (add, max 10) and "Hiq" (remove, min 1);
  - shows a total per line (base or variant price + extras) × quantity, and the order total;
  - customer, address and note stay once.
- **Confirmation text:**
  - all lines `sendsToWebsite` → "Ruaj porosinë me N artikuj? Ruhet te Porositë dhe krijohet një herë te webi i biznesit.";
  - otherwise the local-only text, adding that items not linked to the website keep the whole order local.
- **Prefill** (`useApplyPrefill`) fills line 1.
- **Send** `lines`, reset to one empty line on success, and keep `submissionMessage` (existing).
- Add new strings to `src/lib/dashboard/language/messages.ts`.

### 1.4 Mobile form: `agjenti-mobile/src/components/conversation-forms.tsx`

The same structure:
- `OrderLine` component built from the current `OrderForm` product block: product card with image, `Stepper`/measure input, variants via `Choice`, and `DeclaredInputs` with gallery upload and conversation photos.
- "Shto artikull", "Hiq artikullin", and the overall total.
- Validation before sending: run the existing `missingDeclared` and `readySelection` per line, and show "Artikulli n: Plotëso …" on error.
- Send `{ lines, customer, note, requestKey }`. Keep `submissionMessage`.
- Add English strings to `src/messages/inbox.ts`.
- Bump `app.config.ts` version to **0.3.11**.

### 1.5 Zana store (`puzzle`)

No code change: `createAgjentiOrder` already handles `items[]`. Add one test in `src/lib/integrations/agjenti-orders.test.ts` with a v2 order of two items (T-shirt with color and theme, puzzle with photo URL). Assert:
- both lines reach `mapOrderItems` with their own fields;
- `expectedTotal` must equal the sum;
- a missing required photo on item 2 is rejected.

---

## Phase 2: the agent builds a basket in the conversation

Phase 2 is built after Phase 1 ships. It reuses `manual_order_line` / `create_manual_order_lines`-style validation server side.

### How the agent works today (read these first)

Files are in `agjenti/src/lib/orchestration/`.

- **Process model:** `contracts.ts`. A `Snapshot` holds `instances` (one running process each), `offers` and `focusId`. Customer commands are `start`, `facts`, `approve`, `decline`, `cancel`, …. `transition.ts` applies them: `start()` creates a new instance; nothing prevents two instances of the same definition.
- **An order process is one product:**
  - `order-definition.ts` → `finishOrder()` appends to each order flow: a condition on the productId fact, then collect steps for customer fields, then a `confirm` review, then an `effect` step with tool `order.create` (inputs from `orderInputNames`: productId, productName, productTypeId, unitAmount, currency, quantity, options, name, phone, city, address).
  - `order-context.ts` → `serverFacts()` fills the price terms and `options` (all collected non-customer facts, as a JSON string) from the catalog.
  - `composeVariantChoices` and `composeOrderQuantity` add per-product steps.
  - `product-composition.ts` composes the product's own workflow (e.g. `collect_size`, `collect_color`, `collect_theme`, photo).
- **`order.ts` → `orderAdapter`:** re-reads terms (`readOrderTerms`), compares digests (`commercial_terms_changed`), then calls `submit_process_order`.
- **`submit_process_order`** (latest definition in `supabase/migrations/20261114200000_order_unit_quantities.sql`):
  - one product, `cart` must be empty;
  - for automated agents it either records a staff review (`process_order_reviews`, status `awaiting_staff`) or creates a `local_only` order;
  - staff submission (`src/lib/orders/submission.ts` → `submitConfirmedOrder`) returns a **v1** website payload (`formatId` from `collect_size`, `colorId` from `collect_color`, `character` from `collect_theme`).
- **Understanding:** `src/lib/conversations/understanding/contract.ts` (JSON schema of what the model returns) and `observation.ts` (validates commands; each needs evidence quoted from the customer's message).

### Design

**1. A basket in the snapshot.**
- Add `basket?: BasketLine[]` to `Snapshot`, with:

  ```ts
  type BasketLine = {
    id: string; instanceId: string; productId: string; productName: string; variantId: string | null;
    quantity: number; unitAmount: number; currency: string; options: Record<string, Value>; selection?: Selection;
  }
  ```
- Persist it in `conversation_states.cart` alongside `collected`, written by the same RPC that writes the snapshot, so the database can check it.
- Max 10 lines and one currency.

**2. Split the order flow into "item" and "checkout".**
- **In `finishOrder()`**, for non-collection flows, replace "collect customer → confirm → order.create" with a new step kind **`basket_add`**:
  - it runs after the product part is complete (all product, variant, quantity and workflow fields present);
  - it computes the line from `serverFacts` and appends it to `snapshot.basket`;
  - it ends the instance as `completed` with label "Item added to the basket";
  - it emits a notice `{ kind: "basket", text: "added" }`, so the reply asks "Dëshironi të shtoni diçka tjetër, apo ta mbyllim porosinë?".
- **A built-in checkout definition** (system process, not authored, in a new `src/lib/orchestration/checkout-definition.ts`):
  - collects the customer fields: reuse `orderFields(...).customer` and the profile memory (`applyProfileMemory`);
  - shows one `confirm` step that reviews all basket lines and the total;
  - calls an `effect` step `order.create` **version 2** with input `{ lines: JSON(basket), name, phone, city, address }`.
- **New customer commands** in `CustomerCommand`, the understanding contract, and `observation.ts` validation:
  - `{ kind: "checkout", evidence }` starts the checkout instance (only when the basket is non-empty);
  - `{ kind: "remove_line", lineId, evidence }`;
  - `{ kind: "edit_line", lineId, evidence }` reopens that item's instance (status back to `running` at its first product step; the line is removed from the basket until it is added again).
  - "Add another item" needs no new command: it is the existing `start` / `accept_offer` of an order flow.
- **Reply guidance:** wherever notices are turned into reply guidance (grep `RuntimeNotice` consumers in `src/lib/conversations/`), describe the basket state (lines and total) whenever it is non-empty, so the agent never forgets earlier items.

**3. Tool `order.create` v2** (`order.ts`, `orderToolPolicy()`):
- Re-read terms for every line (`readOrderTerms` with each line's options and quantity) and compare digests per line (`commercial_terms_changed:n`).
- Call a new RPC `submit_process_order_lines(p_business, p_conversation, p_revision, p_action, p_user, p_job, p_token)`:
  - reads the lines from the persisted snapshot (never from the action input alone);
  - validates each line with `manual_order_line`;
  - keeps the lease and revision checks and the review / automation-policy branch of `submit_process_order`;
  - inserts one order with N `order_items` (with `selection`).
- Remove the `unsupported_order_scope` cart check for this path.
- Keep `order.create` v1 and `submit_process_order` for versions compiled before the change: existing `process_versions` are immutable snapshots.

**4. Choices v2 for linked products.**
- When the product has `external_spec`, compose its item steps from the declaration instead of the hand-written `collect_*` steps. Add `composeDeclaredChoices(definition, spec)` next to `composeVariantChoices`, mapping:
  - `options` → choice steps;
  - `fields` → collect steps by type;
  - `photo` → a photo step.
- The photo step uses the photos the customer sent. Reuse `src/lib/orders/conversation-photos.ts` (`listCustomerPhotos` / `readCustomerPhoto` copy into `order-files`).
- Store the result in the line's `selection` with website ids, so `begin_order_dispatch` can send it.

**5. Staff path.**
- The `process_order_reviews` UI and `submitConfirmedOrder` show all lines.
- After staff approval, send through the same dispatch as Phase 1 (`begin_order_dispatch`-style with `items[]`, v2) instead of the v1 payload. This also closes "Rruga e agjentit dërgon ende v1" in `docs/plan-porosite-zana.md`.

**6. Rollout.**
- Gate with a per-business setting `multi_item_orders boolean default false`: a column on `businesses` or `business_automation_policies`.
- When off, `finishOrder()` keeps today's single-product flow. Turn it on for Zana first.

### Phase 2 risks to resolve in its own design pass

- **Step kinds:** `basket_add` and the checkout definition must fit the step engine (`advance()` in `transition.ts`, the `confirm`/`effect` cases) and `validateDefinition`'s limits (64 fields, 128 steps).
- **Mid-conversation upgrade:** an instance already running under an old version must finish under that version.
- **Two items of the same product:** two instances of one definition must not share facts. `clearVariants` already clears variant facts on a product change; verify that the instances are independent.

---

## Verification

### Phase 1

- **Database:** run the migration against a local PostgreSQL with the minimal schema used for `20261115160000_linked_catalog_orders.sql`. Cases:
  - 2 valid lines create one order with 2 `order_items` and the summed total;
  - line 2 missing a required photo raises `selection_required:2` with no rows written;
  - mixed currency is rejected;
  - the same `requestKey` returns the same order;
  - the `create_manual_order` wrapper still works and keeps the old error names;
  - `begin_order_dispatch` with 2 linked lines returns 2 `items` and `expectedTotal` = total;
  - one unlinked line returns `local_only` with `line`;
  - a legacy single-line order (selection in payload) still dispatches.
- **agjenti (Vitest):** the route accepts the new and old body, and line errors become "Artikulli n: …". Run `npx vitest run`, `npx tsc --noEmit` and `npx eslint` on touched files. The pre-existing `fflate` / `.next` type errors are unrelated.
- **puzzle:** the new two-item test, plus `npx vitest run src/lib/integrations`, `npx tsc --noEmit` and `npx biome check src/lib/integrations`.
- **Mobile:** `npx tsc --noEmit`, `npx expo lint` (one known old warning in `assistant.tsx`) and `npm test`.
- **End to end before pushing:**
  - Agjenti locally in the browser: in a test conversation, create an order with two Zana linked products and check that the Zana order has two lines with the right choices;
  - the iOS Simulator with the same scenario;
  - an old-body request (as app 0.3.10 sends) still creates a one-product order.

### Phase 2

- `transition.test.ts`-style unit tests: add two items, remove one, edit one, checkout, a price change on line 2, and two instances of the same product.
- One end-to-end conversation in test mode (`mode: "test"`, simulated effects) before enabling the setting for Zana.

## Release order (each phase)

1. Apply the new migration in Supabase.
2. Push agjenti to `main` (Vercel deploys).
3. Push puzzle if it changed.
4. Release mobile:

   ```bash
   cd /Users/gazmirkulla/Documents/projects/agjenti-mobile
   ```

   ```bash
   npx eas-cli@latest build --local --platform android --profile production --non-interactive --output <dir>/agjenti-<v>.aab
   ```

   ```bash
   npx eas-cli@latest build --local --platform ios --profile production --non-interactive --output <dir>/agjenti-<v>.ipa
   ```

   ```bash
   npx eas-cli@latest submit --platform ios --profile production --path <ipa> --non-interactive
   ```

   ```bash
   npx eas-cli@latest submit --platform android --profile store-release --path <aab> --non-interactive
   ```

   - The iOS submit goes to TestFlight; the Android submit goes to the production track.
   - Build numbers auto-increment remotely (`appVersionSource: remote`).
5. On agjenti.app, run "Rifresko nga webi" for Zana if the store catalog changed.

Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
