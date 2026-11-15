import { expect, it } from "vitest";
import { inboxQuery } from "./inbox-read";

it("keeps a search text safe inside a filter", () => {
  expect(inboxQuery("  Bora  Mato ")).toBe("Bora Mato");
  expect(inboxQuery("bora.mato24")).toBe("bora.mato24");
  expect(inboxQuery("+355 69 111")).toBe("+355 69 111");
  expect(inboxQuery("Ëndrit Çela")).toBe("Ëndrit Çela");
  expect(inboxQuery("a),id.eq.1,(b")).toBe("a id.eq.1 b");
  expect(inboxQuery("50%*")).toBe("50");
  expect(inboxQuery("x")).toBeNull();
  expect(inboxQuery(undefined)).toBeNull();
  expect(inboxQuery("a".repeat(100))).toHaveLength(60);
});
