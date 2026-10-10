# agjenti.app — Repository-adapted Assistant-First Redesign

## Objective and scope

Evolve the existing client dashboard around the existing business-management Agjenti. Preserve dedicated management pages, working APIs, authorization, module configuration, manual workflows and business data. Do not redesign the platform administrator interface except where a narrowly required configuration control is explicitly identified.

This is an incremental UI and context integration project. New operational capabilities are separate backend work, not implied by a visual redesign.

Before implementation, verify this baseline against the current checkout and present a file-level plan. This document reflects a source inspection on 10 October 2026; deployment and database migration state must be checked separately.

## Existing implementation to reuse

- `src/components/dashboard/shell.tsx`: shared shell, business switcher, desktop assistant trigger, central animated robot in mobile navigation. Preserve the business name in the identity: `Agjenti “Emri biznesit”`. The mobile footer trigger remains an animated robot without a visible name, with an accessible label and reduced-motion support.
- `src/components/business-assistant/panel.tsx`: existing text/audio interaction, in-memory history, clarification, proposal preview and explicit confirmation. Currently a modal dialog; desktop side panel and expandable mobile drawer are new presentation work.
- `src/app/api/business-assistant/route.ts` and `src/lib/business-assistant/{model,service}.ts`: existing planner and execution boundary. Reuse their validation, tenant checks, enabled-module checks, external-catalog restrictions, signed/encrypted confirmation tickets, expiry, concurrent-update checks and booking availability checks.
- `src/app/b/[slug]/page.tsx` and `src/components/dashboard/overview.tsx`: business overview and existing statistics. Overview is also used for the platform administrator; do not accidentally change administrator behavior.
- `src/lib/dashboard/navigation/builder.ts`, module registry, profile and widget resolvers: navigation and available modules depend on the business profile. Do not replace these with a fixed product-centric menu.
- `src/components/business-intelligence/panel.tsx` and its existing APIs: a separate analysis/import interface remains in some sections. Its website/Instagram scanning and draft-review functionality is not fully replaced by the business assistant. Migrate entry points only after their replacements work; retain the services underneath.
- `src/components/onboarding/conversation.tsx`, `src/lib/onboarding/conversation.ts`, `src/app/api/onboarding/conversation/route.ts`, existing analysis routes and `src/lib/onboarding/actions.ts`: conversational onboarding already exists. Reuse its extraction, field validation, draft saving, review and workspace creation.
- `src/lib/platform/settings.ts`, `src/app/admin/app/page.tsx`: preserve `onboarding_enabled`, `onboarding_mode` (`guided` or `agent`) and `onboarding_steps`. Verify migration `20261010120000_conversational_onboarding.sql` before depending on the mode setting.
- Existing theme tokens, form controls, `AudioRecorder`, `TalkingRobot` and preview components should be reused or extracted into shared components.

## Capability boundaries

The current business assistant supports one proposed operation at a time:

- Create or update products and services; creations are inactive drafts.
- Create or update knowledge.
- Update the business name; this is not arbitrary business-settings editing.
- Update instructions of an existing customer-facing agent.
- Check appointment availability and create or update bookings.
- Perform internal bounded searches for products, services, knowledge, bookings and agents, and ask for clarification.

Do not advertise order lookup/status changes, Inbox search/summaries, WhatsApp connection, bulk price updates, publishing, deletion, full-catalog analytics or automatic integration setup as working assistant actions. These are not current assistant tools. An existing management page does not imply an assistant capability.

Instagram and Google Calendar have existing connection flows. A conversational entry may guide the user into an existing authorized flow, but must not claim the connection succeeded before the existing backend confirms it. No WhatsApp connection implementation was found during this inspection.

“Import products” and “Analyze business” may open or integrate existing import/analysis flows. Do not present them as existing business-assistant operations until that integration is implemented and verified. Preserve CSV/manual import paths and existing scan review behavior.

## Shared assistant and context architecture

1. Extract one shared dashboard assistant state/controller at the business layout boundary. Home, contextual entry points and the mobile robot must use that controller and the same conversation, not mount independent chats.
2. Separate state and actions from presentation: inline Home workspace, mobile drawer/full screen and desktop side panel are views of the same dashboard session.
3. Add optional, validated UI context to the existing plan request. Keep existing callers and confirmation contracts compatible.
4. Context may include page, entity type/ID, selection, whitelisted filters, search text and entry point. Infer canonical business identity from the authenticated slug/access check on the server. Never use a client business ID as authorization.
5. Validate entity ownership and enabled capabilities on the server. Load the explicitly selected entity even when it is outside the planner's initial bounded context. Ambiguous, absent or unauthorized targets must not fall back to an unrelated record.
6. Capture context at submission. Keep the proposal bound to the original entity and show its name in the preview. Navigation must not retarget an existing proposal. A new message can use the new page context.
7. On business switch, isolate or clear session state, drafts and pending confirmations. Discard late responses from the previous business. Never reuse a ticket across users or businesses.
8. Replace broad context loading incrementally with targeted reads plus existing bounded search; do not send entire page datasets or claim partial results are complete analyses.

Onboarding is a different authorization stage: a user may not yet own a business. Use a discriminated onboarding/dashboard scope, not a fabricated business ID. Share visual primitives and interaction conventions, but preserve the dedicated onboarding endpoints and creation boundary.

## Conversation continuity

Current assistant history is component state, limited to recent turns and cleared after a confirmed action. It is not a durable activity log.

- Preserve conversation and completed result cards across opening/closing and same-business navigation.
- Model each request, proposal and result explicitly rather than replacing every result with one global result slot.
- Define and test reload persistence separately. If durable conversation/activity history is required, add explicit server persistence with user/business ownership, bounded retention and validation; do not claim it already exists.
- Never automatically execute restored pending actions. Expired proposals require a fresh preview and confirmation.
- Onboarding currently resumes saved answers and skipped optional questions; its rendered message transcript is not persisted. Distinguish profile progress from transcript continuity.

## Home and contextual entry points

Make the business Home assistant-led, with a compact retained overview using existing statistics and widget rules. Reuse the existing business switcher and account controls. Notifications and “recent assistant activities” require real data sources; do not add invented counters or activity.

When a Home conversation expands, preserve the same session and allow returning to the overview.

Contextual suggestions must derive from supported actions intersected with enabled modules and data restrictions. Examples: create a product draft, edit the selected product, add a knowledge entry, edit agent instructions, check appointment availability.

For unsupported Orders/Inbox conversational operations, keep the working management interface and defer assistant suggestions until the necessary tools exist. Do not add decorative inputs that promise unavailable actions.

## Responsive presentation and branding

- Mobile: bottom drawer around 70% of the available viewport, expandable to full screen; handle the software keyboard, safe areas, scrolling and a reachable composer.
- Desktop: resizable nonmodal side panel where width permits; the current page remains usable. A CSS restyle of `showModal()` is insufficient because it keeps the page inert.
- Preserve page filters, selection and scroll state. Avoid remounting the management page when the assistant opens.
- Keep existing light/dark/system theme behavior and purple accents. Do not force dark mode or globally recolor onboarding.
- Preserve dynamic mobile navigation, including service-oriented businesses without Products. Keep a single central robot assistant entry, without competing floating buttons.
- Implement appropriate focus behavior, Escape/close handling, accessible controls, keyboard resizing or an equivalent accessible size control, and reduced motion.

## Onboarding integration

Extend the existing conversational onboarding; do not build another wizard or force agent mode for all users.

Preserve name/category/offer/goal extraction, explicit corrections, business-specific questions, low-confidence clarification, optional skipping and confirmation. Keep all three administrator-controlled states: onboarding disabled, guided onboarding, agent onboarding.

Separate these stages:

1. Before workspace creation: collect and review the profile through the existing onboarding boundary.
2. After authenticated workspace creation: optionally continue supported scanning/import, integrations and testing through their existing services.

The current onboarding saves a profile and initial instructions. Mentioned offerings are summaries, not automatically created catalog products/services. Do not silently turn them into records. Reuse verified import/create flows with their own review and confirmation.

Do not require OAuth connections or external scans to create a workspace. Handle cancellation, failures and resume without creating duplicate businesses or imported records. Check existing analysis quotas and timeouts before adding more automatic turns.

## Writes and rich responses

Preserve the current explicit confirmation for every assistant write; do not weaken it to only “meaningful” changes.

Request → Preview → User confirmation → Existing executor → Verified result.

Keep the server-authoritative target, before/after values, expiry and concurrency validation. Refresh affected data after success. Failed actions retain the user's input and recoverable state. Do not replay writes automatically.

Add typed result renderers incrementally for the responses that actually exist: clarifications, proposal previews, availability, saved results and errors. New product cards, search lists, import progress or integration statuses require explicit supported response contracts.

## Implementation order and verification

1. Audit baseline, deployment prerequisites and capability inventory; record regression checks.
2. Extract shared dashboard state and introduce backward-compatible server-validated context.
3. Verify selected-entity targeting, stale responses, business switching and proposal confirmation before expanding UI usage.
4. Add mobile drawer/desktop side panel and connect existing entry points to them.
5. Add Home workspace while retaining compact profile-aware overview.
6. Add contextual entries only for supported capabilities.
7. Incrementally adapt existing analysis/import entry points and onboarding presentation; preserve admin mode selection and pre/post-workspace boundaries.
8. Add separately scoped persistence or new action tools only when needed and tested.

Test selected products outside initial context limits; duplicate names; unauthorized IDs; external catalogs; hidden modules; page navigation with a pending proposal; business switching during requests; expired tickets; concurrent edits; closed/reopened panels; failed writes; booking collisions; onboarding resume and all administrator modes; canceled OAuth/import; mobile keyboard and accessibility; both themes; unchanged platform-admin overview.

Deliver incremental changes with clear evidence. Do not delete existing interfaces until their replacements provide verified feature coverage. Report any capability or migration that remains unavailable rather than marking the entire redesign operational.
