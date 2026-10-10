import type { WorkflowStepDef } from "./engine";

export function parseOrderSteps(raw: unknown): WorkflowStepDef[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 24)
    throw new Error("Rrjedha duhet të ketë 1–24 hapa.");
  const keys = new Set<string>();
  const steps = raw.map((step) => {
    if (
      !step ||
      typeof step !== "object" ||
      typeof step.key !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(step.key) ||
      [
        "constructor",
        "prototype",
        "__proto__",
        "choose_product",
        "order_ready",
        "catalog_context",
        "product_query",
      ].includes(step.key) ||
      keys.has(step.key)
    )
      throw new Error("Çdo hap duhet të ketë një emër fushe të veçantë.");
    if (
      !["choice", "text", "photo", "customer", "confirm"].includes(step.kind) ||
      typeof step.label !== "string" ||
      !step.label.trim() ||
      step.label.length > 300 ||
      step.required === false
    )
      throw new Error(
        "Kontrollo llojin dhe pyetjen e hapit. Hapat e porosisë janë të detyrueshëm.",
      );
    keys.add(step.key);
    return {
      key: step.key,
      kind: step.kind as WorkflowStepDef["kind"],
      label: step.label.trim(),
      required: true,
    };
  });
  if (
    steps.filter((s) => s.kind === "customer").length !== 1 ||
    steps.at(-1)?.kind !== "customer"
  )
    throw new Error(
      "Të dhënat e klientit duhet të jenë hapi i fundit, vetëm një herë.",
    );
  return steps;
}
