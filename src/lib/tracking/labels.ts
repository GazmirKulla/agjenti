/** Display names for Platform Admin: capability groups, Assistant actions, exits and the server's reason codes. */

export const moduleLabels: Record<string, string> = {
  inbox: "Bisedat dhe stafi", orders: "Porositë", bookings: "Rezervimet", workflows: "Proceset e personalizuara", products: "Produktet",
  services: "Shërbimet", knowledge: "Njohuritë", agents: "Agjenti dhe trajnimi", business: "Biznesi dhe cilësimet", assistant: "Biseda me Asistentin",
  jobs: "Punët në sfond", integrations: "Integrimet",
};

/** The Assistant's actions by the module they work on; operations bring their own module. */
const actionModules: Record<string, string> = {
  operation: "assistant", operation_plan: "assistant", operation_resume: "assistant", automation_plan: "business", configuration_apply: "business",
  configuration_resume: "business", clarify: "assistant", search: "assistant", product_import: "products", product_create: "products", product_update: "products",
  service_create: "services", service_update: "services", knowledge_create: "knowledge", knowledge_update: "knowledge", profile_update: "business",
  agent_update: "agents", availability: "bookings", booking_create: "bookings", booking_update: "bookings",
};
const operationModules: Record<string, string> = { calendar: "bookings", booking: "bookings", training: "agents", conversation: "inbox", attention: "business", order: "orders" };
export function groupOf(capability: string, module: string): string {
  if (capability.startsWith("system.")) return module;
  const key = capability.replace(/^assistant\./, "");
  if (actionModules[key]) return actionModules[key];
  if (/^(workflow|orderflow|linear)[_.]/.test(key)) return "workflows";
  return operationModules[key.split(".")[0]] ?? (moduleLabels[module] ? module : "business");
}

const actionLabels: Record<string, string> = {
  operation: "Veprim i panjohur", operation_plan: "Plan me disa veprime", operation_resume: "Vazhdim i planit", automation_plan: "Plan automatizimi",
  configuration_apply: "Konfigurim i biznesit", configuration_resume: "Vazhdim i konfigurimit",
  orderflow_load: "Lexo proceset e porosive", orderflow_read: "Shiko një proces porosie", orderflow_create: "Krijo proces porosie", orderflow_update: "Ndrysho proces porosie", orderflow_assign: "Lidh proces porosie",
  linear_load: "Lexo proceset e vjetra", linear_read: "Shiko proces të vjetër", linear_draft: "Ndrysho proces të vjetër", linear_link: "Lidh proces të vjetër", linear_publish: "Publiko proces të vjetër",
  workflow_load: "Lexo procesin", workflow_read: "Shiko procesin", workflow_catalog: "Shiko lidhjet e procesit", workflow_draft: "Ndrysho procesin", workflow_restore: "Rikthe një version", workflow_publish: "Publiko procesin",
  workflow_enable: "Ndiz procesin", workflow_disable: "Fik procesin", clarify: "Pyetje sqaruese", search: "Kërkim në të dhëna", product_import: "Import produktesh",
  product_create: "Krijo produkt", product_update: "Ndrysho produkt", service_create: "Krijo shërbim", service_update: "Ndrysho shërbim", knowledge_create: "Shto njohuri",
  knowledge_update: "Ndrysho njohuri", profile_update: "Ndrysho emrin e biznesit", agent_update: "Ndrysho udhëzimet", availability: "Kontrollo oraret e lira",
  booking_create: "Krijo rezervim", booking_update: "Ndrysho rezervim",
};
export function capabilityName(capability: string, label: string) {
  return actionLabels[capability.replace(/^assistant\./, "")] ?? label;
}

const pointLabels: Record<string, string> = {
  failed: "Dështoi", blocked: "U ndal nga serveri", abandoned: "U la në mes", refused: "U refuzua", execution_failed: "Ekzekutimi dështoi",
  attempt_failed: "Përpjekje e dështuar", handed_off: "Kaloi te stafi",
  step_failed: "Një hap dështoi", webhook_failed: "Mesazhet nuk u aktivizuan", profile_incomplete: "Meta nuk ktheu llogarinë profesionale",
  refresh_failed: "Rifreskimi dështoi", checkout_failed: "Faqja e pagesës nuk u hap", payment_failed: "Pagesa dështoi",
};
const reasonLabels: Record<string, string> = {
  out_of_stock: "produkti ka mbaruar", price_on_request: "pa çmim të caktuar", product_information_only: "produkt vetëm për informim",
  product_unavailable: "produkti nuk është aktiv", product_changed: "produkti ndryshoi", commercial_terms_changed: "çmimi ndryshoi",
  server_facts_unavailable: "të dhënat e produktit nuk u verifikuan", order_configuration_unverified: "porosia nuk u verifikua",
  order_definition_unavailable: "procesi i porosisë nuk u gjet", product_outside_workflow: "produkti nuk i përket procesit",
  booking_terms_changed: "kushtet e rezervimit ndryshuan", booking_terms_unavailable: "orari nuk u verifikua", invalid_booking_input: "të dhëna rezervimi të pavlefshme",
  booking_definition_unavailable: "procesi i rezervimit nuk u gjet", window_closed: "dritarja 24-orëshe ishte mbyllur", provider_error: "kanali refuzoi dërgimin",
  receipt_missing: "kanali nuk konfirmoi", turn_failed: "Agjenti nuk e përfundoi përgjigjen", send_failed: "dërgimi dështoi", persistence_failed: "ruajtja dështoi",
  assistant_refusal: "Asistenti e refuzoi", error: "gabim pa kod (para 20 nëntorit)", unexpected: "gabim në kod",
  invalid_input: "vlerë e pavlefshme", stale: "të dhënat ndryshuan ndërkohë", unauthorized: "pa leje ose sesion i skaduar",
  not_found: "nuk gjendet më", limit: "u arrit kufiri", unavailable: "shërbimi nuk ishte i disponueshëm", check_failed: "nuk kaloi një kontroll", no_exit_after_24h: "klienti nuk vazhdoi brenda 24 orëve", semantic_condition_unresolved: "kushti nuk u kuptua",
  unknown: "rezultat i pasigurt", other: "arsye tjetër", module_disabled: "moduli është i fikur",
  timeout: "nuk u përgjigj në kohë", nothing_queued: "asnjë burim për t'u lexuar", token_rejected: "Meta e refuzoi token-in",
  order_mismatch: "porosia në POK nuk përputhet", paid_not_applied: "u pagua, por paketa nuk u përditësua", meta_unknown: "Meta pa kod gabimi",
};
/** Codes of a controlled check: the system worked and stopped the change; "unexpected" is a bug. */
export const controlledReasons = new Set(["assistant_refusal", "invalid_input", "stale", "unauthorized", "not_found", "limit", "unavailable", "check_failed"]);
/** What a code means for whoever looks into it. */
export const reasonHelp: Record<string, string> = {
  unexpected: "Një gabim që kodi nuk e priste. Detajet (vendi në kod) janë në log-un e serverit me “capability_unexpected_failure”.",
  error: "Regjistruar para se dështimet të kishin kod: shkaku nuk u ruajt.",
  invalid_input: "Modeli ose formulari dërgoi një vlerë që kontrolli nuk e pranon.",
  stale: "Të dhënat ndryshuan mes përgatitjes dhe ruajtjes; pronari duhet ta kërkojë përsëri.",
  unauthorized: "Përdoruesi nuk kishte leje, ose sesioni kishte skaduar.",
  not_found: "Objekti nuk ekzistonte më.", limit: "U arrit një kufi i platformës.", unavailable: "Një shërbim ose tabelë nuk ishte e disponueshme.",
  check_failed: "Një kontroll tjetër i serverit e ndali; mesazhi iu shfaq pronarit.",
  timeout: "Shërbimi tjetër nuk u përgjigj brenda kohës.", token_rejected: "Meta nuk e pranoi më token-in: llogaria duhet rilidhur.", assistant_refusal: "Asistenti e refuzoi kërkesën me një mesazh për pronarin.",
};
/** A provider's code, readable: "Meta, kodi 100/33", "POK, statusi 502", "HTTP 503". */
function codeLabel(code: string) {
  if (reasonLabels[code]) return reasonLabels[code];
  const meta = /^meta_(\d+)(?:_(\d+))?$/.exec(code);
  if (meta) return `Meta refuzoi (kodi ${meta[1]}${meta[2] ? `/${meta[2]}` : ""})`;
  const status = /^(pok|provider|http)_(\d{3})$/.exec(code);
  if (status) return `${status[1] === "pok" ? "POK" : status[1] === "provider" ? "shërbimi i jashtëm" : "HTTP"} ktheu ${status[2]}`;
  return code;
}
/** "Dështoi: produkti ka mbaruar"; a step code reads "capture: gabim në kod"; an unknown code is shown as it is. */
export function exitLabel(point: string, reason: string | null) {
  const head = pointLabels[point] ?? point;
  if (!reason) return head;
  const at = reason.lastIndexOf(":");
  return at > 0 ? `${head} (${reason.slice(0, at).replace(/_/g, " ")}): ${codeLabel(reason.slice(at + 1))}` : `${head}: ${codeLabel(reason)}`;
}
/** What kind of failure a code is: a bug in our code, a refusal of another service, or a controlled check. */
export function failureKind(reason: string | null): "bug" | "external" | "check" {
  const code = reason ? reason.slice(reason.lastIndexOf(":") + 1) : "";
  if (!code || code === "unexpected" || code === "error") return "bug";
  if (/^(meta|pok|provider|http)_/.test(code) || ["timeout", "token_rejected", "order_mismatch"].includes(code)) return "external";
  return "check";
}
export const failureKindLabels = { bug: "Gabim në kod", external: "Shërbim i jashtëm", check: "Kontroll" } as const;
