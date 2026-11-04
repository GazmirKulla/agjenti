import { expect, it, vi } from "vitest";
import { validateResponse, type Evidence } from "./response-consistency";
import { reviewInformationalResponse } from "./response-review";
import { emptyState } from "@/lib/workflows/engine";
const evidence: Evidence={message:"Did it happen?",state:emptyState(),customer:{profile:{},declared:{}},products:[],services:[],informational:true};
it.each([
 {findings:[{status:"valid",code:"execution_receipt_absent",quote:"Done",subject:null}]},
 {findings:[{status:"unverifiable",code:"invented_code",quote:"Done",subject:null}]},
 {findings:[{status:"unverifiable",code:"execution_receipt_absent",quote:"not in reply",subject:null}]},
 {findings:null},
])("never exposes prose after malformed review %j",async review=>{
 vi.mocked(reviewInformationalResponse).mockResolvedValueOnce(review);
 const result=await validateResponse("Done",evidence);
 expect(result.status).toBe("uncertain");expect(result.reply).not.toContain("Done");
});
it("fails closed when corrections overlap",async()=>{
 vi.mocked(reviewInformationalResponse).mockResolvedValueOnce({findings:[
  {status:"unsupported_critical_claim",code:"execution_receipt_absent",quote:"Business created",subject:null},
  {status:"unsupported_critical_claim",code:"execution_receipt_absent",quote:"Business created and invitation sent",subject:null},
 ]});
 const result=await validateResponse("Business created and invitation sent",evidence);
 expect(result.findings[0].code).toBe("overlapping_review");expect(result.reply).not.toContain("invitation sent");
});
it("does not expose unreviewed prose when the reviewer is unavailable",async()=>{
 vi.mocked(reviewInformationalResponse).mockRejectedValueOnce(new Error("offline"));
 const result=await validateResponse("Business created",evidence);
 expect(result.findings[0].code).toBe("review_unavailable");expect(result.reply).not.toContain("Business created");
});
