import { emptyState, foldText, type ConversationStatePayload, type WorkflowStepDef } from "./engine";
export const profileKeys = ["name", "phone", "email", "city", "address"] as const;
export type ProfileKey = typeof profileKeys[number];
export type FieldType = "text" | "phone" | "email" | "number" | "photo";
export type Fact = {
    value: string;
    type: FieldType;
    source: string;
    validated: true;
};
/** Commercial scope currently supported by final submission: one catalog item, quantity one. */
export type OrderTerms = { productId: string; unitAmount: number; currency: string; quantity: 1 };
export type SharedContext = {
    profile: Partial<Record<ProfileKey, Fact>>;
    order: Record<string, Fact>;
    execution: {
        /** context.order is the current adapter's facts; other tasks live in processes. */
        factOwner?: "order" | "booking" | "service" | "auxiliary";
        orderTerms?: OrderTerms;
        orderReview?: { id?: string; factsKey: string; fieldKeys: string[]; expiresAt: number; confirmed: boolean };
        profileConfirmation?: "pending" | "confirmed";
        orderConfirmed?: boolean;
        awaitingOrderConfirmation?: boolean;
        linear?: {
            id: string;
            versionId: string;
            name: string;
            steps: WorkflowStepDef[];
        };
        skipped?: string[];
        validationFailures?: number;
        invalidFields?: string[];
        promptCounts?: Record<string, number>;
    };
};
export function sharedWorkflowEnabled(businessId: string) {
    return (process.env.SHARED_WORKFLOW_BUSINESS_IDS ?? "").split(",").map(s => s.trim()).includes(businessId);
}
export function profileKey(key: string): ProfileKey | null {
    return key.startsWith("customer_") && profileKeys.includes(key.slice(9) as ProfileKey) ? key.slice(9) as ProfileKey : null;
}
export function safeFieldKey(key: string) {
    return /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(key) && !["constructor", "prototype", "__proto__"].includes(key);
}
export function validValue(value: string, type: FieldType) {
    if (!value.trim() || value.length > 2000)
        return false;
    if (type === "phone")
        return /^\+?[\d\s().-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 7;
    if (type === "email")
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (type === "number")
        return /^\d+(?:[.,]\d+)?$/.test(value);
    if (type === "photo")
        return value === "photo_received";
    return true;
}
export function migrateContext(input?: ConversationStatePayload | null): ConversationStatePayload {
    const state = structuredClone(input ?? emptyState());
    state.fields ??= {};
    state.customer ??= emptyState().customer;
    if (!state.context) {
        state.context = { profile: {}, order: {}, execution: {} };
        for (const key of profileKeys) {
            const value = state.customer[key as keyof typeof state.customer];
            if (value)
                setFact(state, `customer_${key}`, value, key === "phone" ? "phone" : key === "email" ? "email" : "text", "legacy_customer");
        }
        // Preserve custom fields as order data. Never guess that a custom key is a profile field.
        for (const [key, value] of Object.entries(state.fields)) {
            if (typeof value === "string" && safeFieldKey(key) && !profileKey(key))
                setFact(state, key, value, "text", "legacy_order");
        }
    }
    state.context.profile ??= {};
    state.context.order ??= {};
    state.context.execution ??= {};
    if (state.linearSnapshot && !state.orderWorkflowSnapshot && !state.context.execution.linear)
        state.context.execution.linear = state.linearSnapshot;
    projectProfile(state);
    state.schemaVersion = state.schemaVersion === 3 ? 3 : 2;
    return state;
}
/** Legacy customer fields are projections once a shared context exists. */
export function projectProfile(state: ConversationStatePayload) {
    if (!state.context) return;
    for (const key of ["name", "phone", "city", "address"] as const)
        state.customer[key] = state.context.profile[key]?.value ?? null;
}
export function invalidateOrderReview(execution: SharedContext["execution"]) {
    execution.orderConfirmed = false;
    execution.awaitingOrderConfirmation = false;
    delete execution.orderReview;
}
/** Only adapters reading the tenant's catalog supply terms, never customer/LLM text. */
export function setOrderTerms(state: ConversationStatePayload, product: { id: string; price_amount?: number | null; currency?: string | null }) {
    if (!state.context) return;
    const terms: OrderTerms | undefined = typeof product.price_amount === "number" && Number.isFinite(product.price_amount)
        && product.price_amount >= 0 && typeof product.currency === "string" && /^[A-Z]{3}$/.test(product.currency)
        ? { productId: product.id, unitAmount: product.price_amount, currency: product.currency, quantity: 1 } : undefined;
    if (JSON.stringify(state.context.execution.orderTerms) !== JSON.stringify(terms)) invalidateOrderReview(state.context.execution);
    state.context.execution.orderTerms = terms;
}
/** Equality key, not an authorization token. Sources/object insertion order are irrelevant. */
function orderFactsKey(state: ConversationStatePayload, keys: string[]) {
    return JSON.stringify([state.product_id ?? null, state.product_type_id ?? null,
        [state.visual?.versionId ?? null, state.context?.execution.linear?.versionId ?? state.linearSnapshot?.versionId ?? null, state.orderWorkflowSnapshot ?? null],
        [state.visual?.binding?.flowId ?? null, state.visual?.binding?.entity.kind ?? null, state.visual?.binding?.entity.id ?? null],
        Object.entries(state.visual?.branchPorts ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        profileKeys.map(key => [key, state.context?.profile[key]?.value ?? null]),
        [...new Set(keys)].sort().map(key => [key, getFact(state, key)?.value ?? null]),
        // Keep old v1/v2/v3 receipts readable. Submission requires new commercial evidence.
        ...(state.context?.execution.orderTerms ? [state.context.execution.orderTerms] : [])]);
}
function orderFieldKeys(steps: WorkflowStepDef[]) {
    return [...new Set(steps.filter(step => !["customer", "confirm"].includes(step.kind)).map(step => step.fieldKey ?? step.key).filter(key => !profileKey(key)))].sort();
}
export function freshOrderReview(state: ConversationStatePayload, confirmed = false, steps?: WorkflowStepDef[]) {
    const review = state.context?.execution.orderReview;
    return Boolean(review && Array.isArray(review.fieldKeys) && review.fieldKeys.every(key => typeof key === "string" && safeFieldKey(key))
        && (!steps || JSON.stringify([...review.fieldKeys].sort()) === JSON.stringify(orderFieldKeys(steps)))
        && Number.isFinite(review.expiresAt) && review.expiresAt > Date.now()
        && review.confirmed === confirmed && review.factsKey === orderFactsKey(state, review.fieldKeys)
        && !state.context?.execution.invalidFields?.length);
}
function requestOrderReview(state: ConversationStatePayload, steps: WorkflowStepDef[]) {
    const fieldKeys = orderFieldKeys(steps);
    state.context!.execution.orderReview = { id: crypto.randomUUID(), factsKey: orderFactsKey(state, fieldKeys), fieldKeys, expiresAt: Date.now() + 30 * 60000, confirmed: false };
    state.context!.execution.awaitingOrderConfirmation = true;
    state.context!.execution.orderConfirmed = false;
}
export function getFact(state: ConversationStatePayload, key: string): Fact | undefined {
    const profile = profileKey(key);
    return profile ? state.context?.profile[profile] : Object.hasOwn(state.context?.order ?? {}, key) ? state.context?.order[key] : undefined;
}
export function setFact(state: ConversationStatePayload, key: string, value: string, type: FieldType, source: string) {
    if (!state.context || !safeFieldKey(key))
        return false;
    const profile = profileKey(key);
    const actualType = profile === "phone" ? "phone" : profile === "email" ? "email" : profile ? "text" : type;
    value = value.trim();
    if (!validValue(value, actualType)) {
        state.context.execution.validationFailures = (state.context.execution.validationFailures ?? 0) + 1;
        state.context.execution.invalidFields = [...new Set([...(state.context.execution.invalidFields ?? []), key])];
        invalidateOrderReview(state.context.execution);
        if (profile && state.processes?.order) {
            const execution = state.processes.order.snapshot.execution;
            invalidateOrderReview(execution);
            execution.invalidFields = [...new Set([...(execution.invalidFields ?? []), key])];
        }
        return false;
    }
    state.context.execution.invalidFields = state.context.execution.invalidFields?.filter(k => k !== key);
    if (profile && state.processes?.order) {
        const execution = state.processes.order.snapshot.execution;
        execution.invalidFields = execution.invalidFields?.filter(k => k !== key);
    }
    const revisited = state.context.execution.linear?.steps.find(s=>s.key===state.revisitStep);
    if (revisited && (revisited.fieldKey ?? revisited.key) === key) delete state.revisitStep;
    const prior = getFact(state, key);
    const fact: Fact = { value, type: actualType, source, validated: true };
    if (profile) {
        state.context.profile[profile] = fact;
        if (profile !== "email")
            state.customer[profile] = value;
    }
    else {
        state.context.order[key] = fact;
        state.fields[key] = type === "photo" ? true : value;
    }
    if (prior?.value !== value) {
        invalidateOrderReview(state.context.execution);
        if (profile && state.processes?.order) invalidateOrderReview(state.processes.order.snapshot.execution);
    }
    return true;
}
export function resetOrder(state: ConversationStatePayload): ConversationStatePayload {
    const next = migrateContext(emptyState());
    next.context!.execution.factOwner = "order";
    next.context!.profile = structuredClone(state.context?.profile ?? {});
    for (const [key, fact] of Object.entries(next.context!.profile)) {
        if (fact)
            setFact(next, `customer_${key}`, fact.value, fact.type, fact.source);
    }
    if (Object.keys(next.context!.profile).length)
        next.context!.execution.profileConfirmation = "pending";
    next.schemaVersion = state.schemaVersion ?? 2;
    next.processes = state.processes;
    next.completedVisual = state.completedVisual;
    next.recentMessages = state.recentMessages;
    next.customerDeclaredFacts = structuredClone(state.customerDeclaredFacts);
    next.entityPresentation = state.entityPresentation;
    next.conversationPaused = state.conversationPaused;
    return next;
}
export function isQuestion(message: string) {
    return /\?/.test(message) || /^(sa kushton|sa eshte|a mund|si |ku |kur |pse\b|cfare\b|cili\b|cilen\b|cilat\b|what |where |how |why\b|which\b)/.test(foldText(message).trim());
}
export function affirmative(message: string) {
    return /^(po|yes|ok|okay|dakord|konfirmoj|e konfirmoj|ne rregull|po ju lutem)[\s.!]*$/.test(foldText(message));
}
/** Only explicit labels are extracted without an active question. No guesses from comma order. */
export function extractExplicitFacts(state: ConversationStatePayload, message: string, steps: WorkflowStepDef[] = []) {
    const labels: Record<string, string> = { emri: "customer_name", name: "customer_name", tel: "customer_phone", telefon: "customer_phone", telefoni: "customer_phone", phone: "customer_phone", email: "customer_email", qyteti: "customer_city", city: "customer_city", adresa: "customer_address", address: "customer_address" };
    for (const step of steps)
        if (!["confirm", "customer", "photo"].includes(step.kind)) {
            labels[foldText(step.key)] = step.fieldKey ?? step.key;
            if (step.label)
                labels[foldText(step.label)] = step.fieldKey ?? step.key;
        }
    let count = 0;
    // Anchored own introduction only; no inference from bare names, questions,
    // third-party descriptions or arbitrary prose. Corrections reuse setFact.
    const introduction = message.trim().match(/^(?:quhem|emri im [eë]sht[eë])\s+([\p{L}][\p{L}'’-]*(?: [\p{L}][\p{L}'’-]*){0,3})[.!]?$/iu);
    if (introduction && !/\b(?:dhe|dua|eshte|nuk|ose|apo|and|want|is|not|or)\b/.test(foldText(introduction[1]))
        && setFact(state, "customer_name", introduction[1], "text", "message_self_introduction")) count++;
    for (const part of message.split(/[\n;,]+/)) {
        const match = part.trim().match(/^(.{1,80}?)\s*:\s*(.+)$/);
        if (!match)
            continue;
        const key = labels[foldText(match[1])];
        if (!key)
            continue;
        const step = steps.find(s => (s.fieldKey ?? s.key) === key);
        const type = key === "customer_phone" ? "phone" : key === "customer_email" ? "email" : step?.fieldType ?? "text";
        // A labelled contact value may precede a separate sentence. Bound typed
        // values without splitting dots inside emails or formatted phone numbers.
        const raw = match[2].trim();
        const value = type === "phone" ? raw.match(/^(\+?[\d\s().-]*\d)(?:[.!?](?=\s|$)|$)/)?.[1] ?? raw
            : type === "email" ? raw.match(/^([^\s@]+@[^\s@]+\.[^\s@]+?)(?:[.!?](?=\s|$)|$)/)?.[1] ?? raw : raw;
        if (isQuestion(value))
            continue;
        if (step?.options?.length && !step.options.some(v => foldText(v) === foldText(value)))
            continue;
        if (setFact(state, key, value, type, "message_label"))
            count++;
    }
    return count;
}
export function missingProfile(state: ConversationStatePayload) {
    const pin = state.visual?.collection;
    const required: readonly ProfileKey[] = pin?.mode === "collection_only" && pin.domain === "order"
        ? pin.profileFields : ["name", "phone", "city", "address"];
    return required.filter(k => !state.context?.profile[k]);
}
export function profileSummary(state: ConversationStatePayload) {
    const pin = state.visual?.collection;
    const keys = pin?.mode === "collection_only" ? profileKeys.filter(k => pin.profileFields.includes(k)
        || Object.hasOwn(state.visual?.values ?? {}, `customer_${k}`)) : profileKeys;
    return keys.map(k => state.context?.profile[k]?.value).filter(Boolean).join(" · ");
}
export function skipKnownSteps(state: ConversationStatePayload, steps: WorkflowStepDef[]) {
    const context = state.context!;
    let index = state.step_key === "choose_product" ? 0 : steps.findIndex(s => s.key === state.step_key);
    if (index < 0)
        return;
    for (; index < steps.length; index++) {
        const step = steps[index];
        const known = state.revisitStep === step.key ? false : step.kind === "customer" ? !missingProfile(state).length && context.execution.profileConfirmation !== "pending" : step.kind !== "confirm" && Boolean(getFact(state, step.fieldKey ?? step.key));
        if (!known) {
            state.step_key = step.key;
            return;
        }
        context.execution.skipped = [...new Set([...(context.execution.skipped ?? []), step.key])].slice(-64);
    }
    state.step_key = "order_confirm";
}
export function sharedPrompt(state: ConversationStatePayload, steps: WorkflowStepDef[], productName?: string) {
    if (state.context?.execution.invalidFields?.length) {
        const labels: Record<string, string> = { customer_phone: "telefonin", customer_email: "emailin", customer_name: "emrin", customer_city: "qytetin", customer_address: "adresën" };
        return `Kontrollo ${state.context.execution.invalidFields.map(k => labels[k] ?? steps.find(s => (s.fieldKey ?? s.key) === k)?.label ?? k).join(", ")}. Shkruaj një vlerë të vlefshme.`;
    }
    if (state.step_key === "order_confirm") {
        // Navigation may re-display review without advancing the adapter.
        if (!freshOrderReview(state, false, steps)) requestOrderReview(state, steps);
        const terms = state.context?.execution.orderTerms;
        const collectionOnly = state.visual?.collection?.mode === "collection_only";
        return `${collectionOnly ? "Konfirmoni të dhënat e kërkesës" : "Konfirmoni porosinë"}${productName ? ` për ${productName}` : ""} me këto të dhëna? ${profileSummary(state)}${steps.filter(step => !["customer", "confirm"].includes(step.kind)).flatMap(step => { const key = step.fieldKey ?? step.key, fact = getFact(state, key); return fact && !profileKey(key) ? [` · ${step.label ?? key}: ${fact.value}`] : []; }).join("")}${terms && !collectionOnly ? ` · Sasia: 1 · Totali: ${terms.unitAmount} ${terms.currency}` : ""}.${collectionOnly ? " Nuk krijohet porosi nga ky konfirmim." : ""} Përgjigju me Po ose shkruaj korrigjimin.`;
    }
    if (state.step_key === "order_ready")
        return state.visual?.collection?.mode === "collection_only"
            ? "Të dhënat e kërkesës u konfirmuan. Nuk u krijua porosi dhe kërkesa nuk iu kalua automatikisht stafit."
            : "Porosia është gati për stafin. Ekipi do ta shqyrtojë dhe dërgojë.";
    const step = steps.find(s => s.key === state.step_key);
    if (step?.kind === "customer") {
        if (state.context?.execution.profileConfirmation === "pending")
            return `Kemi këto të dhëna: ${profileSummary(state)}. A vlejnë për këtë porosi? Përgjigju me Po ose shkruaj korrigjimin.`;
        const labels = { name: "emrin", phone: "telefonin", email: "emailin", city: "qytetin", address: "adresën" };
        return `Na jepni ${missingProfile(state).map(k => labels[k]).join(", ")}.`;
    }
    return step?.prompt || (step?.label ? `${step.label}${step.options?.length ? ` (${step.options.join(", ")})` : ""}?` : "Cilin produkt dëshironi?");
}
export function advanceSharedOrder(input: ConversationStatePayload, message: string, hasPhoto: boolean, steps: WorkflowStepDef[], justSelected = false, extractedByModel = 0) {
    const state = migrateContext(input), ctx = state.context!;
    const beforeKey = state.step_key;
    ctx.execution.factOwner = "order";
    const wasConfirming = ctx.execution.awaitingOrderConfirmation && freshOrderReview(state, false, steps);
    if (state.step_key === "order_ready" && !freshOrderReview(state, true)) {
        invalidateOrderReview(ctx.execution);
        state.step_key = "order_confirm";
    }
    const pendingInvalid = [...(ctx.execution.invalidFields ?? [])];
    let extracted = extractExplicitFacts(state, message, steps) + extractedByModel;
    if (!extracted && pendingInvalid.length === 1 && message.trim() && !isQuestion(message) && !affirmative(message) && !message.includes(":")) {
        const key = pendingInvalid[0], step = steps.find(s => (s.fieldKey ?? s.key) === key);
        if (setFact(state, key, message, step?.fieldType ?? getFact(state, key)?.type ?? "text", "correction"))
            extracted++;
    }
    if (ctx.execution.invalidFields?.length) {
        if (state.step_key === "order_ready")
            state.step_key = "order_confirm";
        return state;
    }
    if (isQuestion(message) && !extracted)
        return state;
    if (state.step_key === "order_ready" && extracted)
        state.step_key = "order_confirm";
    if (state.step_key === "order_confirm") {
        if (wasConfirming && freshOrderReview(state) && !extracted && affirmative(message)) {
            ctx.execution.orderConfirmed = true;
            ctx.execution.orderReview!.confirmed = true;
            ctx.execution.awaitingOrderConfirmation = false;
            state.step_key = "order_ready";
        }
        else
            requestOrderReview(state, steps);
        return state;
    }
    const step = steps.find(s => s.key === beforeKey);
    if (step && !justSelected) {
        let complete = false;
        if (step.kind !== "customer" && step.required === false && /^(kalo|skip|nuk dua)$/i.test(message.trim())) {
            state.fields[step.key] = "skipped";
            state.step_key = steps[steps.indexOf(step) + 1]?.key ?? "order_confirm";
            skipKnownSteps(state, steps);
            if (state.step_key === "order_confirm")
                requestOrderReview(state, steps);
            return state;
        }
        if (step.kind === "customer") {
            if (ctx.execution.profileConfirmation === "pending") {
                if (affirmative(message) || extracted)
                    ctx.execution.profileConfirmation = "confirmed";
            }
            else if (!extracted && message.trim() && !isQuestion(message)) {
                const key = missingProfile(state)[0];
                if (key)
                    setFact(state, `customer_${key}`, message, "text", `step:${step.key}`);
            }
            complete = !missingProfile(state).length && ctx.execution.profileConfirmation !== "pending";
        }
        else if (step.kind === "confirm") {
            complete = affirmative(message);
            if (complete)
                state.fields[step.key] = "po";
        }
        else if (step.kind === "photo") {
            complete = hasPhoto && setFact(state, step.fieldKey ?? step.key, "photo_received", "photo", `step:${step.key}`);
        }
        else if (!extracted && message.trim()) {
            const allowed = !step.options?.length || step.options.some(v => foldText(v) === foldText(message));
            complete = allowed && setFact(state, step.fieldKey ?? step.key, message, step.fieldType ?? "text", `step:${step.key}`);
        }
        if (complete) {
            delete state.revisitStep;
            state.step_key = steps[steps.indexOf(step) + 1]?.key ?? "order_confirm";
        }
    }
    skipKnownSteps(state, steps);
    if (state.step_key === "order_confirm")
        requestOrderReview(state, steps);
    return state;
}
export function recordPrompt(state: ConversationStatePayload, key: string) {
    if (!state.context || !safeFieldKey(key))
        return;
    const counts = state.context.execution.promptCounts ?? {};
    counts[key] = (Object.hasOwn(counts, key) ? counts[key] : 0) + 1;
    state.context.execution.promptCounts = counts;
}
