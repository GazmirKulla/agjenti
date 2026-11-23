import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({run:vi.fn(),panel:vi.fn(),read:vi.fn(),record:vi.fn(),fetch:vi.fn(),filters:[] as unknown[][]}));
vi.mock("./workflow-queue",()=>({runWorkflowQueue:m.run}));
vi.mock("@/lib/agents/panel-chat/execute",()=>({runPanelChat:m.panel}));
vi.mock("@/lib/discovery/continue",()=>({workerOrigin:()=>"https://worker.example.test"}));
vi.mock("@/lib/tracking/system-events",()=>({recordSystem:m.record,stepFailure:()=>"handoff:unavailable"}));
vi.mock("@/lib/supabase/service",()=>({createServiceSupabase:()=>({from:()=>{
  const query:Record<string,unknown>={};
  for(const key of ["select","in","eq","or","order","limit"]) query[key]=(...args:unknown[])=>{m.filters.push([key,...args]);return query;};
  query.then=(resolve:(value:unknown)=>void,reject:(error:unknown)=>void)=>m.read().then(resolve,reject);
  return query;
}})}));
import {continueTransport,MAX_TRANSPORT_HOPS} from "./continue";
beforeEach(()=>{vi.clearAllMocks();m.filters=[];vi.stubEnv("CRON_SECRET","test-worker-secret");vi.stubGlobal("fetch",m.fetch);m.run.mockResolvedValue(1);m.panel.mockResolvedValue(1);m.read.mockResolvedValue({data:[],error:null});m.fetch.mockResolvedValue({ok:true,status:202});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("finishes a drained queue without another request",async()=>{await continueTransport();expect(m.fetch).not.toHaveBeenCalled();});
it("hands remaining work to the authenticated worker without any browser request",async()=>{
 m.read.mockResolvedValue({data:[{id:1,leased_until:null}],error:null});await continueTransport();
 expect(m.fetch).toHaveBeenCalledOnce();const [url,options]=m.fetch.mock.calls[0];expect(String(url)).toBe("https://worker.example.test/api/cron/workflow-inbound");
 expect(options.headers.Authorization).toBe("Bearer test-worker-secret");expect(JSON.parse(options.body)).toEqual({work:{kind:"inbound"},hop:1});
});
it("preserves private panel scope and never routes it to provider delivery",async()=>{
 const scope={businessId:"business",userId:"user",streamId:"stream"};await continueTransport({kind:"panel",scope});
 expect(m.panel).toHaveBeenCalledWith(scope);expect(m.run).not.toHaveBeenCalled();
 expect(m.filters).toEqual(expect.arrayContaining([["eq","operation_kind","panel"],["eq","business_id","business"],["eq","operator_user_id","user"],["eq","test_stream_id","stream"]]));
});
it("does not create a timerless polling loop for a blocked successor",async()=>{
 m.run.mockResolvedValue(0);m.read.mockResolvedValue({data:[{id:1,leased_until:null}],error:null});await continueTransport();
 expect(m.fetch).not.toHaveBeenCalled();expect(m.record).toHaveBeenCalledWith("system.transport_wake","waiting",expect.objectContaining({reason:"handoff:no_claimable_work"}));
});
it("waits for the known lease deadline without probing the database",async()=>{
 vi.useFakeTimers();m.run.mockResolvedValue(0);m.read.mockResolvedValue({data:[{id:1,leased_until:new Date(Date.now()+30_000).toISOString()}],error:null});
 const work=continueTransport();await vi.advanceTimersByTimeAsync(29_000);expect(m.read).toHaveBeenCalledOnce();expect(m.fetch).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1100);await work;expect(m.fetch).toHaveBeenCalledOnce();
});
it("records a failed handoff and caps recursion",async()=>{
 m.read.mockResolvedValue({data:[{id:1,leased_until:null}],error:null});m.fetch.mockResolvedValue({ok:false,status:503});await continueTransport();
 expect(m.record).toHaveBeenCalledWith("system.transport_wake","failed",expect.objectContaining({reason:"handoff:http_503"}));
 m.fetch.mockClear();await continueTransport({kind:"inbound"},MAX_TRANSPORT_HOPS);expect(m.fetch).not.toHaveBeenCalled();
});
