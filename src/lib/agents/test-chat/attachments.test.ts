import { beforeEach, afterEach, it, expect, vi } from "vitest";
const response = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { responses = { create: response }; } }));
import { inspectAttachment, readAttachment, readAttachmentForm, sealAttachment } from "./attachments";
beforeEach(() => { vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("OPENAI_API_KEY", "test"); response.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("reads plain text without an AI call and rejects disguised binary or oversized text", async () => {
  const content = await inspectAttachment(new File(["Material: pambuk"], "details.txt"));
  expect(content.text).toBe("Material: pambuk"); expect(response).not.toHaveBeenCalled();
  await expect(inspectAttachment(new File([new Uint8Array([0,255,0])], "x.txt"))).rejects.toThrow();
  await expect(inspectAttachment(new File(["a".repeat(16001)], "x.txt"))).rejects.toThrow();
  await expect(inspectAttachment(new File(["<svg/>"], "x.svg"))).rejects.toThrow();
});
it("sends verified PDF bytes to the model without creating a hosted file", async () => {
  response.mockResolvedValue({ output_text: "Dokument i klientit" });
  const content = await inspectAttachment(new File(["%PDF-1.4\nfixture"], "doc.pdf", {type:"application/pdf"}));
  expect(content.kind).toBe("document");
  expect(response).toHaveBeenCalledWith(expect.objectContaining({store:false,input:[{role:"user",content:[expect.objectContaining({type:"input_file",filename:"attachment.pdf",file_data:expect.stringContaining("data:application/pdf;base64,")})]}]}));
});
it("binds attachment receipts to user, tenant, expiry and content integrity", () => {
  const receipt=sealAttachment({name:"x.txt",kind:"document",text:"private"},"user","business");
  expect(readAttachment(receipt.token,"user","business").text).toBe("private");
  expect(()=>readAttachment(receipt.token,"other","business")).toThrow();
  expect(()=>readAttachment(receipt.token,"user","other")).toThrow();
  expect(()=>readAttachment(receipt.token+"tampered","user","business")).toThrow();
  vi.spyOn(Date,"now").mockReturnValue(Date.now()+3600001);
  expect(()=>readAttachment(receipt.token,"user","business")).toThrow();
  vi.restoreAllMocks();
});
it("bounds multipart uploads before parsing, even without content length", async () => {
  const form = new FormData(); form.set("file",new File(["hello"],"hello.txt"));
  const request = new Request("https://example.com", { method:"POST",body:form });
  expect((await readAttachmentForm(request)).name).toBe("hello.txt");
  const big = new Request("https://example.com", {method:"POST",headers:{"content-type":"multipart/form-data; boundary=x"},body:"x".repeat(4*1024*1024)});
  await expect(readAttachmentForm(big)).rejects.toThrow("3 MB");
});
