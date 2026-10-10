"use client";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Icon } from "@/components/dashboard/icon";
import { nodeLabels, outputPorts } from "@/lib/workflows/visual/model";
import type { VisualGraph, VisualNode, VisualNodeKind } from "@/lib/workflows/visual/types";
import "./visual-workflow.css";

export const nodeIcons: Record<VisualNodeKind, string> = {
  start: "inbox", condition: "workflows", knowledge: "knowledge", order_status: "search", collect: "orders",
  confirm: "check", product: "products", booking: "calendar", handoff: "customers", end: "finish",
};
export function FlowIcon({ kind, size = 20 }: { kind: VisualNodeKind; size?: number }) {
  if (kind === "confirm" || kind === "end") return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "end" ? <><circle cx="12" cy="12" r="8" /><path d="m8 12 3 3 5-6" /></> : <path d="m5 12 4 4L19 6" />}</svg>;
  return <Icon name={nodeIcons[kind]} size={size} />;
}
const W = 224, H = 100;
type Props = {
  graph: VisualGraph; currentNodeId?: string; visitedNodeIds?: string[]; traversedNodeIds?: string[];
  selectedNodeId?: string; onSelect?: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
  invalidNodeIds?: string[]; compact?: boolean;
};
export function VisualGraphView({ graph, currentNodeId, visitedNodeIds = [], traversedNodeIds = [], selectedNodeId, onSelect, onMove, invalidNodeIds = [], compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const markerId = useId().replace(/:/g, "");
  const [view, setView] = useState({ x: 30, y: 30, scale: .7 });
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ id?: string; x: number; y: number; originX: number; originY: number } | null>(null);
  const fit = useCallback(() => {
    const el = container.current;
    if (!el || !graph.nodes.length) return;
    const minX = Math.min(...graph.nodes.map(n => n.position.x)), minY = Math.min(...graph.nodes.map(n => n.position.y));
    const width = Math.max(...graph.nodes.map(n => n.position.x)) - minX + W;
    const height = Math.max(...graph.nodes.map(n => n.position.y)) - minY + H;
    const scale = Math.max(.2, Math.min(compact ? .75 : 1, (el.clientWidth - 70) / width, (el.clientHeight - 140) / height));
    setView({ scale, x: (el.clientWidth - width * scale) / 2 - minX * scale, y: (el.clientHeight - height * scale) / 2 - minY * scale });
  }, [graph.nodes, compact]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const resize = new ResizeObserver(() => fitRef.current());
    if (container.current) resize.observe(container.current);
    return () => resize.disconnect();
  }, []);
  useEffect(() => { fitRef.current(); }, [graph.nodes.length]);
  const position = (node: VisualNode) => moving?.id === node.id ? moving : node.position;
  const isVertical = (source: VisualNode, target: VisualNode) => position(target).y > position(source).y + H + 30 && Math.abs(position(target).x - position(source).x) < W / 2;
  function begin(event: PointerEvent<HTMLElement>, node?: VisualNode) {
    if (event.button !== 0) return;
    if (node) { onSelect?.(node.id); if (!onMove) return; }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: node?.id, x: event.clientX, y: event.clientY, originX: node?.position.x ?? view.x, originY: node?.position.y ?? view.y };
  }
  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    if (g.id) setMoving({ id: g.id, x: Math.max(-4000, Math.min(4000, g.originX + (event.clientX - g.x) / view.scale)), y: Math.max(-4000, Math.min(4000, g.originY + (event.clientY - g.y) / view.scale)) });
    else setView(v => ({ ...v, x: g.originX + event.clientX - g.x, y: g.originY + event.clientY - g.y }));
  }
  function finish() {
    if (moving) onMove?.(moving.id, { x: Math.round(moving.x / 10) * 10, y: Math.round(moving.y / 10) * 10 });
    gesture.current = null; setMoving(null);
  }
  function zoom(factor: number) {
    const el = container.current;
    if (!el) return;
    setView(v => {
      const scale = Math.max(.2, Math.min(1.6, v.scale * factor)), ratio = scale / v.scale;
      return { scale, x: el.clientWidth / 2 - (el.clientWidth / 2 - v.x) * ratio, y: el.clientHeight / 2 - (el.clientHeight / 2 - v.y) * ratio };
    });
  }
  const bounds = {
    x: Math.min(0, ...graph.nodes.map(node => node.position.x)) - 40,
    y: Math.min(0, ...graph.nodes.map(node => node.position.y)) - 40,
    right: Math.max(W, ...graph.nodes.map(node => node.position.x + W)) + 40,
    bottom: Math.max(H, ...graph.nodes.map(node => node.position.y + H)) + 40,
  };
  return <div className={`vf-canvas ${compact ? "vf-compact" : ""}`} ref={container} onPointerDown={e => { if (e.target === e.currentTarget) begin(e); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setMoving(null); }}>
    {compact && <div className="vf-canvas-label"><span className="vf-live-dot" />{currentNodeId ? "Rruga e bisedës" : "Rrjedha e klientit"}</div>}
    <div className="vf-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
      <svg className="vf-connections" width="1" height="1" aria-hidden="true"><defs><marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M1 1 L6 3.5 L1 6" fill="none" stroke="context-stroke" strokeWidth="1.5" /></marker></defs>
        {graph.edges.map(edge => {
          const source = graph.nodes.find(n => n.id === edge.source), target = graph.nodes.find(n => n.id === edge.target);
          if (!source || !target) return null;
          const s = position(source), t = position(target);
          const vertical = isVertical(source, target);
          const sx = s.x + (vertical ? W / 2 : W), sy = s.y + (vertical ? H : edge.port === "yes" ? 35 : edge.port === "no" ? 75 : H / 2), tx = t.x + (vertical ? W / 2 : 0), ty = t.y + (vertical ? 0 : H / 2);
          const bend = Math.max(35, Math.abs(vertical ? ty - sy : tx - sx) * .5);
          const path = vertical ? `M${sx},${sy} C${sx},${sy + bend} ${tx},${ty - bend} ${tx},${ty}` : `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`;
          const active = traversedNodeIds.some((id, index) => id === edge.source && traversedNodeIds[index + 1] === edge.target);
          return <g key={edge.id} className={`vf-edge ${active ? "is-traversed" : ""}`}><path d={path} markerEnd={`url(#${markerId})`} />{active && <path d={path} className="vf-edge-motion" />}{edge.port !== "next" && <g transform={`translate(${sx + (vertical ? 0 : 32)},${sy + (vertical ? 28 : 0)})`}><rect x="-17" y="-11" width="34" height="22" rx="11" /><text textAnchor="middle" dominantBaseline="central">{edge.port === "yes" ? "Po" : "Jo"}</text></g>}</g>;
        })}
      </svg>
      {graph.nodes.map(node => {
        const p = position(node), current = currentNodeId === node.id, selected = selectedNodeId === node.id;
        return <button type="button" key={node.id} className={`vf-node vf-kind-${node.kind} ${selected ? "is-selected" : ""} ${current ? "is-current" : ""} ${visitedNodeIds.includes(node.id) ? "is-visited" : ""} ${invalidNodeIds.includes(node.id) ? "is-invalid" : ""}`}
          style={{ left: p.x, top: p.y, width: W, height: H }} aria-label={`${node.label} · ${nodeLabels[node.kind]}`} aria-pressed={selected}
          onPointerDown={e => begin(e, node)} onClick={() => onSelect?.(node.id)} onKeyDown={e => {
            if (onMove && e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault(); onMove(node.id, { x: p.x + (e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0), y: p.y + (e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0) });
            }
          }}>
          {node.kind !== "start" && <>
            <i className="vf-port vf-port-in" />
            {graph.edges.some(e => e.target === node.id && graph.nodes.some(s => s.id === e.source && isVertical(s, node))) && <i className="vf-port vf-port-top" />}
          </>}
          <span className="vf-node-top"><span className="vf-node-icon"><FlowIcon kind={node.kind} size={18} /></span><span>{nodeLabels[node.kind]}</span>{current && <span className="vf-node-pulse" />}</span>
          <strong>{node.label}</strong>
          {outputPorts(node.kind).map(port => {
            const target = graph.nodes.find(n => n.id === graph.edges.find(e => e.source === node.id && e.port === port)?.target);
            return <i key={port} className={`vf-port vf-port-${port} ${target && isVertical(node, target) ? "vf-port-bottom" : ""}`} />;
          })}
        </button>;
      })}
    </div>
    <div className="vf-canvas-tools" onPointerDown={e => e.stopPropagation()}><button type="button" aria-label="Zvogëlo diagramin" onClick={() => zoom(.8)}>−</button><span>{Math.round(view.scale * 100)}%</span><button type="button" aria-label="Zmadho diagramin" onClick={() => zoom(1.25)}>+</button><span className="vf-tool-divider" /><button type="button" onClick={fit} aria-label="Shfaq të gjithë diagramin"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5" /></svg></button></div>
    {!compact && <><span className="vf-canvas-hint">Tërhiq për të lëvizur · Zgjidh një hap</span><button type="button" className="vf-minimap" aria-label="Përshtat diagramin në ekran" title="Kliko për të shfaqur të gjithë diagramin" onPointerDown={event => event.stopPropagation()} onClick={fit}>
      <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.right - bounds.x} ${bounds.bottom - bounds.y}`} aria-hidden="true">{graph.edges.map(edge => {
        const source = graph.nodes.find(node => node.id === edge.source), target = graph.nodes.find(node => node.id === edge.target);
        return source && target ? <line key={edge.id} x1={source.position.x + W / 2} y1={source.position.y + H / 2} x2={target.position.x + W / 2} y2={target.position.y + H / 2} /> : null;
      })}{graph.nodes.map(node => <rect key={node.id} className={node.id === selectedNodeId || node.id === currentNodeId ? "is-active" : ""} x={node.position.x} y={node.position.y} width={W} height={H} rx={14} />)}</svg>
    </button></>}
  </div>;
}
