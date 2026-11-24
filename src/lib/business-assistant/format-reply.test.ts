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

const reportedTable = "Tabela e plotë me 18 produktet:\n\n| Produkti | Çmimi | Njësia | Gjatësia | Trashësia | Informacion shtesë |\n|---|---:|---|---|---|---|\n| Dërrasa Lis Amerikan | Sipas kërkesës | — | Sipas kërkesës | Sipas kërkesës | Çmimi dhe përmasat sipas kërkesës |\n| Dërrasa Lis | 70.000–80.000 ALL | m³ | 2, 3, 4 m | 3, 5, 7, 10 cm | Për tavolina dhe punime të tjera; gjerësia ndryshon |\n| Dërrasa Frashër | 70.000–80.000 ALL | m³ | 2, 3, 4 m | 3, 5, 7 cm | Për tavolina |\n| Dërrasa Iroko | 1.400 ALL | — | Sipas kërkesës | Sipas kërkesës | Çmimi dhe përmasat sipas kërkesës |\n| Binare | Sipas kërkesës | — | 1 m | — | Përmasa e seksionit: 5x5, 6x6, 7x7, 8x8, 10x10 cm |\n| Dërrasa Arrë | 80.000–90.000 ALL | m³ | 1, 2, 3, 4 m | 3, 5, 7, 10 cm | — |\n| Dërrasa Pishë - E vendit | 35.000–40.000 ALL | m³ | 2, 3, 4 m | 3, 5 cm | — |\n| Dërrasa Ajus (Ayous) | Sipas kërkesës | — | Sipas kërkesës | Sipas kërkesës | Çmimi dhe përmasat sipas kërkesës |\n| Dërrasa Qershi | 65.000–80.000 ALL | m³ | 2 m | 3, 5 cm | — |\n| Dërrasa Bredh - I pastër | 48.000–52.000 ALL | m³ | 2, 3, 4, 5 m | 3, 5, 8 cm | — |\n| Dërrasa Pishë - E jashtme | 45.000–55.000 ALL | m³ | 2, 3, 4 m | 3, 5 cm | — |\n| Dërrasa Gështenjë | 70.000–80.000 ALL | m³ | 2, 3 m | 5 cm | — |\n| Ekuilip | Sipas kërkesës | — | Sipas kërkesës | Sipas kërkesës | Çmimi dhe përmasat nuk janë përcaktuar |\n| Rrathë për Tavolina | 4.000–8.000 ALL | copë | — | — | Përmasa të tjera nuk janë të specifikuara |\n| Dërrasa Ah | 30.000–33.000 ALL | m³ | 2, 2.5, 3, 4 m | 3, 5, 7, 10 cm | — |\n| Dërrasa Bredh - Tamburat | 33.000–37.000 ALL | m³ | 2, 3, 4, 5 m | 3, 5, 8 cm | — |\n| Dërrasa Plep | 33.000–35.000 ALL | m³ | Nuk është specifikuar | 5, 7 cm | — |\n| Binare për Çati | 30.000–33.000 ALL | m³ | 4, 5, 7 m | — | — |\n\nPër produktet me çmim ose përmasa sipas kërkesës, të dhënat duhet të konfirmohen për rastin konkret.";

it("renders the reported 18 products in new and historical replies, without creating verified data blocks", () => {
  const reply = formatOwnerReply(reportedTable);
  const blocks = parseBlocks(JSON.parse(JSON.stringify(reply.blocks)));
  expect(blocks.map(b => b.type)).toEqual(["rich_text"]);
  for (const [content, stored] of [[reply.message, blocks], [reportedTable, undefined],
    [reportedTable, [{ type: "rich_text", version: 1, parts: [{ paragraph: [reportedTable] }] }]]] as const) {
    const html = render(content, stored);
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.match(/<tr>/g)).toHaveLength(19);
    expect(html.match(/<th /g)).toHaveLength(6);
    expect(html).toContain("Dërrasa Lis Amerikan");
    expect(html).toContain("Binare për Çati");
    expect(html).toContain("Për produktet me çmim ose përmasa sipas kërkesës");
    expect(html).not.toContain("|---|");
  }
  expect(reply.message).toContain("Binare për Çati");
});

it("preserves escaped pipes, empty cells, alignment and safe formatting alongside server tables", () => {
  const source = "**Detajet**\n\n| Produkti | Çmimi | Shënim |\n| :--- | ---: | :---: |\n| **A\\|B** | 12 | |\n| <script>alert(1)</script> | 2 | [keq](javascript:alert%281%29) |";
  const reply = formatOwnerReply(source, [table]);
  const html = render(reply.message, reply.blocks);
  expect(html).toContain("<strong>A|B</strong>");
  expect(html).toContain('text-align:right');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('<table aria-label="Katalogu">');
  expect(render(reply.message)).toContain('A|B');
});

it("keeps unsupported or oversized tables as readable text instead of dropping rows", () => {
  const source = "| A | B |\n| --- | --- |\n" + Array.from({length: 61}, (_, i) => `| R${i} | 1 |`).join("\n");
  const reply = formatOwnerReply(source);
  expect(reply.message).toBe(source);
  expect(render(reply.message, reply.blocks)).toContain('R60');
  expect(render(reply.message, reply.blocks)).not.toContain('<table>');
  expect(render("```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```")).not.toContain('<table>');
  expect(parseBlocks([{type: "rich_text", version: 1, parts: [{table: [[["A"]], [["B"], ["C"]]], align: [null]}]}])).toEqual([]);
});
