import { describe, expect, it } from "vitest";
import { htmlToStructuredText } from "./structured-text";

describe("a web page read with its structure", () => {
  it("keeps headings, lists, price tables and paragraphs instead of one long line", () => {
    const html = `<html><head><title>x</title><style>.a{}</style></head><body><nav><a>Kreu</a></nav>
      <h1>Dërgesa</h1><p>Dërgojmë në   të gjithë Shqipërinë.</p>
      <ul><li>Tiranë: 1 ditë</li><li>Rrethe: 2–3 ditë</li></ul>
      <h2>Çmimet</h2><table><tr><th>Produkti</th><th>Çmimi</th></tr><tr><td>Libri</td><td>790 Lekë</td></tr></table>
      <p>Pagesa&nbsp;në dorëzim &amp; me kartë.<br>Kthimi brenda 14 ditëve.</p><script>alert(1)</script></body></html>`;
    expect(htmlToStructuredText(html)).toBe([
      "Kreu", "", "## Dërgesa", "", "Dërgojmë në të gjithë Shqipërinë.", "- Tiranë: 1 ditë", "- Rrethe: 2–3 ditë", "",
      "### Çmimet", "", "| Produkti | Çmimi |", "| Libri | 790 Lekë |", "Pagesa në dorëzim & me kartë.", "Kthimi brenda 14 ditëve.",
    ].join("\n"));
  });
  it("drops scripts, comments and empty markup", () => {
    expect(htmlToStructuredText("<div><!-- x --><script>var a</script><li></li><table><tr><td></td></tr></table></div>")).toBe("");
  });
});
