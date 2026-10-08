import type { BusinessProcess, ProcessStep } from "./business-process";
import type { DashboardSignals } from "@/lib/dashboard/modules/types";
import { businessProfiles, type BusinessType } from "@/lib/onboarding/rules";

// Platform conversation guidance, never inferred commercial terms or fake facts.
export function onboardingProcess(signals: DashboardSignals, sourced: BusinessProcess | null): BusinessProcess {
  const rules = businessProfiles[signals.businessType as BusinessType] ?? businessProfiles.other;
  const caps = new Set(signals.agentCapabilities);
  const steps: ProcessStep[] = [];
  const add = (title: string, description: string) => steps.push({ key: `business_step_${steps.length + 1}`, title, description, evidence: description, sourceRef: `onboarding:${signals.workflow || rules.recommendedDefaults.workflow}` });
  add("Kupto kërkesën e klientit", "Nis nga pyetja e klientit. Kërko sqarim vetëm nëse nevoja nuk është e qartë dhe përdor njohuritë e biznesit për të udhëzuar përgjigjen.");
  if (caps.has("recommend_products") || caps.has("answer_product_details")) {
    add(signals.businessType === "fashion" ? "Ndihmo me zgjedhjen" : "Prezanto ofertën e përshtatshme", "Rekomando vetëm oferta nga katalogu i biznesit. Shpjego detajet e verifikuara; masat, variantet dhe çmimet kërkohen vetëm kur ekzistojnë në katalog.");
  } else if (caps.has("qualify_leads") || caps.has("handle_bookings")) {
    add("Sqaro shërbimin ose kërkesën", "Kupto çfarë shërbimi kërkohet dhe shpjego informacionin që gjendet në njohuri. Mos premto orare, disponueshmëri ose rezervime të pakonfirmuara.");
  } else {
    add("Përgjigju nga njohuritë", "Përdor informacionin e biznesit për pyetjen konkrete. Kur një detaj nuk është publikuar, thuaje qartë dhe kërko ndihmën e stafit.");
  }
  if (caps.has("collect_order_details") || caps.has("follow_workflow")) add("Vazhdo me workflow-n e ofertës", "Nëse klienti dëshiron të porosisë, ndiq vetëm workflow-n e produktit të zgjedhur dhe kërko vetëm detajet që ai përcakton. Pa një ofertë të konfiguruar, kërkesa i kalon stafit.");
  else if (caps.has("handle_bookings")) add("Përgatit kërkesën për stafin", "Mblidh vetëm detajet e nevojshme të kërkesës. Stafi konfirmon rezervimin, çmimin dhe disponueshmërinë kur këto nuk janë verifikuar në sistem.");
  if (steps.length < 8) add("Kontrollo hapin tjetër", "Përmblidh çfarë është sqaruar dhe udhëzo hapin e mbështetur nga njohuritë. Pagesat, dërgesat dhe veprimet e tjera kryhen vetëm kur janë konfiguruar; rastet e paqarta i kalojnë stafit.");
  return { version: 1, source: "generated", basis: "onboarding", enabled: true, name: `Rrjedha e klientit · ${rules.label}`, summary: "Pikënisje nga lloji i biznesit, oferta, qëllimet dhe aftësitë e onboarding-ut. Analizat dhe të dhënat e plotësuara e pasurojnë gjatë përdorimit.", steps, ...(sourced?.steps.length ? { publishedSteps: sourced.steps.map((step, index) => ({ ...step, key: `business_step_${index + 1}` })) } : {}), unknowns: sourced?.unknowns ?? ["Detajet e porosisë, pagesës ose realizimit plotësohen nga burimet dhe nga biznesi gjatë përdorimit."] };
}
