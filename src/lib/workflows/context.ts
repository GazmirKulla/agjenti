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
export type SharedContext = {
    profile: Partial<Record<ProfileKey, Fact>>;
    order: Record<string, Fact>;
    execution: {
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
    if (state.linearSnapshot && !state.orderWorkflowSnapshot && !state.context.execution.linear)
        state.context.execution.linear = state.linearSnapshot;
    state.schemaVersion = state.schemaVersion === 3 ? 3 : 2;
    return state;
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
        state.context.execution.orderConfirmed = false;
        state.context.execution.awaitingOrderConfirmation = false;
        return false;
    }
    state.context.execution.invalidFields = state.context.execution.invalidFields?.filter(k => k !== key);
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
        state.context.execution.orderConfirmed = false;
        state.context.execution.awaitingOrderConfirmation = false;
    }
    return true;
}
export function resetOrder(state: ConversationStatePayload): ConversationStatePayload {
    const next = migrateContext(emptyState());
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
    return next;
}
export function isQuestion(message: string) {
    return /\?/.test(message) || /^(sa kushton|sa eshte|a mund|si |ku |kur |what |where |how )/.test(foldText(message));
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
    return (["name", "phone", "city", "address"] as const).filter(k => !state.context?.profile[k]);
}
export function profileSummary(state: ConversationStatePayload) {
    return profileKeys.map(k => state.context?.profile[k]?.value).filter(Boolean).join(" · ");
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
    if (state.step_key === "order_confirm")
        return `Konfirmoni porosinë${productName ? ` për ${productName}` : ""} me këto të dhëna? ${profileSummary(state)}${Object.entries(state.context?.order ?? {}).filter(([k]) => k !== "product_query").map(([k, v]) => ` · ${steps.find(s => (s.fieldKey ?? s.key) === k)?.label ?? k}: ${v.value}`).join("")}. Përgjigju me Po ose shkruaj korrigjimin.`;
    if (state.step_key === "order_ready")
        return "Porosia është gati për stafin. Ekipi do ta shqyrtojë dhe dërgojë.";
    const step = steps.find(s => s.key === state.step_key);
    if (step?.kind === "customer") {
        if (state.context?.execution.profileConfirmation === "pending")
            return `Kemi këto të dhëna: ${profileSummary(state)}. A vlejnë për këtë porosi? Përgjigju me Po ose shkruaj korrigjimin.`;
        const labels = { name: "emrin", phone: "telefonin", city: "qytetin", address: "adresën" };
        return `Na jepni ${missingProfile(state).map(k => labels[k]).join(", ")}.`;
    }
    return step?.prompt || (step?.label ? `${step.label}${step.options?.length ? ` (${step.options.join(", ")})` : ""}?` : "Cilin produkt dëshironi?");
}
export function advanceSharedOrder(input: ConversationStatePayload, message: string, hasPhoto: boolean, steps: WorkflowStepDef[], justSelected = false, extractedByModel = 0) {
    const state = migrateContext(input), ctx = state.context!;
    const beforeKey = state.step_key;
    const wasConfirming = ctx.execution.awaitingOrderConfirmation;
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
        if (wasConfirming && !extracted && affirmative(message)) {
            ctx.execution.orderConfirmed = true;
            ctx.execution.awaitingOrderConfirmation = false;
            state.step_key = "order_ready";
        }
        else
            ctx.execution.awaitingOrderConfirmation = true;
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
                ctx.execution.awaitingOrderConfirmation = true;
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
        ctx.execution.awaitingOrderConfirmation = true;
    return state;
}
export function recordPrompt(state: ConversationStatePayload, key: string) {
    if (!state.context || !safeFieldKey(key))
        return;
    const counts = state.context.execution.promptCounts ?? {};
    counts[key] = (Object.hasOwn(counts, key) ? counts[key] : 0) + 1;
    state.context.execution.promptCounts = counts;
}
