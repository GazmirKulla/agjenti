"use client";

import { memo, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal/modal";
import { blockCaption, parseBlocks, type MetricsBlock, type TableBlock, type TableRow } from "@/lib/business-assistant/blocks";
import { richTextPlain, type Inline, type TextPart } from "@/lib/business-assistant/rich-text";
import "./message-blocks.css";

function Metrics({ block, slug }: { block: MetricsBlock; slug: string }) {
  return <section className="assistant-block" aria-label={block.title}>
    <h3>{block.title}</h3>
    <div className="assistant-block-metrics">{block.items.map((item, i) => {
      const href = item.href?.startsWith(`/b/${encodeURIComponent(slug)}/`) ? item.href : undefined;
      const content = <><span>{item.label}</span>
        {item.value === null ? <small>{item.note || "E padisponueshme"}</small> : <strong>{item.value}</strong>}
        {href && <span className="metric-arrow" aria-hidden="true">↗</span>}</>;
      return href ? <a key={i} href={href}>{content}</a> : <div key={i}>{content}</div>;
    })}</div>
    {block.note && <small>{block.note}</small>}
  </section>;
}

function Rows({ block, rows }: { block: TableBlock; rows: TableRow[] }) {
  return <div className="assistant-block-rows">
    <table aria-label={block.title}>
      <thead><tr>{block.columns.map(c => <th key={c.key} scope="col" data-numeric={c.numeric}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{block.columns.map(c =>
        <td key={c.key} data-numeric={c.numeric}>{row.cells[c.key] || "—"}</td>)}</tr>)}</tbody>
    </table>
    <ul aria-label={block.title}>{rows.map((row, i) => <li key={i}>
      <strong>{row.cells[block.columns[0].key] || "—"}</strong>
      <dl>{block.columns.slice(1).map(c => <div key={c.key}><dt>{c.label}</dt><dd>{row.cells[c.key] || "—"}</dd></div>)}</dl>
    </li>)}</ul>
  </div>;
}

function Results({ block }: { block: TableBlock }) {
  const [expanded, setExpanded] = useState(false);
  const count = block.total === null ? `${block.rows.length} rreshta` : `${block.total} rezultate`;
  const remainder = block.partial || (block.total !== null && block.total > block.rows.length);
  const note = [remainder && `Në këtë përgjigje janë përfshirë ${block.rows.length} rreshta.`, block.note].filter(Boolean).join(" ");
  return <section className="assistant-block" aria-label={block.title}>
    <header><h3>{block.title}</h3><small>{count}</small></header>
    {block.rows.length > 0 && <Rows block={block} rows={block.rows.slice(0, 5)} />}
    {note && <small>{note}</small>}
    {block.rows.length > 5 && <button type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)}>Shiko të gjitha ({block.rows.length}) →</button>}
    {expanded && <Modal title={block.title} subtitle={count} onClose={() => setExpanded(false)}>
      <Rows block={block} rows={block.rows} />{note && <p>{note}</p>}
    </Modal>}
  </section>;
}

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    if (typeof node === "string") return node;
    if ("strong" in node) return <strong key={i}>{inline(node.strong)}</strong>;
    return <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">{inline(node.label)}</a>;
  });
}

function paragraphs(parts: TextPart[]): ReactNode {
  return parts.map((part, i) => {
    if ("paragraph" in part) return <p key={i}>{inline(part.paragraph)}</p>;
    const items = part.items.map((item, n) => <li key={n}>{paragraphs(item)}</li>);
    return part.start === undefined ? <ul key={i}>{items}</ul> : <ol key={i} start={part.start}>{items}</ol>;
  });
}

export const AssistantMessageBody = memo(function AssistantMessageBody({ content, blocks, slug }: {
  content: string; blocks?: unknown; slug: string;
}) {
  const valid = parseBlocks(blocks);
  const rich = valid.find(block => block.type === "rich_text");
  const dataBlocks = valid.filter(block => block.type !== "rich_text");
  const caption = blockCaption(content, valid);
  return <>
    {rich && richTextPlain(rich.parts) === caption
      ? <div className="assistant-rich-text">{paragraphs(rich.parts)}</div>
      : caption && <p>{caption}</p>}
    {dataBlocks.map((block, i) => block.type === "metrics"
      ? <Metrics key={i} block={block} slug={slug} />
      : <Results key={i} block={block} />)}
  </>;
});
