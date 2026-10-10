import { isQuestion, validValue, profileKey } from "../context";
import { foldText } from "../engine";
import type { VisualExecution, VisualGraph, VisualIntent, VisualRunState } from "./types";
export { explicitIntent as detectVisualIntent } from "../guidance";
export function advanceVisualWorkflow(p:{graph:VisualGraph;versionId:string;state?:VisualRunState|null;message:string;hasPhoto:boolean;intent:VisualIntent;productComplete?:boolean;bookingComplete?:boolean;inputAvailable?:boolean; sharedValues?:Record<string,string>}):VisualExecution {
  const state:VisualRunState=p.state?structuredClone(p.state):{versionId:p.versionId,nodeId:p.graph.nodes.find(n=>n.kind==='start')!.id,status:'running',visited:[],values:{},awaiting:false};
  if(p.sharedValues) {
    const forced=p.graph.nodes.find(n=>n.id===state.forceCollect);
    const key=forced?.config.fieldKey;
    if(key && p.sharedValues[key] && p.sharedValues[key]!==state.values[key]) delete state.forceCollect;
    Object.assign(state.values,p.sharedValues);
  }
  const traversedNodeIds:string[]=[];
  const skipped=new Set<string>();
  let consumed=p.inputAvailable===false;
  const result=(kind:VisualExecution['action']['kind'],nodeId:string,message?:string):VisualExecution=>({state,action:{kind,nodeId,message},traversedNodeIds,inputConsumed:consumed});
  if(state.versionId!==p.versionId)throw new Error('workflow_version_mismatch');
  if(state.status==='handoff')return result('handoff',state.nodeId,'Kërkesa juaj është në pritje të ekipit.');
  if(state.status==='completed')return result('end',state.nodeId);
  const advance=(port:'next'|'yes'|'no')=>{const edge=p.graph.edges.find(e=>e.source===state.nodeId&&e.port===port);if(!edge)throw new Error('workflow_missing_edge');state.nodeId=edge.target;state.awaiting=false;state.status='running';};
  for(let i=0;i<65;i++){
    const n=p.graph.nodes.find(n=>n.id===state.nodeId);if(!n)throw new Error('workflow_missing_node');
    traversedNodeIds.push(n.id);state.visited=[...new Set([...state.visited,n.id])].slice(-32);
    if(n.kind==='start'){advance('next');continue;}
    if(n.kind==='condition'){
      const c=n.config, key=c.fieldKey||'';
      const value=Object.hasOwn(state.values,key)&&typeof state.values[key]==='string'?state.values[key]:'';
      const yes=c.condition==='intent_order'?p.intent==='order':c.condition==='intent_support'?p.intent==='support':c.condition==='intent_booking'?p.intent==='booking':c.condition==='field_present'?Boolean(value):foldText(value||'')===foldText(c.value||'');
      advance(yes?'yes':'no');continue;
    }
    if(n.kind==='handoff'){state.status='handoff';state.awaiting=false;return result('handoff',n.id,n.config.prompt||'Po ia kaloj kërkesën tuaj ekipit.');}
    if(n.kind==='end'){state.status='completed';state.awaiting=false;return result('end',n.id,n.config.prompt);}
    if(n.kind==='knowledge'){
      advance('next');
      return result('knowledge',n.id,n.config.prompt);
    }
    if(n.kind==='booking'){
      if(state.awaiting&&p.bookingComplete){consumed=true;advance('next');continue;}
      state.awaiting=true;state.status='waiting';return result('booking',n.id);
    }
    if(n.kind==='product'){
      if(state.awaiting&&p.productComplete){consumed=true;advance('next');continue;}
      state.awaiting=true;state.status='waiting';return result('product',n.id);
    }
    const boundProfile=p.sharedValues&&n.config.fieldKey?profileKey(n.config.fieldKey):null;
    const fieldType=boundProfile==='phone'?'phone':boundProfile==='email'?'email':boundProfile?'text':n.config.fieldType||'text';
    if(n.kind==='collect'&&state.forceCollect!==n.id&&p.sharedValues&&Object.hasOwn(state.values,n.config.fieldKey!)) {
      const known=state.values[n.config.fieldKey!];
      if(validValue(known,fieldType)&&!skipped.has(n.id)) { skipped.add(n.id);advance('next');continue; }
    }
    const wasAwaiting=state.awaiting;
    state.awaiting=true;state.status='waiting';
    if(!wasAwaiting||consumed)return result('prompt',n.id,n.config.prompt);
    const text=p.message.trim();
    if(n.kind==='confirm'){
      const t=foldText(text);
      const yes=/^(po|ok|okay|yes|dakord|konfirmoj|e konfirmoj|ne rregull|sure|po ju lutem)[\s.!]*$/.test(t);
      const no=/^(jo|no|nuk e konfirmoj|ndrysho|korrigjo)[\s.!]*$/.test(t);
      if(!yes&&!no)return result('prompt',n.id,`${n.config.prompt} Përgjigju me Po ose Jo.`);
      state.values[n.id]=yes?'po':'jo';consumed=true;advance(yes?'yes':'no');
      if(!yes && p.sharedValues && p.graph.nodes.find(node=>node.id===state.nodeId)?.kind==='collect') state.forceCollect=state.nodeId;
      continue;
    }
    if(isQuestion(text)) return result('prompt',n.id,n.config.prompt);
    const type=fieldType;
    const valid=type==='photo'?p.hasPhoto:type==='email'?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text):type==='phone'?/^\+?[\d\s().-]{7,24}$/.test(text)&&text.replace(/\D/g,'').length>=7:type==='number'?/^\d+(?:[.,]\d+)?$/.test(text):Boolean(text)&&text.length<=2000;
    if(!valid)return result('prompt',n.id,`${n.config.prompt} ${type==='email'?'Vendos një email të vlefshëm.':type==='photo'?'Dërgo një foto.':type==='number'?'Vendos një numër.':type==='phone'?'Vendos një numër telefoni të vlefshëm.':''}`.trim());
    state.values[n.config.fieldKey!]=type==='photo'?'photo_received':text.slice(0,2000);delete state.forceCollect;consumed=true;advance('next');
  }
  throw new Error('workflow_step_limit');
}
