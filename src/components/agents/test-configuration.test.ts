import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { TestConfiguration } from "./test-configuration";
import { AgentEffectObservation, AgentInstructionNotice } from "../business-assistant/agent-configuration";
import { previewFor } from "@/lib/business-assistant/model";
import { configurationEffectMessage, type AgentConfigurationEffect, type TestConfigurationProvenance } from "@/lib/agents/configuration-contract";

const configuration: TestConfigurationProvenance = {
  agents: [{ agentId: null, agentName: null, active: null, instructionHash: null, instructionSource: "base", readAt: "2026-10-23T10:00:00Z", fallbackReason: "no_active_agent", generationRequested: true, fallbackInstructionsUsed: true }],
  workflow: { id: null, versionId: "published-A", mode: "pinned" }, responseSource: "ai", responseFallbackReason: null, behaviorVerified: false,
};
const preview = previewFor("agent_update", { id: "synthetic-agent", name: "Synthetic agent", is_active: false, instructions: "Old" }, { instructions: "New" }, "UTC");
const effect: AgentConfigurationEffect = { saved: true, status: "inactive", effective: false, targetAgentId: "synthetic-agent", targetActive: false, activeAgentId: null, instructionHash: "a".repeat(64), checkedAt: "2026-10-23T10:00:00Z", behaviorVerified: false };

it("keeps the no-active warning outside closed details with an existing configuration link", () => {
  const html = renderToStaticMarkup(createElement(TestConfiguration, { configuration, slug: "synthetic", agentConfigured: false }));
  expect(html.indexOf("Nuk ka agjent klientësh aktiv")).toBeLessThan(html.indexOf("<details>"));
  expect(html).toContain('role="status"');
  expect(html).not.toContain("<details open");
  expect(html).toContain('href="/b/synthetic/agents"');
  expect(html).toContain("udhëzimet bazë");
  expect(html).toContain("Version i fiksuar");
});
it("does not label an unavailable/legacy trace as an actual active config", () => {
  const html = renderToStaticMarkup(createElement(TestConfiguration, { slug: "synthetic", agentConfigured: false }));
  expect(html).toContain("Nuk u konfirmuan");
  expect(html).toContain("nuk është i disponueshëm");
});
it("explains provider fallback without exposing arbitrary error details or certifying behavior", () => {
  const html = (reason: string) => renderToStaticMarkup(createElement(TestConfiguration, { configuration: { ...configuration, responseSource: "fallback", responseFallbackReason: reason }, slug: "synthetic", agentConfigured: false }));
  expect(html("provider_error")).toContain("Ofruesi AI nuk e përfundoi kërkesën");
  expect(html("secret-provider-error")).not.toContain("secret-provider-error");
  expect(html("provider_error")).toContain("nuk është verifikuar automatikisht");
});
it("keeps approval notices explicit and restored receipts historical, not behavior verification", () => {
  expect(preview.agentConfiguration).toEqual({ agentId: "synthetic-agent", active: false });
  const html = renderToStaticMarkup(createElement(AgentInstructionNotice, { preview, slug: "synthetic" }));
  expect(html).toContain("joaktiv"); expect(html).toContain("nuk garantojnë tekst identik");
  expect(html).toContain('href="/b/synthetic/agents"');
  const restored = renderToStaticMarkup(createElement(AgentEffectObservation, { effect }));
  expect(restored).toContain("jo garanci për gjendjen pas ndryshimeve të tjera");
  expect(restored).toContain("Sjellja nuk është testuar");
});
it("exports actual rendered components for optional isolated browser verification", () => {
  const directory = process.env.C1_UI_ARTIFACT_DIR;
  if (!directory) return;
  if (!directory.startsWith("/private/tmp/agjenti-c1-")) throw Error("Use a disposable C1 artifact directory");
  const css = readFileSync("src/components/agents/test-chat.css", "utf8");
  const views = {
    inactive: configuration,
    active: { ...configuration, agents: [{ ...configuration.agents[0], agentId: "active-other", agentName: "Other synthetic agent", active: true, instructionHash: "b".repeat(64), instructionSource: "active_agent" as const, fallbackReason: null, fallbackInstructionsUsed: false }] },
    failure: { ...configuration, responseSource: "fallback" as const, responseFallbackReason: "provider_error" },
  };
  for (const [name, view] of Object.entries(views)) {
    const content = renderToStaticMarkup(createElement("main", {},
      createElement("h1", {}, "C1 · Fixture sintetike UI, jo E2E me Auth/DB"),
      createElement(AgentInstructionNotice, { preview, slug: "synthetic" }),
      createElement("p", {}, configurationEffectMessage(effect)), createElement(AgentEffectObservation, { effect }),
      createElement(TestConfiguration, { configuration: view, slug: "synthetic", agentConfigured: name === "active" })));
    writeFileSync(`${directory}/${name}.html`, `<!doctype html><html lang="sq"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--line:#ddd;--surface:#fff;--ink:#202020;--ink-muted:#555;--accent:#126a4b}body{margin:0;background:var(--surface);color:var(--ink);font:14px system-ui}main{max-width:720px;padding:20px;margin:auto}h1{font-size:18px}a{color:var(--accent)}@media(prefers-color-scheme:dark){:root{--line:#444;--surface:#191919;--ink:#eee;--ink-muted:#aaa;--accent:#8cdaba}}${css}</style>${content}</html>`);
  }
});
