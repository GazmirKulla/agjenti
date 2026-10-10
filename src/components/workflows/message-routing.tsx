"use client";
import { useId } from "react";
import type { VisualTrace } from "@/lib/workflows/visual/types";
import "./visual-workflow.css";

/** Conversation view: the saved editor graph remains unchanged. Every turn returns to the message hub. */
export function MessageRoutingView({ trace }: { trace: VisualTrace }) {
  const marker = `message-${useId().replace(/:/g, "")}`;
  const groups = [
    {kind:"product",label:"Porosia"}, {kind:"collect",label:"Të dhënat"},
    {kind:"confirm",label:"Konfirmimi"}, {kind:"knowledge",label:"Informacioni"}, {kind:"handoff",label:"Stafi"},
  ].filter(group=>trace.graph.nodes.some(node=>node.kind===group.kind));
  const target = trace.graph.nodes.find(node=>node.id===(trace.routing?.to??trace.state.nodeId));
  const current = trace.graph.nodes.find(node=>node.id===trace.state.nodeId);
  const activeKind = trace.routing?.action === "answer" ? "knowledge" : (target?.kind === "condition" ? current?.kind : target?.kind);
  return <section className="vf-message-routing" aria-label="Mesazhi në qendër të rrjedhës">
    <p>Çdo mesazh zgjedh rrjedhën nga e para.</p>
    <svg viewBox="0 0 640 500" role="img" aria-label={`Mesazhi i ri → ${trace.routing?.action==="answer"?"Informacioni":target?.label??current?.label??"Vlerësim"}`}>
      <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse"><path d="M1 1 L6 3.5 L1 6" fill="none" stroke="currentColor" strokeWidth="1.5" /></marker></defs>
      <circle className="vf-message-orbit" cx="320" cy="250" r="178" />
      {groups.map((group,index)=>{
        const angle=-Math.PI/2+index*2*Math.PI/groups.length;
        const x=320+Math.cos(angle)*225,y=250+Math.sin(angle)*178;
        const selected=activeKind===group.kind;
        const nodes=trace.graph.nodes.filter(node=>node.kind===group.kind);
        const label=nodes.find(node=>node.id===target?.id)?.label??nodes[0]?.label??group.label;
        return <g key={group.kind} className={selected?"is-current":""}>
          <path className="vf-message-link" d={`M ${320+Math.cos(angle)*74} ${250+Math.sin(angle)*58} L ${x-Math.cos(angle)*64} ${y-Math.sin(angle)*38}`} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />
          <rect className="vf-message-step" x={x-86} y={y-34} width="172" height="68" rx="14" />
          <text x={x} y={y-6} textAnchor="middle" className="vf-message-title">{group.label}</text>
          <text x={x} y={y+17} textAnchor="middle" className="vf-message-detail">{label.length>23?`${label.slice(0,22)}…`:label}</text>
          <title>{nodes.map(node=>node.label).join(" · ")}</title>
        </g>;
      })}
      <ellipse className="vf-message-hub" cx="320" cy="250" rx="82" ry="60" />
      <text x="320" y="244" textAnchor="middle" className="vf-message-title">Mesazhi i ri</text>
      <text x="320" y="268" textAnchor="middle" className="vf-message-detail">Konteksti + kërkesa</text>
    </svg>
    <p aria-live="polite">{trace.routing?.action==="answer"?"Përgjigje informative · ecuria ruhet":`Hapi aktual: ${current?.label??"Vlerësim"}`}</p>
  </section>;
}
