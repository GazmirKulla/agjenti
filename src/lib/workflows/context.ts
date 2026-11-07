import { emptyState, type ConversationStatePayload, type WorkflowStepDef } from "./state";
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
function invalidateConfirmation(execution: SharedContext["execution"]) {
    execution.orderConfirmed = false;
    execution.awaitingOrderConfirmation = false;
    delete execution.orderReview;
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
        invalidateConfirmation(state.context.execution);
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
    if (prior?.value !== value) invalidateConfirmation(state.context.execution);
    return true;
}
