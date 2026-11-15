import { describe, expect, it } from "vitest";
import { isMetaUrl } from "./conversation-photos";

describe("isMetaUrl", () => {
  it("accepts Meta's media hosts over https", () => {
    expect(isMetaUrl("https://scontent.cdninstagram.com/v/t51/abc.jpg")).toBe(true);
    expect(isMetaUrl("https://scontent-fra5-1.xx.fbcdn.net/v/abc.jpg")).toBe(true);
    expect(isMetaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1")).toBe(true);
  });
  it("refuses other hosts, look-alikes and plain http", () => {
    expect(isMetaUrl("http://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(isMetaUrl("https://evilcdninstagram.com/a.jpg")).toBe(false);
    expect(isMetaUrl("https://cdninstagram.com.evil.net/a.jpg")).toBe(false);
    expect(isMetaUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isMetaUrl("not a url")).toBe(false);
  });
});
