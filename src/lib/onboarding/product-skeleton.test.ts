import { describe, expect, it } from "vitest";
import { checkSkeleton } from "./product-skeleton";

const source = "name: Fustan veror\ndescription: Pambuk 100%. Masat S, M, L. Ngjyrat: e kuqe, blu.\n\nname: Pikturë origjinale\ndescription: Vepër unike, një copë e vetme.";
const field = (patch: Record<string, unknown>) => ({ label: "Madhësia", type: "select", unit: "", options: ["S", "M", "L"], customerChooses: true, evidence: "Masat S, M, L", ...patch });

describe("the onboarding product skeleton", () => {
  it("keeps a field only with an exact quote from the scanned pages", () => {
    const result = checkSkeleton({ fields: [field({}), field({ label: "Marka", type: "text", options: [], customerChooses: false, evidence: "Marka Zara" })], stock: { mode: "off", evidence: "" } }, source, [], []);
    expect(result.fields.map(f => f.label)).toEqual(["Madhësia"]);
    expect(result.fields[0]).toMatchObject({ key: "madhesia", variant: true, type: "select", evidence: "Masat S, M, L" });
  });
  it("never proposes a field the business or its kind already has, nor the same field twice", () => {
    const existing = [{ key: "ngjyra", label: "Ngjyra", type: "select" as const, variant: true }];
    const result = checkSkeleton({ fields: [field({ label: "Ngjyra", evidence: "Ngjyrat: e kuqe, blu" }), field({}), field({ label: "madhësia" })], stock: null }, source, existing, ["deal"]);
    expect(result.fields.map(f => f.label)).toEqual(["Madhësia"]);
  });
  it("drops a field the fields page would refuse", () => {
    expect(checkSkeleton({ fields: [field({ label: "M", evidence: "Pambuk 100%" })], stock: null }, source, [], []).fields).toEqual([]);
    expect(checkSkeleton({ fields: [field({ type: "select", customerChooses: false, options: [], label: "Materiali", evidence: "Pambuk 100%" })], stock: null }, source, [], []).fields).toEqual([]);
  });
  it("proposes a stock mode only with its quote, and never from a malformed answer", () => {
    expect(checkSkeleton({ fields: [], stock: { mode: "unique", evidence: "një copë e vetme" } }, source, [], []).stock).toEqual({ mode: "unique", evidence: "një copë e vetme" });
    expect(checkSkeleton({ fields: [], stock: { mode: "unique", evidence: "limited edition" } }, source, [], []).stock).toBeNull();
    expect(checkSkeleton("nonsense", source, [], [])).toEqual({ fields: [], stock: null });
  });
});
