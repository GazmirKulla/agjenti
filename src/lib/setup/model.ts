export type SetupStatus = {
  available: boolean;
  connected: boolean;
  productCount: number;
  catalogCount?: number;
  serviceCount?: number;
  knowledgeCount?: number;
  usableProducts: number;
  unconfiguredProducts: number;
  agentReady: boolean;
  signature: string;
  tested: boolean;
  launched: boolean;
};
export function setupSteps(s: SetupStatus) {
  const documentBusiness =
    s.productCount === 0 &&
    ((s.catalogCount ?? 0) > 0 || (s.serviceCount ?? 0) > 0 || (s.knowledgeCount ?? 0) > 0);
  return [
    {
      key: "instagram",
      title: "Lidh Instagram-in",
      description:
        "Lidh llogarinë profesionale për të marrë mesazhe. Ky hap është i detyrueshëm për përdorimin real.",
      action: "Lidh Instagram-in",
      path: "instagram",
      done: s.connected,
    },
    {
      key: "products",
      title: documentBusiness
        ? "Përgatit informacionin e biznesit"
        : "Shto produktet",
      description: documentBusiness
        ? "Njohuritë, katalogët ose shërbimet i japin Agjentit informacion për përgjigjet. Mund t’i përmirësosh gjatë përdorimit."
        : "Shto produktet e para. Nëse përdor broshura ose dokumente B2B, shtoji te Katalogët; shërbimet shtohen te Shërbimet.",
      action: documentBusiness ? "Rishiko informacionin" : "Shto produkte",
      path: documentBusiness
        ? s.catalogCount
          ? "catalogs"
          : s.serviceCount ? "services" : "knowledge"
        : "products",
      done: s.usableProducts > 0 || documentBusiness,
    },
    {
      key: "agents",
      title: "Konfiguro Agjentin AI",
      description:
        "Rishiko udhëzimet dhe zgjidh agjentin aktiv. Dërgimi automatik mbetet i fikur derisa ta aktivizosh vetë.",
      action: "Konfiguro agjentin",
      path: "agents",
      done: s.agentReady,
    },
    {
      key: "workflows",
      title: "Përcakto procesin e porosisë",
      description:
        s.unconfiguredProducts > 0
          ? `${s.unconfiguredProducts} produkte kërkojnë lloj global dhe workflow të biznesit (me hapin e klientit në fund). Lidhi nga Produktet.`
          : "Zgjidh llojin global dhe lidh ose sugjero një workflow të biznesit për çdo produkt.",
      action: "Konfiguro procesin",
      path: "workflows",
      done: s.productCount > 0 && s.unconfiguredProducts === 0,
    },
    {
      key: "test",
      title: "Provo konfigurimin",
      description: documentBusiness
        ? "Te Provo Agjentin, bëj një pyetje për biznesin dhe kontrollo përgjigjen nga njohuritë, katalogu ose shërbimi."
        : "Te Provo Agjentin, shkruaj emrin e saktë të produktit dhe ndiq të gjithë hapat deri te porosia gati. Përdor të dhëna prove; nuk krijohet porosi reale.",
      action: "Provo Agjentin",
      path: "agents/test",
      done: s.tested,
    },
  ].filter((step) => !documentBusiness || step.key !== "workflows");
}
export function isReady(s: SetupStatus) {
  return s.available && setupSteps(s).every((step) => step.done);
}

/** Mesazh i qartë kur aktivizimi bllokohet nga hapat e konfigurimit. */
export function setupGateMessage(s: SetupStatus): string | null {
  if (isReady(s)) return null;
  if (!s.available)
    return "Konfigurimi nuk është gati në databazë. Apliko migrimet e fundit, pastaj provo përsëri.";
  const next = setupSteps(s).find((step) => !step.done);
  if (!next) return "Përfundo konfigurimin nga Dashboard përpara aktivizimit.";
  const tips: Record<string, string> = {
    instagram:
      "Lidh Instagram-in nga Dashboard → Instagram përpara aktivizimit të përgjigjeve automatike.",
    products:
      "Përgatit njohuritë e biznesit, një produkt, një katalog ose një shërbim përpara aktivizimit.",
    agents: "Aktivizo një agjent me udhëzime te Agjentët përpara aktivizimit.",
    workflows:
      "Lidh llojin dhe workflow-in për çdo produkt te Produktet / Workflow përpara aktivizimit.",
    test: "Përfundo provën te Provo Agjentin përpara aktivizimit.",
  };
  return (
    tips[next.key] ??
    `Përfundo hapin «${next.title}» nga Dashboard përpara aktivizimit.`
  );
}
