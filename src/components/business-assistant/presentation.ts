import { assistantSuggestions, type AssistantUIContext } from "@/lib/business-assistant/context";

/** Presentation only: server capability and authorization checks remain authoritative. */
export function contextualAction(context: AssistantUIContext, name: string, modules: string[]) {
  const page = context.page;
  if (!modules.includes(page)) return null;
  switch (page) {
    case "products": return `Pyet ${name} për ${context.entityId ? "këtë produkt" : context.selectedEntityIds?.length ? "produktet e zgjedhura" : "produktet"}`;
    case "services": return context.entityId ? `Ndrysho këtë shërbim me ${name}` : `Pyet ${name} për shërbimet`;
    case "knowledge": return `Përditëso njohuritë me ${name}`;
    case "agents": return `Ndihmë me agjentin e klientëve · ${name}`;
    case "workflows": return `Ndihmë me këtë rrjedhë · ${name}`;
    default: return `Pyet ${name} për këtë faqe`;
  }
}

export function businessGoals(context: AssistantUIContext, modules: string[], external: boolean) {
  if (context.page !== "home") return assistantSuggestions(context, modules, external);
  return [
    { module: "products", label: "Përgatit ofertën time", text: "Dua të shtoj një produkt të ri.", blocked: external },
    { module: "services", label: "Përditëso shërbimet", text: "Dua të përditësoj shërbimet e biznesit." },
    { module: "knowledge", label: "Përgjigju pyetjeve të klientëve", text: "Dua të përditësoj njohuritë e biznesit për pyetjet e klientëve." },
    { module: "agents", label: "Përmirëso komunikimin me klientët", text: "Dua të përditësoj udhëzimet e agjentit të klientëve." },
  ].filter(goal => modules.includes(goal.module) && !goal.blocked);
}
