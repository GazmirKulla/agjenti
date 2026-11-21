import { describe, expect, it } from "vitest";
import { acceptInterest } from "./interest-reading";

describe("light interest reading", () => {
  const message = "Përshëndetje, sa kushton bluza me foto?";
  it("accepts a kind, a summary and a quote that is in the message", () => {
    expect(acceptInterest({ shown: true, kind: "price", summary: "Çmimi i bluzës me foto", evidence: "sa kushton bluza" }, message))
      .toEqual({ kind: "price", summary: "Çmimi i bluzës me foto" });
    expect(acceptInterest({ shown: true, kind: "price", summary: "Çmimi", evidence: "SA  KUSHTON" }, message)?.kind).toBe("price");
  });
  it("refuses no interest, an invented quote, a missing summary or an unknown kind", () => {
    expect(acceptInterest({ shown: false, kind: "none", summary: "", evidence: "" }, message)).toBeNull();
    expect(acceptInterest({ shown: true, kind: "price", summary: "Çmimi", evidence: "dua ta blej" }, message)).toBeNull();
    expect(acceptInterest({ shown: true, kind: "price", summary: "", evidence: "sa kushton" }, message)).toBeNull();
    expect(acceptInterest({ shown: true, kind: "discount", summary: "x", evidence: "sa kushton" }, message)).toBeNull();
    expect(acceptInterest(null, message)).toBeNull();
  });
});
