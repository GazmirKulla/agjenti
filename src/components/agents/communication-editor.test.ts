import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { writeFileSync, readFileSync, readdirSync } from "node:fs";
vi.mock("@/components/dashboard/action-form", () => ({ ActionForm: ({ children }: { children: import("react").ReactNode }) => createElement("form", null, children) }));
import { CommunicationEditor, type CommunicationEditorAgent } from "./communication-editor";
import { defaultCommunicationPolicy } from "@/lib/agents/communication-policy";
const agent: CommunicationEditorAgent = { id: "synthetic", name: "Agjenti.app", instructions: "Shpjego fillimisht shërbimin dhe kupto nevojën e klientit.",
  is_active: true, updated_at: "2026-11-04T00:00:00Z", communication: defaultCommunicationPolicy, configuration_revision: 2,
  configuration_draft: { instructions: "Përgjigju shkurt dhe natyrshëm. Propozo regjistrimin kur klienti shfaq interes.", communication: defaultCommunicationPolicy, baseRevision: 2 } };
it("separates unsaved editing from publishing the persisted draft and blocks stale publication", () => {
  const render = (a: CommunicationEditorAgent) => renderToStaticMarkup(createElement(CommunicationEditor, { agent: a, slug: "synthetic", versions: [2, 1], action: async () => {} }));
  const html = render(agent);
  expect(html).toContain('name="mode" value="draft"');
  expect(html).toContain('name="mode" value="publish"');
  expect(html).toContain("Publiko draftin e ruajtur");
  expect(html).toContain("Rikthe si draft");
  const stale = render({ ...agent, configuration_revision: 3 });
  expect(stale).toMatch(/disabled="">Publiko draftin/);
  expect(render({ ...agent, configuration_draft: null })).not.toContain('name="mode" value="publish"');
  if (process.env.COMMUNICATION_PREVIEW_OUTPUT) {
    let css = "";
    try { for (const file of readdirSync(".next/static/css")) if (file.endsWith(".css")) css += readFileSync(`.next/static/css/${file}`, "utf8"); } catch { /* optional early visual preview */ }
    writeFileSync(process.env.COMMUNICATION_PREVIEW_OUTPUT, `<!doctype html><html lang="sq"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main style="max-width:960px;margin:32px auto;padding:16px"><p>PROVË E IZOLUAR · të dhëna sintetike</p>${html}</main></body></html>`);
  }
});
