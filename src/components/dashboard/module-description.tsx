import { moduleRegistry } from "@/lib/dashboard/modules/registry";
import type { ModuleId } from "@/lib/dashboard/modules/types";

const descriptions: Partial<Record<ModuleId, string>> = {
  products: "Menaxhon produktet e biznesit, çmimet, përshkrimet dhe lidhjet e tyre me proceset e porosisë. Produktet përdoren nga katalogu dhe agjenti gjatë bisedave me klientët.",
  services: "Menaxhon shërbimet që ofron biznesi dhe të dhënat e tyre. Shërbimet që mbështesin rezervime mund të lidhen me rrjedhën e rezervimit.",
  orders: "Shfaq porositë e klientëve, detajet dhe statusin e tyre. Lidhet me produktet dhe procesin e konfirmimit të porosisë.",
  bookings: "Menaxhon rezervimet për shërbimet e biznesit, oraret dhe statuset e tyre. Kërkon që moduli Shërbime të jetë aktiv.",
  calendar: "Shfaq rezervimet sipas datës dhe orarit. Përdoret për të parë planifikimin e takimeve dhe lidhet me modulin Rezervime.",
  catalogs: "Menaxhon katalogë dhe dokumente të biznesit nga skedarë ose lidhje web. Përmbajtja analizohet dhe konfirmohet përpara se të aktivizohet për përdorim nga agjenti.",
  leads: "Është parashikuar për kërkesat dhe interesimin e klientëve potencialë. Aktualisht faqja është vetëm një vendmbajtëse; menaxhimi i plotë i kërkesave ende nuk është implementuar.",
  customers: "Shfaq regjistrin e klientëve të biznesit dhe të dhënat e tyre të kontaktit. Klientët shtohen nga Inbox ose gjatë konfirmimit të porosive; regjistrimi këtu nuk u jep hyrje në panel.",
  knowledge: "Menaxhon pyetjet e shpeshta, politikat dhe informacionin që agjenti përdor për t’u përgjigjur klientëve. Përmbajtja mund të përditësohet dhe të aktivizohet sipas nevojës së biznesit.",
  workflows: "Menaxhon rrjedhat e bisedave dhe veprimeve të biznesit: hapat, kushtet dhe lidhjet mes tyre. Përfshin editorin, validimin, provat, versionet dhe publikimin e rrjedhave.",
};

export function ModuleDescription({ moduleId }: { moduleId: ModuleId }) {
  const mod = moduleRegistry[moduleId];
  return (
    <>
      <p>{mod.description}</p>
      <details className="module-description">
        <summary aria-label={`Shiko më shumë për ${mod.label}`}>Shiko më shumë</summary>
        <p>{descriptions[moduleId] ?? mod.description}</p>
      </details>
    </>
  );
}
