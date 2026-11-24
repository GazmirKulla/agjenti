import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AssistantMessageBody } from "@/components/business-assistant/message-blocks";
import { parseBlocks, type TableBlock } from "./blocks";
import { formatOwnerReply } from "./format-reply";

const table: TableBlock = { type: "table", version: 1, title: "Katalogu", columns: [{ key: "name", label: "Emri" }],
  rows: [{ cells: { name: "Lis" } }], total: 1, partial: false };
function render(content: string, blocks?: unknown) {
  return renderToStaticMarkup(createElement(AssistantMessageBody, { slug: "demo", content, blocks }));
}

it("restores semantic paragraphs and nested lists beside a search table, with a readable copy", () => {
  const source = "**Dy hapa**\n\n3. Verifiko [katalogun](https://example.test/lista).\n   - Kontrollo stokun.\n4. Konfirmo.";
  const reply = formatOwnerReply(source, [table]);
  const blocks = parseBlocks(JSON.parse(JSON.stringify(reply.blocks)));
  expect(blocks.map(block => block.type)).toEqual(["rich_text", "table"]);
  expect(reply.message).toContain("3. Verifiko katalogun (https://example.test/lista).");
  expect(reply.message).toContain("• Kontrollo stokun.");
  expect(reply.message).toContain("4. Konfirmo.");
  expect(reply.message).not.toContain("**");
  const html = render(reply.message, blocks);
  expect(html).toContain('<p><strong>Dy hapa</strong></p>');
  expect(html).toContain('<ol start="3">');
  expect(html).toContain('<ul><li><p>Kontrollo stokun.</p></li></ul>');
  expect(html).toContain('href="https://example.test/lista"');
  expect(html).toContain('<table aria-label="Katalogu">');
  expect(html).not.toContain('Katalogu (1)');
  expect(html.match(/Dy hapa/g)).toHaveLength(1);
  expect(render(reply.message, blocks.slice(1))).toContain("3. Verifiko katalogun (https://example.test/lista).");
});

it("keeps historical text and damaged or mismatched presentations readable", () => {
  expect(formatOwnerReply("Po, patjetër.")).toEqual({ message: "Po, patjetër." });
  expect(render("**Vlera e ruajtur**")).toBe("<p>**Vlera e ruajtur**</p>");
  const reply = formatOwnerReply("Totali **42**");
  for (const raw of [undefined, [{ type: "rich_text", version: 2, parts: [] }],
    [{ type: "rich_text", version: 1, parts: [{ paragraph: [{ href: "ftp://example.test", label: ["42"] }] }] }]]) {
    expect(render(reply.message, raw)).toBe("<p>Totali 42</p>");
  }
  expect(render("Totali 12", reply.blocks)).toBe("<p>Totali 12</p>");
});

it("renders HTML literally and keeps unsupported link and image destinations inactive", () => {
  const reply = formatOwnerReply("**Lexo** <b>këtu</b>, [Arkivin](ftp://example.test) dhe ![pamje](https://example.test/foto).");
  const html = render(reply.message, reply.blocks);
  expect(html).toContain("&lt;b&gt;këtu&lt;/b&gt;");
  expect(html).toContain("Arkivin");
  expect(html).not.toMatch(/<a\b|<img\b/);
});

it("preserves the plain caption and all server tables when they fill the block limit", () => {
  const reply = formatOwnerReply("**Katër** grupe", Array(4).fill(table));
  expect(reply.blocks?.map(block => block.type)).toEqual(Array(4).fill("table"));
  expect(reply.message).toMatch(/^Katër grupe\n/);
});
