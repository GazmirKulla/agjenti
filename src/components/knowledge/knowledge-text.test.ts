import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KnowledgeText, knowledgePreview } from "./knowledge-text";
import { knowledgeSourceLabel } from "@/lib/knowledge/context";

const text = "## Dërgesa\nDërgojmë kudo.\n- Tiranë: 1 ditë\n- Rrethe: **2–3 ditë**\n\n| Produkti | Çmimi |\n| --- | --- |\n| Libri | 790 Lekë |\n1. Zgjidh\n2. Paguaj";

describe("knowledge shown as it was written", () => {
  it("renders headings, lists, tables and steps, never raw HTML", () => {
    const html = renderToStaticMarkup(createElement(KnowledgeText, { text: `${text}\n<script>x</script>`, format: "markdown" }));
    expect(html).toContain("<ul");
    expect(html).toContain("<strong>2–3 ditë</strong>");
    expect(html).toContain("<th>Produkti</th>");
    expect(html).toContain("<td>790 Lekë</td>");
    expect(html).not.toContain("---");
    expect(html).toContain("<ol");
    expect(html).not.toContain("<script>");
  });
  it("keeps the line breaks of plain text and gives a one-line preview", () => {
    expect(renderToStaticMarkup(createElement(KnowledgeText, { text: "a\nb" }))).toContain("pre-wrap");
    expect(knowledgePreview(text)).toBe("Dërgesa Dërgojmë kudo. Tiranë: 1 ditë Rrethe: 2–3 ditë Produkti Çmimi --- --- Libri 790 Lekë Zgjidh Paguaj");
  });
  it("says where an entry came from and when the owner changed it", () => {
    expect(knowledgeSourceLabel({ kind: "website", capturedAt: "2026-11-18T10:00:00Z" }, "2026-11-19T10:00:00Z")).toMatch(/^Nga faqja e webit · .+ · ndryshuar nga ti .+/);
    expect(knowledgeSourceLabel(null)).toBe("Burim i panjohur");
  });
});
