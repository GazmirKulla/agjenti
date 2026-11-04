/** Only for persisted historical step identifiers. New graphs carry their own
 * field labels/guidance and never inherit product-specific questions here. */
export function historicalStepPrompt(stepKey: string | null | undefined): string | null {
  switch (stepKey) {
    case "choose_product":
      return "Cilin produkt dëshironi?";
    case "collect_theme":
      return "Cilin personazh ose temë doni në produkt?";
    case "awaiting_confirm":
      return "A e konfirmoni këtë zgjedhje?";
    case "awaiting_photo":
      return "Na dërgoni foton që do të përdorim.";
    case "collect_size":
      return "Çfarë madhësie doni?";
    case "collect_pieces":
      return "Sa copëza doni?";
    case "collect_age":
      return "Sa vjeç është fëmija?";
    case "collect_tray":
      return "A doni tabaka?";
    case "collect_color":
      return "Çfarë ngjyre doni?";
    case "collect_customer":
      return "Na jepni emrin, telefonin, qytetin dhe adresën.";
    case "confirm_product":
      return "A e konfirmoni porosinë e këtij produkti?";
    case "order_ready":
      return "Porosia është gati. Stafi ose agjenti mund ta konfirmojë.";
    default:
      return null;
  }
}
