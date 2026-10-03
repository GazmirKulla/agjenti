export type SetupStatus = {
  available: boolean;
  connected: boolean;
  productCount: number;
  usableProducts: number;
  unconfiguredProducts: number;
  agentReady: boolean;
  signature: string;
  tested: boolean;
  launched: boolean;
};
export function setupSteps(s: SetupStatus) {
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
      title: "Shto produktet",
      description:
        "Shto produktin ose shërbimin e parë me emër dhe çmim, ose sinkronizo katalogun e jashtëm.",
      action: "Shto produkte",
      path: "products",
      done: s.usableProducts > 0,
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
      description:
        "Te Provo Agjentin, shkruaj emrin e saktë të produktit dhe ndiq të gjithë hapat deri te porosia gati. Përdor të dhëna prove; nuk krijohet porosi reale.",
      action: "Provo Agjentin",
      path: "agents/test",
      done: s.tested,
    },
  ];
}
export function isReady(s: SetupStatus) {
  return s.available && setupSteps(s).every((step) => step.done);
}
