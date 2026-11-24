import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({create:vi.fn(),identity:vi.fn(),access:vi.fn(),report:vi.fn(),rpc:vi.fn(),business:vi.fn(),events:vi.fn()}));
vi.mock("@/lib/tracking/events",()=>({recordCapabilityEvents:m.events}));
vi.mock("@/lib/ai/openai",()=>({default:class {responses={create:m.create};}}));
vi.mock("@/lib/auth/read-client",()=>({authenticatedReadClient:m.identity}));
vi.mock("@/lib/tenant/access",()=>({requireBusinessAccess:m.access}));
vi.mock("@/lib/reports/service",()=>({loadBusinessReport:m.report}));
import { orderChartReply, reportChartQuestion } from "./report-chart";
import { metricChart, summarize } from "@/lib/reports/model";
beforeEach(()=>{
 vi.resetAllMocks();
 m.identity.mockResolvedValue({user:{id:"user"},db:{rpc:m.rpc,from:()=>({select:()=>({eq:(_key:string,id:string)=>{expect(id).toBe("business");return {maybeSingle:m.business};}})})}});
 m.access.mockResolvedValue({business:{id:"business"}}); m.rpc.mockResolvedValue({data:true,error:null});
 m.business.mockResolvedValue({data:{id:"business",timezone:"Europe/Tirane"},error:null});
 m.report.mockResolvedValue({timezone:"Europe/Tirane",generatedAt:"2026-11-25T00:00:00Z",days:Array.from({length:14},(_,i)=>({day:`2026-11-${String(i+12).padStart(2,"0")}`,orders:i,inbound:0,aiReplies:0,bookings:0,customers:0}))});
});
afterEach(()=>vi.unstubAllEnvs());
it.each([["Grafik i porosive për 7 ditët e fundit",7,"line"],["Show orders over the last 30 days",30,"bar"],["Zeige Bestellungen der letzten 90 Tage",90,"line"]])("validates structured interpretation in any language: %s",async(text,range,kind)=>{
 vi.stubEnv("OPENAI_API_KEY","test"); m.create.mockResolvedValue({output_text:JSON.stringify({range,kind,evidence:text})});
 expect(await reportChartQuestion(String(text))).toEqual({range,kind});
});
it("passes context for follow-ups and rejects ungrounded, extra or failed model outputs",async()=>{
 vi.stubEnv("OPENAI_API_KEY","test");
 const history=[{role:"assistant" as const,content:"Orders in the last 7 days"}];
 m.create.mockResolvedValue({output_text:JSON.stringify({range:30,kind:"line",evidence:"30"})});
 expect(await reportChartQuestion("Po për 30 ditë?",history)).toEqual({range:30,kind:"line"});
 expect(JSON.parse(m.create.mock.calls[0][0].input).history).toEqual(history);
 for(const value of [{range:30,kind:"line",evidence:"not present"},{range:365,kind:"line",evidence:"30"},{range:30,kind:"line",evidence:"30",execute:true},{range:null,kind:null,evidence:null}]) {
  m.create.mockResolvedValue({output_text:JSON.stringify(value)}); expect(await reportChartQuestion("30")).toBeNull();
 }
 m.create.mockRejectedValue(Error("offline"));expect(await reportChartQuestion("orders 30 days")).toBeNull();
});
it("uses the same aggregate and adapter as Reports, returning a read-only saved chart",async()=>{
 const result=await orderChartReply("demo",{range:7,kind:"bar"});
 expect(m.report).toHaveBeenCalledWith("business",7);
 const report=await m.report.mock.results[0].value;
 expect(result.reportChart).toBe(true);
 expect(result.blocks).toEqual([{type:"chart",version:1,chart:metricChart(summarize(report.days,7,"orders"),"Porosi të krijuara",report.timezone,"bar")}]);
});
it("rejects foreign business and disabled modules before the privileged aggregate",async()=>{
 m.access.mockResolvedValue(null);await expect(orderChartReply("foreign",{range:7,kind:"line"})).rejects.toThrow(); expect(m.report).not.toHaveBeenCalled();
 m.access.mockResolvedValue({business:{id:"business"}});m.rpc.mockResolvedValue({data:false,error:null});
 await expect(orderChartReply("demo",{range:7,kind:"line"})).rejects.toThrow();expect(m.report).not.toHaveBeenCalled();
});
it("discards results after access revocation or timezone changes, and never reports failures as zero",async()=>{
 m.business.mockResolvedValueOnce({data:{id:"business",timezone:"Europe/Tirane"},error:null}).mockResolvedValueOnce({data:null,error:null});
 await expect(orderChartReply("demo",{range:7,kind:"line"})).rejects.toThrow();
 m.business.mockResolvedValue({data:{id:"business",timezone:"UTC"},error:null});
 await expect(orderChartReply("demo",{range:7,kind:"line"})).rejects.toThrow("zonën kohore");
 m.report.mockRejectedValue(Error("query failed"));await expect(orderChartReply("demo",{range:7,kind:"line"})).rejects.toThrow("nuk u ngarkua");
 expect(m.events).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({capability:"assistant.report_chart",point:"read_failed"})]));
});
