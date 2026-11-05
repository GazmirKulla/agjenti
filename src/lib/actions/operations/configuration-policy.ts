import { parseOperation, type OperationInput } from "./catalog";
import { OperationError } from "./error";

/** Operations permitted by the configuration executor. This is not the runtime
 * customer-agent policy and never grants arbitrary administrative operations. */
export const configurationOperations = ["business.verify", "workflow.configure", "business.orders", "knowledge.save", "product.create", "product.edit", "service.save", "agent.manage", "agent.communication", "business.autoreply", "calendar.settings"] as const;
export type ConfigurationStep = { key: string; input: OperationInput; after?: number[]; references?: Record<string, { step: number; output: "id" }> };
export function parseConfigurationSteps(raw: unknown): ConfigurationStep[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 16 || JSON.stringify(raw).length > 90000) throw new OperationError("Konfigurimi duhet të ketë 1–16 hapa.");
  return raw.map((step, index) => {
    if (!step || typeof step !== "object" || Object.keys(step).some(k => !["key", "input", "after", "references"].includes(k)) ||
      !(configurationOperations as readonly unknown[]).includes(step.key)) throw new OperationError("Ky veprim nuk kryhet nga konfigurimi automatik.");
    parseOperation(step.key, step.input);
    if (step.after !== undefined && (!Array.isArray(step.after) || step.after.some((n: unknown) => !Number.isInteger(n) || Number(n) < 0 || Number(n) >= index))) throw new OperationError("Varësia duhet t'i përkasë një hapi të mëparshëm.");
    if (step.references !== undefined) {
      if (!step.references || typeof step.references !== "object" || Array.isArray(step.references)) throw new OperationError("Referencë e pavlefshme.");
      for (const [field, ref] of Object.entries(step.references) as [string, {step: number; output: string}][]) {
        if (field !== "id" || step.input.id !== undefined || !ref || Object.keys(ref).some(k => !["step", "output"].includes(k)) ||
          !Number.isInteger(ref.step) || ref.step < 0 || ref.step >= index || ref.output !== "id" || !step.after?.includes(ref.step)) throw new OperationError("Referencë e pavlefshme mes hapave.");
        const source = raw[ref.step];
        const sourceKind = source.key.split(".")[0];
        if (sourceKind !== step.key.split(".")[0] || source.input.id || source.references?.id || !["knowledge.save", "agent.manage"].includes(source.key)) throw new OperationError("Referenca nuk prodhon elementin e kërkuar.");
      }
    }
    return structuredClone(step);
  });
}
export function resolveConfigurationInput(step: ConfigurationStep, outputs: {id?: string}[]): OperationInput {
  const input = { ...step.input };
  for (const [field, ref] of Object.entries(step.references ?? {})) {
    const id = outputs[ref.step]?.id;
    if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new OperationError("Hapi paraprak nuk ka rezultat të konfirmuar.");
    input[field] = id;
  }
  return input;
}

export type ConfigurationAuthority = { request: string; expires: number; evidence: { step: number; quote: string }[] };
