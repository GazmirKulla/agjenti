"use client";
import { Modal } from "@/components/modal/modal";
import { useId, useState } from "react";
import { readChart, type ChartData } from "@/lib/charts/model";
import "./data-chart.css";

const colors = ["var(--accent)", "var(--ink-muted)", "var(--danger)", "var(--warning)", "var(--success)", "var(--line-strong)"];
const shown = (value: number | null) => value === null ? "E padisponueshme" : value.toLocaleString("sq-AL");
/** One renderer for pages and saved Assistant blocks. No fetching, authorization or business logic. */
export function DataChart({ data, compact = false, expandable = true }: { data: ChartData; compact?: boolean; expandable?: boolean }) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const chart = readChart(data);
  if (!chart) return <p role="status">Grafiku nuk disponohet.</p>;
  const { categories, series } = chart;
  const palette = series.map((s, i) => s.tone ? `var(--${s.tone === "muted" ? "ink-muted" : s.tone})` : colors[i]);
  const n = categories.length;
  const values = series.flatMap(s => s.values).filter((v): v is number => v !== null);
  const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...(chart.kind === "stacked" ? totals : values));
  const left = 52, right = 712, top = 20, base = 200, step = (right - left) / Math.max(n, 1);
  const x = (i: number) => left + step * (i + .5);
  const y = (v: number) => base - (v / max) * (base - top);
  const selectedIndex = categories.findIndex(c => c.key === selected);
  const detail = selectedIndex < 0 ? null : `${categories[selectedIndex].label}: ${series.map(s => `${s.label} ${shown(s.values[selectedIndex])}`).join(" · ")}`;
  const summary = !n ? "Asnjë e dhënë në këtë periudhë." : !values.length ? "Të dhënat nuk disponohen për këtë periudhë." : values.every(v => v === 0) ? "Asnjë aktivitet i regjistruar në këtë periudhë." : null;
  return <section className={`data-chart${compact ? " data-chart-compact" : ""}`} aria-label={chart.title}>
    {!compact && <header><strong>{chart.title}</strong>{expandable && <button type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)}>Zgjero</button>}</header>}
    {chart.timezone && !compact && <small>Zona kohore: {chart.timezone}</small>}
    <div className="data-chart-legend">{series.map((s, i) => <span key={s.key}><i style={{ background: palette[i] }} aria-hidden="true" />{s.label}</span>)}</div>
    {summary && <p role="status">{summary}</p>}
    {n > 0 && values.length > 0 && <svg viewBox="0 0 740 240" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>{chart.title}</title>
      {[0, 1, 2, 3, 4].map(t => <g key={t}><line x1={left} x2={right} y1={y(max * t / 4)} y2={y(max * t / 4)} stroke="var(--line)" /><text x={left - 8} y={y(max * t / 4) + 4} textAnchor="end">{Number((max * t / 4).toFixed(2))}</text></g>)}
      {chart.kind === "line" && series.map((s, si) => {
        // Missing values break the path rather than implying zero or continuity.
        let previous = false;
        const path = s.values.map((v, i) => {
          if (v === null) { previous = false; return ""; }
          const command = previous ? "L" : "M"; previous = true;
          return `${command}${x(i)},${y(v)}`;
        }).join(" ");
        return <g key={s.key}><path d={path} stroke={palette[si]} strokeWidth="2.5" fill="none" />{s.values.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={n > 90 ? 1.5 : 3} fill={palette[si]} />)}</g>;
      })}
      {categories.map((c, i) => {
        let stacked = 0;
        const description = `${c.label}: ${series.map(s => `${s.label} ${shown(s.values[i])}`).join(" · ")}`;
        return <g key={c.key} onPointerEnter={() => !compact && setSelected(c.key)}>
          <title>{description}</title>
          {chart.kind !== "line" && series.map((s, si) => {
            const value = s.values[i];
            const bottom = stacked; stacked += value ?? 0;
            const width = step * .7 / (chart.kind === "bar" ? series.length : 1);
            return value === null || value === 0 ? null : <rect key={s.key} x={x(i) - step * .35 + (chart.kind === "bar" ? si * width : 0)} y={y(chart.kind === "stacked" ? stacked : value)} width={Math.max(.5, width - 1)} height={y(chart.kind === "stacked" ? bottom : 0) - y(chart.kind === "stacked" ? stacked : value)} fill={palette[si]} />;
          })}
          <rect x={left + i * step} y={top} width={step} height={base - top} fill="transparent" />
          {(i === 0 || i === n - 1 || i % Math.max(1, Math.ceil(n / 7)) === 0) && <text x={x(i)} y={224} textAnchor="middle">{c.label}</text>}
        </g>;
      })}
    </svg>}
    {!compact && n > 0 && <><label className="data-chart-picker">Shiko vlerat <select value={selectedIndex < 0 ? "" : selected ?? ""} onChange={e => setSelected(e.target.value)}><option value="">Zgjidh një pikë</option>{categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label><p className="data-chart-detail" aria-live="polite">{detail ?? "Zgjidh një pikë për të parë vlerat."}</p>
      <details><summary>Shiko si tabelë</summary><div className="data-chart-table" tabIndex={0} role="region" aria-label={`${chart.title}: të dhënat`}><table><caption>{chart.title}</caption><thead><tr><th scope="col">Periudha / kategoria</th>{series.map(s => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead><tbody>{categories.map((c, i) => <tr key={c.key}><th scope="row">{c.label}</th>{series.map(s => <td key={s.key}>{shown(s.values[i])}</td>)}</tr>)}</tbody></table></div></details></>}
    {chart.note && <small>{chart.note}</small>}
    {expanded && <Modal title={chart.title} size="lg" onClose={() => setExpanded(false)}><DataChart data={chart} expandable={false} /></Modal>}
  </section>;
}
