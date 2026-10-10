import type { BusinessProcess } from "@/lib/discovery/business-process";
import type { VisualGraph, VisualGraphV2, VisualFlow, VisualFlowKind, VisualNodeKind, VisualPort } from "./types";
export const nodeLabels: Record<VisualNodeKind, string> = { start: "Mesazh i ri", condition: "Kusht", knowledge: "Përgjigje nga njohuritë", order_status: "Statusi i porosisë", collect: "Kërko të dhëna", confirm: "Konfirmim", product: "Produkti i porosisë", booking: "Rezervim", handoff: "Kalo te stafi", end: "Përfundim" };
export function outputPorts(kind: VisualNodeKind): VisualPort[] { return kind === "condition" || kind === "confirm" ? ["yes", "no"] : kind === "handoff" || kind === "end" ? [] : ["next"]; }
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const fieldPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;
const bindingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badKeys = new Set(["__proto__", "prototype", "constructor"]);
export function normalizeVisualDraft(raw: unknown): VisualGraph | null {
  if (!raw || typeof raw !== "object" || new TextEncoder().encode(JSON.stringify(raw)).length > 100000) return null;
  const g = raw as VisualGraph;
  if (![1, 2].includes(g.version) || typeof g.name !== "string" || !g.name.trim() || g.name.length > 120 || !Array.isArray(g.nodes) || !g.nodes.length || g.nodes.length > 32 || !Array.isArray(g.edges) || g.edges.length > 64) return null;
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== "string" || !idPattern.test(n.id) || badKeys.has(n.id) || ids.has(n.id) || !Object.hasOwn(nodeLabels,n.kind) || typeof n.label !== "string" || n.label.length > 100 || !n.position || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y) || Math.abs(n.position.x)>5000 || Math.abs(n.position.y)>5000 || !n.config || typeof n.config !== "object" || Array.isArray(n.config)) return null;
    ids.add(n.id);
    if (g.version === 1 && (n.kind === "booking" || n.kind === "order_status")) return null;
    const c=n.config;
    if ((c.prompt !== undefined && (typeof c.prompt !== "string" || c.prompt.length>1500)) || (c.fieldKey !== undefined && (typeof c.fieldKey !== "string" || c.fieldKey.length>60 || badKeys.has(c.fieldKey))) || (c.value !== undefined && (typeof c.value !== "string" || c.value.length>300))) return null;
    if (c.fieldType !== undefined && !["text","email","phone","number","photo"].includes(c.fieldType)) return null;
    if (c.condition !== undefined && !["intent_order","intent_support","field_present","field_equals",...(g.version === 2 ? ["intent_booking"] : [])].includes(c.condition)) return null;
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (!e || typeof e.id !== "string" || !idPattern.test(e.id) || edgeIds.has(e.id) || !ids.has(e.source) || !ids.has(e.target) || !["next","yes","no"].includes(e.port)) return null;
    edgeIds.add(e.id);
  }
  if (g.version === 2) {
    if (!Array.isArray(g.flows) || g.flows.length > 16) return null;
    const flowIds = new Set<string>(), members = new Set<string>();
    const boundProducts = new Set<string>(), boundServices = new Set<string>();
    for (const flow of g.flows) {
      if (!flow || typeof flow.id !== "string" || !idPattern.test(flow.id) || badKeys.has(flow.id) || flowIds.has(flow.id) || typeof flow.label !== "string" || flow.label.length > 100 || !["order","booking","information","support","custom"].includes(flow.kind) || !Array.isArray(flow.nodeIds) || !flow.nodeIds.length || flow.nodeIds.length > 32 || !flow.nodeIds.includes(flow.entryNodeId)) return null;
      flowIds.add(flow.id);
      for (const [bindingIds, assigned] of [[flow.productIds, boundProducts], [flow.serviceIds, boundServices]] as const) {
        if (bindingIds === undefined) continue;
        if (!Array.isArray(bindingIds) || bindingIds.length > 200) return null;
        for (const id of bindingIds) {
          if (typeof id !== "string" || !bindingIdPattern.test(id) || assigned.has(id.toLowerCase())) return null;
          assigned.add(id.toLowerCase());
        }
      }
      for (const id of flow.nodeIds) {
        if (!ids.has(id) || members.has(id)) return null;
        members.add(id);
      }
      if (g.nodes.find(n => n.id === flow.entryNodeId)?.kind === "start" || g.nodes.find(n => n.id === flow.entryNodeId)?.kind === "end") return null;
    }
  }
  const body = { name:g.name.trim(),nodes:g.nodes.map(n=>({id:n.id,kind:n.kind,label:n.label.trim(),position:{x:n.position.x,y:n.position.y},config:{prompt:n.config.prompt,fieldKey:n.config.fieldKey,fieldType:n.config.fieldType,condition:n.config.condition,value:n.config.value}})),edges:g.edges.map(e=>({id:e.id,source:e.source,target:e.target,port:e.port})) };
  return g.version === 2 ? { ...body, version: 2, flows: g.flows.map(f => ({id:f.id,label:f.label.trim(),kind:f.kind,entryNodeId:f.entryNodeId,nodeIds:[...f.nodeIds], ...(f.productIds !== undefined ? { productIds: f.productIds.map(id => id.toLowerCase()) } : {}), ...(f.serviceIds !== undefined ? { serviceIds: f.serviceIds.map(id => id.toLowerCase()) } : {})})) } : { ...body, version: 1 };
}
export function validateVisualGraph(raw: unknown): { graph?: VisualGraph; errors: {nodeId?:string;message:string}[] } {
  const graph=normalizeVisualDraft(raw), errors:{nodeId?:string;message:string}[]=[];
  if (!graph) return {errors:[{message:"Rrjedha nuk është e vlefshme. Lejohen deri në 32 hapa."}]};
  const starts=graph.nodes.filter(n=>n.kind==="start");
  if(starts.length!==1) errors.push({message:"Rrjedha duhet të ketë vetëm një fillim."});
  for(const n of graph.nodes){
    const add=(message:string)=>errors.push({nodeId:n.id,message});
    if(!n.label) add("Vendos emrin e hapit.");
    const ports=outputPorts(n.kind), edges=graph.edges.filter(e=>e.source===n.id);
    for(const port of ports) if(edges.filter(e=>e.port===port).length!==1) add(`Lidh daljen ${port==='yes'?'Po':port==='no'?'Jo':'Vazhdo'} me një hap.`);
    if(edges.some(e=>!ports.includes(e.port))) add("Ky hap ka një dalje që nuk mbështetet.");
    if(n.kind==='start'&&graph.edges.some(e=>e.target===n.id)) add("Fillimi nuk mund të ketë lidhje hyrëse.");
    if(['collect','confirm'].includes(n.kind)&&!n.config.prompt?.trim()) add("Shkruaj pyetjen për klientin.");
    if(n.kind==='collect'&&(!n.config.fieldKey||!fieldPattern.test(n.config.fieldKey))) add("Vendos një emër fushe, p.sh. email_klienti.");
    if(n.kind==='condition'&&!n.config.condition) add("Zgjidh kushtin.");
    if(n.kind==='condition'&&n.config.condition?.startsWith('field_')&&(!n.config.fieldKey||!fieldPattern.test(n.config.fieldKey))) add("Zgjidh fushën për kushtin.");
    if(n.config.condition==='field_equals'&&!n.config.value?.trim()) add("Vendos vlerën që do të krahasohet.");
  }
  const reached=new Set<string>();
  function visit(id:string){if(reached.has(id))return; reached.add(id);graph!.edges.filter(e=>e.source===id).forEach(e=>visit(e.target));}
  if(starts.length===1) visit(starts[0].id);
  if (graph.version === 2) {
    if (!graph.flows.length) errors.push({message:"Shto të paktën një proces në qendrën e mesazhit."});
    for (const flow of graph.flows) {
      if (!flow.label) errors.push({nodeId:flow.entryNodeId,message:"Vendos emrin e procesit."});
      visit(flow.entryNodeId);
    }
  }
  for(const n of graph.nodes) if(!reached.has(n.id)) errors.push({nodeId:n.id,message:"Ky hap nuk lidhet me fillimin."});
  // Cycles must cross an actual wait, never run indefinitely within one turn.
  const checked=new Set<string>(), visiting=new Set<string>();
  function cycle(id:string):boolean {const n=graph!.nodes.find(n=>n.id===id)!;if(['collect','confirm','product','booking'].includes(n.kind)||checked.has(id))return false;if(visiting.has(id))return true;visiting.add(id);const bad=graph!.edges.filter(e=>e.source===id).some(e=>cycle(e.target));visiting.delete(id);checked.add(id);return bad;}
  if(graph.nodes.some(n=>cycle(n.id))) errors.push({message:"Një cikël duhet të përmbajë një hap që pret përgjigjen e klientit."});
  if(!graph.nodes.some(n=>n.kind==='end'||n.kind==='handoff')) errors.push({message:"Shto një përfundim ose kalim te stafi."});
  return errors.length?{errors}:{graph,errors};
}
export function starterVisualGraph(process?: BusinessProcess | null): VisualGraph {
  return {version:1,name:process?.name?.slice(0,120)||"Rrjedha e klientit",nodes:[
    {id:'start',kind:'start',label:'Mesazh i ri',position:{x:20,y:60},config:{}},
    {id:'support',kind:'condition',label:'Kërkon ndihmën e stafit?',position:{x:300,y:60},config:{condition:'intent_support'}},
    {id:'handoff',kind:'handoff',label:'Kalo te stafi',position:{x:600,y:60},config:{prompt:'Po ia kaloj kërkesën tuaj ekipit.'}},
    {id:'order',kind:'condition',label:'Dëshiron të porosisë?',position:{x:300,y:275},config:{condition:'intent_order'}},
    {id:'product',kind:'product',label:'Ndiq hapat e produktit',position:{x:600,y:275},config:{}},
    {id:'knowledge',kind:'knowledge',label:'Përgjigju nga njohuritë',position:{x:300,y:495},config:{}},
    {id:'end',kind:'end',label:'Përfundim',position:{x:600,y:495},config:{}}
  ],edges:[{id:'e1',source:'start',target:'support',port:'next'},{id:'e2',source:'support',target:'handoff',port:'yes'},{id:'e3',source:'support',target:'order',port:'no'},{id:'e4',source:'order',target:'product',port:'yes'},{id:'e5',source:'order',target:'knowledge',port:'no'},{id:'e6',source:'product',target:'end',port:'next'},{id:'e7',source:'knowledge',target:'end',port:'next'}]};
}

/** Upgrade only a working draft; published versions are never rewritten. */
export function upgradeVisualGraph(graph: VisualGraph): VisualGraphV2 {
  if (graph.version === 2) return structuredClone(graph);
  const upgraded = structuredClone(graph);
  const kinds: Partial<Record<VisualNodeKind, VisualFlowKind>> = {product:"order",booking:"booking",knowledge:"information",order_status:"information",handoff:"support"};
  let entries = upgraded.nodes.filter(n => kinds[n.kind]);
  if (!entries.length) entries = upgraded.nodes.filter(n => ["collect","confirm"].includes(n.kind)).slice(0,1);
  const entryIds = new Set(entries.map(n => n.id)), assigned = new Set<string>();
  const flows: VisualFlow[] = entries.map(node => {
    const nodeIds: string[] = [];
    const visit = (id: string) => {
      const current = upgraded.nodes.find(n => n.id === id);
      if (!current || assigned.has(id) || (id !== node.id && entryIds.has(id)) || ["start","end"].includes(current.kind)) return;
      assigned.add(id); nodeIds.push(id);
      for (const edge of upgraded.edges.filter(e => e.source === id)) visit(edge.target);
    };
    visit(node.id);
    return {id:node.id,label:node.label,kind:kinds[node.kind] ?? "custom",entryNodeId:node.id,nodeIds};
  });
  return {...upgraded,version:2,flows};
}
