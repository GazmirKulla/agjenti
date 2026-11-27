import { ownProcessPublished } from "@/lib/orchestration/automatic-process";

/** Reading a custom process is always allowed; these change one. Switching one off is always allowed. */
const writes = new Set(["linear_draft", "linear_link", "linear_publish", "orderflow_create", "orderflow_update", "orderflow_assign",
  "workflow_draft", "workflow_restore", "workflow_publish", "workflow_enable", "workflow.configure"]);
export const settingsInstead = "Agjenti i merr vetë porositë, rezervimet dhe kalimin te stafi nga produktet dhe cilësimet e tua, pa proces të vizatuar. "
  + "Ndryshimin bëje te cilësimi përkatës (Si flet dhe kur thërret stafin, Struktura, produkti, Porositë, orari i Rezervimeve); i gjen te temat e Agjentit (Biznesi, Oferta, Kur klienti porosit, Kur klienti rezervon, Si flet dhe kur thërret stafin).";

/**
 * The Assistant no longer creates processes: a business without a published process of its own runs the
 * automatic one, shaped by its settings. Old per-product (linear) processes are never created or changed
 * again. A business that already published its own process keeps changing it. The owner's manual editor
 * is unaffected. Returns the refusal to show, or null when the action may go on.
 */
export async function customProcessRefusal(businessId: string, action: string): Promise<string | null> {
  if (!writes.has(action)) return null;
  if (action.startsWith("linear_")) return settingsInstead;
  try { return await ownProcessPublished(businessId) ? null : settingsInstead; }
  catch { return "Nuk u verifikua procesi i biznesit. Provo përsëri pas pak."; }
}
