import type { ReactNode } from "react";

/**
 * A knowledge entry as it was written: the light Markdown the sources and the owner use (headings "#",
 * "- " lists, "1. " steps, "| … |" tables, **bold** labels), rendered as React elements, never as HTML.
 * Plain text shows its own line breaks.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
const cells = (line: string) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());

export function KnowledgeText({ text, format }: { text: string; format?: string | null }) {
  if (format !== "markdown") return <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</p>;
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { blocks.push(<p key={i} style={{ margin: "8px 0 2px", fontWeight: 600 }}>{inline(heading[2])}</p>); i++; continue; }
    const group = (test: RegExp) => { const items: string[] = []; while (i < lines.length && test.test(lines[i].trim())) items.push(lines[i++].trim()); return items; };
    if (/^[-*•]\s+/.test(line)) { const items = group(/^[-*•]\s+/); blocks.push(<ul key={i} style={{ margin: "4px 0", paddingLeft: 20, listStyle: "disc" }}>{items.map((item, j) => <li key={j}>{inline(item.replace(/^[-*•]\s+/, ""))}</li>)}</ul>); continue; }
    if (/^\d+[.)]\s+/.test(line)) { const items = group(/^\d+[.)]\s+/); blocks.push(<ol key={i} style={{ margin: "4px 0", paddingLeft: 20, listStyle: "decimal" }}>{items.map((item, j) => <li key={j}>{inline(item.replace(/^\d+[.)]\s+/, ""))}</li>)}</ol>); continue; }
    if (line.startsWith("|")) {
      const rows = group(/^\|/).map(cells).filter(row => !row.every(cell => /^:?-{2,}:?$/.test(cell) || !cell));
      blocks.push(<div key={i} style={{ overflowX: "auto", margin: "4px 0" }}><table className="data-table"><tbody>{rows.map((row, j) => <tr key={j}>{row.map((cell, k) => j === 0 && rows.length > 1 ? <th key={k}>{inline(cell)}</th> : <td key={k}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const paragraph = group(/^(?![-*•]\s|\d+[.)]\s|\||#{1,4}\s).+/);
    blocks.push(<p key={i} style={{ margin: "4px 0" }}>{paragraph.map((p, j) => <span key={j}>{j > 0 && <br />}{inline(p)}</span>)}</p>);
  }
  return <div>{blocks}</div>;
}

/** One line for lists and previews: the words without the Markdown marks. */
export function knowledgePreview(text: string) {
  return text.replace(/^#{1,4}\s+/gm, "").replace(/^[-*•]\s+|^\d+[.)]\s+/gm, "").replace(/\|/g, " ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}
