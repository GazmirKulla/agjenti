const labels: Record<string, string> = {
  name: "Emri", title: "Titulli", body: "Përmbajtja", description: "Përshkrimi", sku: "Kodi i produktit",
  image_url: "Fotografia", price_amount: "Çmimi", currency: "Monedha", product_type_id: "Lloji i produktit", workflow_id: "Workflow",
  is_active: "Aktiv", enabled: "Aktiv", mode: "Veprimi në grup", productTypeId: "Lloji i produktit", workflowId: "Workflow",
  category: "Kategoria", price_mode: "Mënyra e çmimit", booking_enabled: "Rezervimet", duration_minutes: "Kohëzgjatja në minuta", buffer_minutes: "Pushimi mes takimeve",
  hours: "Orari", closed_dates: "Datat e mbyllura", timezone: "Zona kohore", confirmation_mode: "Konfirmimi i takimeve", agent_booking_enabled: "Rezervimet nga agjenti",
  instructions: "Udhëzimet", kind: "Lloji i mësimit", instruction: "Mësimi", customerMessage: "Mesazhi i klientit", desiredResponse: "Përgjigjja e dëshiruar",
  action: "Veprimi", status: "Statusi", externalOrderId: "Porosia te sistemi i jashtëm", evidence: "Dëshmia e verifikimit", intent_key: "Identifikuesi i njohurisë",
};
export function fieldLabel(field: string) { return labels[field] ?? field; }
export function previewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Po" : "Jo";
  return typeof value === "string" ? value : JSON.stringify(value);
}
