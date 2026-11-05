import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/agents/training/actions", () => ({ listAgentTraining: vi.fn(), saveAgentTraining: vi.fn() }));
import { AgentTestChat } from "./test-chat";
const render = (advanced = false) => renderToStaticMarkup(createElement(AgentTestChat, { slug: "demo", userId: "operator", businessName: "Demo", advanced }));
it("offers ordinary business chat without exposing the platform testing controls", () => {
  const html = render();
  expect(html).toContain('id="agent-test-message"');
  expect(html).toContain("Bisedë e re");
  expect(html).toContain("Historiku i bisedave");
  for (const label of ["Real chat", "Rrjedha", "Simulo foto", "Eksporto bisedën", "Mësoji diçka të re"]) expect(html).not.toContain(label);
});
it("retains the removed capabilities in ChatLab with real mode off by default", () => {
  const html = render(true);
  for (const label of ["Real chat", "Rrjedha", "Simulo foto", "Eksporto bisedën", "Mësoji diçka të re"]) expect(html).toContain(label);
  expect(html).toContain('aria-checked="false"');
});
