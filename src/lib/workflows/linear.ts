import type { WorkflowStepDef } from "./engine";
import { safeFieldKey, profileKey } from "./context";
export type LinearDefinition = {
    name: string;
    steps: WorkflowStepDef[];
};
export function parseLinearDefinition(raw: unknown): LinearDefinition {
    const d = raw as LinearDefinition;
    if (!d || typeof d.name !== "string" || !d.name.trim() || d.name.length > 120 || !Array.isArray(d.steps) || !d.steps.length || d.steps.length > 32)
        throw new Error("Vendos emrin dhe 1–32 hapa të produktit.");
    const seen = new Set<string>();
    const steps = d.steps.map(s => {
        if (!s || !safeFieldKey(s.key) || ["choose_product", "order_ready", "order_confirm"].includes(s.key) || seen.has(s.key) || !["text", "choice", "confirm", "customer", "photo"].includes(s.kind))
            throw new Error("Hap produkti i pavlefshëm ose i përsëritur.");
        seen.add(s.key);
        if ((s.label !== undefined && (typeof s.label !== "string" || s.label.length > 100)) || (s.prompt !== undefined && (typeof s.prompt !== "string" || s.prompt.length > 1500)) || (s.fieldKey !== undefined && (typeof s.fieldKey !== "string" || !safeFieldKey(s.fieldKey))) || (s.required !== undefined && typeof s.required !== "boolean"))
            throw new Error("Kontrollo fushat e hapit.");
        if (s.fieldType && !["text", "phone", "email", "number", "photo"].includes(s.fieldType))
            throw new Error("Tip fushe i pavlefshëm.");
        if (s.options !== undefined && (!Array.isArray(s.options) || !s.options.length || s.options.length > 30 || s.options.some(o => typeof o !== "string" || !o.trim() || o.length > 100)))
            throw new Error("Zgjedhje të pavlefshme.");
        if (s.fieldType === "photo" && s.kind !== "photo")
            throw new Error("Fotoja kërkon një hap fotoje.");
        if (s.kind === "photo" && s.fieldKey && profileKey(s.fieldKey))
            throw new Error("Fotoja i përket porosisë, jo profilit.");
        return { key: s.key, kind: s.kind, required: s.required !== false, label: s.label?.trim(), prompt: s.prompt?.trim(), fieldKey: s.fieldKey, fieldType: s.fieldType, options: s.options };
    });
    if (!steps.some(s => s.kind === "customer"))
        throw new Error("Shto hapin e të dhënave të klientit për dorëzimin e porosisë.");
    return { name: d.name.trim(), steps };
}
