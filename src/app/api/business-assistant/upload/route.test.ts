import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/tenant/access", () => ({ getSessionUser: auth.user, requireBusinessAccess: auth.access }));
import { POST } from "./route";
import { readAttachment } from "@/lib/agents/test-chat/attachments";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64)); auth.user.mockResolvedValue({id:"u"});auth.access.mockResolvedValue({business:{id:"b"}}); });
afterEach(() => vi.unstubAllEnvs());
function request(origin = "https://example.com") { const form = new FormData();form.set("file",new File(["Bluza: pambuk"],"details.txt"));return new Request("https://example.com/api/business-assistant/upload?slug=demo",{method:"POST",headers:{origin},body:form}); }
it("checks origin before authentication and requires business membership", async () => {
  expect((await POST(request("https://other.example"))).status).toBe(403); expect(auth.user).not.toHaveBeenCalled();
  auth.user.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(401);
  auth.access.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(403);
});
it("returns a bounded signed material receipt without requiring an AI call for text", async () => {
  const response = await POST(request());expect(response.status).toBe(200);
  const {attachment} = await response.json();expect(readAttachment(attachment.token,"u","b").text).toBe("Bluza: pambuk");
  expect(()=>readAttachment(attachment.token,"u","other")).toThrow();
});
it("rejects oversized multipart bodies before extraction", async () => {
  const response = await POST(new Request("https://example.com/api/business-assistant/upload?slug=demo",{method:"POST",headers:{origin:"https://example.com","content-type":"multipart/form-data; boundary=x"},body:"x".repeat(4*1024*1024)}));
  expect(response.status).toBe(400);
});
