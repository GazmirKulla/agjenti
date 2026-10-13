import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PublicationReadinessView, PublicationReceiptView } from "./publication-readiness";
import type { PublicationReadiness } from "@/lib/workflows/visual/publication-types";
it.each([
  ["ready", "Gati për publikim"], ["approval_required", "kërkohet miratim"], ["needs_setup", "Kërkon konfigurim"],
  ["simulation_failed", "Simulimi dështoi"], ["unverified_external_action", "sjellje e paverifikuar"], ["stale_proposal", "Propozim i vjetruar"],
] as const)("explains %s without a successful publication claim", (status, label) => {
  const publication: PublicationReadiness = { mode: "assistant_strict", result: "BLOCKED", status, canRequestApproval: false, canPublish: false, baseRevision: 3, candidateGraphHash: "hash", findings: [] };
  const html = renderToStaticMarkup(h(PublicationReadinessView, { publication }));
  expect(html).toContain(label); expect(html).toContain("jo konfirmim publikimi"); expect(html).not.toContain("Publikimi u konfirmua");
});
it("renders the exact acknowledged revision and a missing-receipt warning without inventing a version", () => {
  const html = renderToStaticMarkup(h(PublicationReceiptView, { receipt: { revision: 8, warning: "Rifresko historikun." } }));
  expect(html).toContain("revisioni 8"); expect(html).not.toContain("Versioni:"); expect(html).toContain("Rifresko historikun");
});
