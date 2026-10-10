import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),inspect:vi.fn(),read:vi.fn(),seal:vi.fn(),audio:vi.fn(),transcribe:vi.fn()}));
vi.mock("@/lib/tenant/access",()=>({getSessionUser:m.user,requireBusinessAccess:m.access}));
vi.mock("@/lib/agents/test-chat/attachments",()=>({inspectAttachment:m.inspect,readAttachmentForm:m.read,sealAttachment:m.seal}));
vi.mock("@/lib/onboarding/audio-upload",()=>({readAudioForm:m.audio}));
vi.mock("@/lib/business-intelligence/transcription",()=>({transcribeAudio:m.transcribe}));
import { POST } from "./route";
const request = (mode="file",origin="https://example.com") => new Request(`https://example.com/api/agent-test/upload?slug=business&mode=${mode}`, {method:"POST",headers:{origin}});
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({id:"user"});m.access.mockResolvedValue({business:{id:"business"}});});
it("blocks cross-origin, anonymous and other-tenant uploads before reading any body",async()=>{
  expect((await POST(request("file","https://other.com"))).status).toBe(403);
  m.user.mockResolvedValue(null);expect((await POST(request())).status).toBe(401);
  m.user.mockResolvedValue({id:"user"});m.access.mockResolvedValue(null);expect((await POST(request())).status).toBe(403);
  expect(m.read).not.toHaveBeenCalled();expect(m.inspect).not.toHaveBeenCalled();
});
it("transcribes for review without submitting a conversation turn",async()=>{
  const file=new File(["audio"],"x.webm");m.audio.mockResolvedValue({file});m.transcribe.mockResolvedValue("Dua një porosi");
  const result=await POST(request("audio"));expect(await result.json()).toEqual({transcript:"Dua një porosi"});expect(m.inspect).not.toHaveBeenCalled();
});
it("does not expose provider error details",async()=>{
  m.audio.mockRejectedValue(new Error("private provider request data"));
  expect(JSON.stringify(await (await POST(request("audio"))).json())).not.toContain("private");
});
