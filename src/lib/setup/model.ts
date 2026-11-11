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
  /** Instagram (by username or connection) or the website was read at least once. */
  sourcesRead?: boolean;
};
export function setupSteps(s: SetupStatus) {
  const documentBusiness =
    s.productCount === 0 &&
    ((s.catalogCount ?? 0) > 0 || (s.serviceCount ?? 0) > 0 || (s.knowledgeCount ?? 0) > 0);
  return [
    {
      key: "sources",
      title: "Mëso nga Instagram-i dhe website-i",
      description:
        "Shkruaj username-in e Instagram-it dhe website-in. Agjenti lexon profilin publik, postimet e fundit dhe faqen, dhe krijon njohuritë e para. Nuk kërkon lidhjen e llogarisë.",
      action: "Shto burimet",
      path: "knowledge",
      done: !!s.sourcesRead || (s.knowledgeCount ?? 0) > 0,
      // Helps, but never blocks starting: a business may have neither.
      optional: true,
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
      // Recommended before going live, never required.
      optional: true,
      recommended: true,
    },
    {
      key: "instagram",
      title: "Lidh Instagram-in ose WhatsApp-in",
      description:
        "Hapi i fundit: lidh Instagram-in ose WhatsApp Business që Agjenti të marrë dhe t'u përgjigjet mesazheve të klientëve. Kjo është e ndarë nga leximi i profilit dhe është e detyrueshme për përdorimin real.",
      action: "Lidh kanalin",
      path: "integrations",
      done: s.connected,
    },
  ].filter((step) => !documentBusiness || step.key !== "workflows");
}
/** Steps that are suggested but do not block going live. */
export function recommendedSteps(s: SetupStatus) {
  return setupSteps(s).filter((step) => !step.done && "recommended" in step && step.recommended);
}
export function isReady(s: SetupStatus) {
  return s.available && setupSteps(s).every((step) => step.done || step.optional);
}

/** Mesazh i qartë kur aktivizimi bllokohet nga hapat e konfigurimit. */
export function setupGateMessage(s: SetupStatus): string | null {
  if (isReady(s)) return null;
  if (!s.available)
    return "Konfigurimi nuk është gati në databazë. Apliko migrimet e fundit, pastaj provo përsëri.";
  const next = setupSteps(s).find((step) => !step.done && !step.optional);
  if (!next) return "Përfundo konfigurimin nga Dashboard përpara aktivizimit.";
  const tips: Record<string, string> = {
    sources:
      "Shto Instagram-in ose website-in te Njohuritë, ose një njohuri të parë, përpara aktivizimit.",
    instagram:
      "Lidh Instagram-in ose WhatsApp-in nga Dashboard përpara aktivizimit të përgjigjeve automatike.",
    products:
      "Përgatit njohuritë e biznesit, një produkt, një katalog ose një shërbim përpara aktivizimit.",
    agents: "Aktivizo një agjent me udhëzime te Agjentët përpara aktivizimit.",
    workflows:
      "Lidh llojin dhe workflow-in për çdo produkt te Produktet / Workflow përpara aktivizimit.",
  };
  return (
    tips[next.key] ??
    `Përfundo hapin «${next.title}» nga Dashboard përpara aktivizimit.`
  );
}
