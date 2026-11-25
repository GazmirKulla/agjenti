import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TestKnowledgeFocus, TestKnowledgeUsed } from "./test-knowledge";
import type { TestConfigurationProvenance } from "@/lib/agents/configuration-contract";

const knowledge = { k1: { title: "Dërgesa", active: true }, k2: { title: "Pagesat", active: true }, k3: { title: "Garancia", active: false } };
const read = (ids: string[], status = "complete", reason: string | null = null) => ({ agents: [], workflow: { id: null, versionId: null, mode: "unavailable" }, knowledge: { ids, status, reason },
  responseSource: "ai", responseFallbackReason: null, behaviorVerified: false }) as TestConfigurationProvenance;
const html = (props: Parameters<typeof TestKnowledgeUsed>[0]) => renderToStaticMarkup(createElement(TestKnowledgeUsed, props));

it("says the tested entry was read, lists what was read and links each back for correction", () => {
  const out = html({ slug: "shop", configuration: read(["k1", "k2"]), knowledge, focus: "k1" });
  expect(out).toContain("“Dërgesa” u përzgjodh");
  expect(out).toContain("nuk provon");
  expect(out).toContain('href="/b/shop/knowledge?entry=k2"');
  expect(out).toContain('href="/b/shop/agents"');
});

it("never presents an active entry as used when the reply did not read it", () => {
  const out = html({ slug: "shop", configuration: read(["k2"]), knowledge, focus: "k1" });
  expect(out).toContain("“Dërgesa” nuk u përzgjodh");
  expect(out).not.toContain("u përzgjodh në informacionin");
});

it("says nothing was confirmed when the turn carries no knowledge read", () => {
  expect(html({ slug: "shop", configuration: undefined, knowledge, focus: "k1" })).toContain("Nuk u konfirmua");
  expect(html({ slug: "shop", configuration: undefined, knowledge })).toBe("");
});

it("tells the owner a switched-off entry is not read", () => {
  const out = renderToStaticMarkup(createElement(TestKnowledgeFocus, { slug: "shop", id: "k3", knowledge }));
  expect(out).toContain("Është e fikur");
});

it("says a failed read failed, never that the entry was not selected", () => {
  for (const configuration of [read([], "partial", "semantic_context_unavailable"), read([], "unavailable")]) {
    const out = html({ slug: "shop", configuration, knowledge, focus: "k1" });
    expect(out).toContain("Leximi i njohurive dështoi");
    expect(out).not.toContain("nuk u përzgjodh");
  }
});

it("names the profile sections given to a reply with Ndrysho këtu to each field, and tells a failed read from an empty profile", async () => {
  const { TestProfileUsed } = await import("./test-knowledge");
  const render = (profile: TestConfigurationProvenance["profile"], profileHref?: string) => renderToStaticMarkup(createElement(TestProfileUsed, { slug: "shop", profileHref, configuration: { ...read([]), profile } }));
  const out = render({ sections: ["hours", "location"], status: "complete" }, "");
  expect(out).toContain('href="#profile-hours"'); expect(out).toContain("Ndrysho këtu");
  expect(render({ sections: ["hours"], status: "complete" })).toContain('href="/b/shop/agents/business#profile-hours"');
  expect(render({ sections: [], status: "unavailable" })).toContain("dështoi");
  expect(render({ sections: [], status: "complete" })).toContain("nuk thotë ende");
});

it("links each presented product and service to its own editor and back to the topic", async () => {
  const { TestCatalogUsed } = await import("./test-knowledge");
  const out = renderToStaticMarkup(createElement(TestCatalogUsed, { slug: "shop", returnTo: "agents/orders",
    products: [{ id: "p1", name: "Puzzle" }], services: [{ id: "s1", name: "Konsulta" }] }));
  expect(out).toContain('href="/b/shop/products/p1?edit=1&amp;nga=agents%2Forders"');
  expect(out).toContain('href="/b/shop/services?edit=s1&amp;nga=agents%2Forders"');
  expect(renderToStaticMarkup(createElement(TestCatalogUsed, { slug: "shop" }))).toBe("");
});

it("says what was only simulated, unverified or blocked, and leaves internal plumbing out", async () => {
  const { TestActionsUsed } = await import("./test-knowledge");
  const out = renderToStaticMarkup(createElement(TestActionsUsed, { actions: [
    { kind: "booking.create", disposition: "SIMULATED" }, { kind: "order.create", disposition: "BLOCKED" }, { kind: "provider.http", disposition: "SIMULATED" }] }));
  expect(out).toContain("Krijimi i rezervimit: u simulua");
  expect(out).toContain("Regjistrimi i porosisë: u bllokua");
  expect(out).not.toContain("provider");
  expect(out).toContain("nuk krijon porosi, rezervime ose mesazhe reale");
  expect(renderToStaticMarkup(createElement(TestActionsUsed, { actions: [{ kind: "webhook", disposition: "SIMULATED" }] }))).toBe("");
});
