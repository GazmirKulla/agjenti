import { nodeLabels, upgradeVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualFlow, VisualFlowKind, VisualGraph, VisualNode, VisualNodeKind } from "@/lib/workflows/visual/types";

export type FlowTemplate = VisualFlowKind | "order_status" | "business_provision";
export const flowTemplateLabels: Record<FlowTemplate, string> = {
  business_provision: "Regjistrim biznesi", information: "Informacion", order: "Porosi", booking: "Rezervim", support: "Staf", custom: "Rrjedhë tjetër", order_status: nodeLabels.order_status,
};

/** Build the actual capability, so its label cannot accidentally disguise a knowledge step. */
export function addFlowTemplate(graph: VisualGraph, template: FlowTemplate, nodeId: string) {
  const definition = upgradeVisualGraph(graph);
  if(template==="business_provision") {
    const ids={name:`${nodeId}_name`,email:`${nodeId}_email`,confirm:`${nodeId}_confirm`,action:`${nodeId}_action`,success:`${nodeId}_ok`,error:`${nodeId}_error`};
    const fieldName=`biz_${nodeId}`.slice(0,60),fieldEmail=`email_${nodeId}`.slice(0,60);
    const nodes:VisualNode[]=[
      {id:ids.name,kind:"collect",label:"Emri i biznesit",position:{x:200,y:100},config:{fieldKey:fieldName,fieldType:"text",prompt:"Si quhet biznesi yt?"}},
      {id:ids.email,kind:"collect",label:"Emaili i pronarit",position:{x:500,y:100},config:{fieldKey:fieldEmail,fieldType:"email",prompt:"Cilin email do të përdorësh për administrimin e biznesit?"}},
      {id:ids.confirm,kind:"confirm",label:"Konfirmo përgatitjen",position:{x:800,y:100},config:{prompt:"Ta përgatis biznesin me këto të dhëna dhe të krijoj ftesën për ty?"}},
      {id:ids.action,kind:"action",label:"Përgatit biznes dhe ftesë",position:{x:1100,y:100},config:{action:{actionKey:"business.provision",actionVersion:1,inputs:{name:fieldName,email:fieldEmail}}}},
      {id:ids.success,kind:"end",label:"Dërgo linkun",position:{x:1400,y:0},config:{prompt:`Biznesi yt u përgatit. Regjistrohu ose hyr me emailin që dhe për të marrë administrimin: {{actions.${ids.action}.invitationUrl}}`}},
      {id:ids.error,kind:"handoff",label:"Ndihmë nga stafi",position:{x:1400,y:250},config:{prompt:"Përgatitja nuk u konfirmua. Po ia kaloj kërkesën stafit për kontroll."}},
    ];
    definition.nodes.push(...nodes);
    const links:[string,string,"next"|"yes"|"no"][]=[[ids.name,ids.email,"next"],[ids.email,ids.confirm,"next"],[ids.confirm,ids.action,"yes"],[ids.confirm,ids.name,"no"],[ids.action,ids.success,"yes"],[ids.action,ids.error,"no"]];
    definition.edges.push(...links.map(([source,target,port],i)=>({id:`${nodeId}_e${i}`,source,target,port})));
    const flow:VisualFlow={id:`flow_${nodeId}`,kind:"custom",label:"Regjistrim biznesi",entryNodeId:ids.name,nodeIds:nodes.map(n=>n.id)};
    definition.flows.push(flow);return {graph:definition,flow};
  }

  const kind: VisualFlowKind = template === "order_status" ? "information" : template;
  const nodeKind: VisualNodeKind = template === "order_status" ? "order_status" : kind === "order" ? "product" : kind === "booking" ? "booking" : kind === "support" ? "handoff" : "knowledge";
  const label = flowTemplateLabels[template];
  const count = definition.flows.filter(flow => flow.kind === kind && definition.nodes.find(node => node.id === flow.entryNodeId)?.kind === nodeKind).length;
  const flow: VisualFlow = { id: `flow_${nodeId}`, kind, label: `${label}${count ? ` ${count + 1}` : ""}`, entryNodeId: nodeId, nodeIds: [nodeId] };
  const node: VisualNode = { id: nodeId, kind: nodeKind, label, position: { x: 300, y: 200 }, config: {} };
  definition.nodes.push(node);
  if (nodeKind !== "handoff") {
    const endId = `${nodeId}_end`;
    definition.nodes.push({ id: endId, kind: "end", label: "Prit mesazhin tjetër", position: { x: 620, y: 200 }, config: {} });
    definition.edges.push({ id: `edge_${nodeId}`, source: nodeId, target: endId, port: "next" });
  }
  definition.flows.push(flow);
  return { graph: definition, flow };
}
