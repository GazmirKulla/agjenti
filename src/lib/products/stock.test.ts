import { describe, expect, it } from "vitest";
import { catalogStockState, defaultStockSettings, effectiveQuantity, hasStockFor, parseStockQuantity, parseStockSettings, readStockSettings,
  stockCustomerSentence, stockFact, type StockSettings } from "./stock";
import { parseStockForm } from "./parse";

const settings = (patch: Partial<StockSettings> = {}): StockSettings => ({ ...defaultStockSettings, ...patch });

describe("stock rules shared by the form, the list, the agent and the order check", () => {
  it("reads stored settings leniently and refuses an owner's invalid choice", () => {
    expect(readStockSettings(null)).toEqual(defaultStockSettings);
    expect(readStockSettings({ deduct: "accepted", display: "nope", lowThreshold: 0 })).toEqual({ ...defaultStockSettings, deduct: "accepted" });
    expect(parseStockSettings({ deduct: "accepted", display: "low", defaultMode: "tracked", lowThreshold: "5" }))
      .toEqual({ settings: { deduct: "accepted", display: "low", defaultMode: "tracked", lowThreshold: 5 } });
    expect(parseStockSettings({ deduct: "later", display: "low", defaultMode: "off", lowThreshold: 3 })).toHaveProperty("error");
    expect(parseStockSettings({ deduct: "manual", display: "low", defaultMode: "off", lowThreshold: 2.5 })).toHaveProperty("error");
  });
  it("treats a blank count as no count and refuses a negative one", () => {
    expect(parseStockQuantity("")).toEqual({ quantity: null });
    expect(parseStockQuantity("2,5")).toEqual({ quantity: 2.5 });
    expect(parseStockQuantity("-1")).toHaveProperty("error");
  });
  it("counts only tracked or unique stock that is not owned by the website, and a variant's own count first", () => {
    expect(effectiveQuantity({ stock_mode: "off", stock_quantity: 4 })).toBeNull();
    expect(effectiveQuantity({ stock_mode: "tracked", stock_quantity: 4, source: "linked" })).toBeNull();
    expect(effectiveQuantity({ stock_mode: "tracked", stock_quantity: 4 }, { stock_quantity: 1 })).toBe(1);
    expect(effectiveQuantity({ stock_mode: "tracked", stock_quantity: 4 }, { stock_quantity: null })).toBe(4);
  });
  it("limits what customers hear to the business's display choice", () => {
    expect(stockFact(12, settings())).toBe("në gjendje");
    expect(stockFact(2, settings({ display: "low" }))).toBe("pak copë në gjendje");
    expect(stockFact(2, settings({ display: "exact" }), "m³")).toBe("2 m³ në gjendje");
    expect(stockFact(0, settings({ display: "exact" }))).toBe("ka mbaruar");
    expect(stockFact(null, settings())).toBeNull();
    expect(stockCustomerSentence(0, settings())).toContain("nuk e merr porosinë");
  });
  it("blocks an order only for counted stock below the quantity", () => {
    expect(hasStockFor({ stock_mode: "off" }, null, 99)).toBe(true);
    expect(hasStockFor({ stock_mode: "tracked", stock_quantity: 1 }, null, 2)).toBe(false);
    expect(hasStockFor({ stock_mode: "tracked", stock_quantity: 0 }, { stock_quantity: 3 }, 2)).toBe(true);
  });
  it("shows the list state from every active choice", () => {
    const product = { stock_mode: "tracked" as const, stock_quantity: null };
    expect(catalogStockState(product, [{ stock_quantity: 0 }, { stock_quantity: 0 }], settings())).toBe("out");
    expect(catalogStockState(product, [{ stock_quantity: 0 }, { stock_quantity: 9 }], settings())).toBe("low");
    expect(catalogStockState(product, [{ stock_quantity: 9 }, { stock_quantity: 0, is_active: false }], settings())).toBe("in_stock");
    expect(catalogStockState(product, [], settings())).toBeNull();
  });
});

describe("the product form's stock section", () => {
  const form = (entries: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(entries)) data.set(k, v); return data; };
  it("keeps what is stored when the form has no stock section", () => {
    expect(parseStockForm(form({}))).toEqual({ stock: null });
  });
  it("reads the mode, the product's count and each variant's own count", () => {
    expect(parseStockForm(form({ stock_mode: "tracked", stock_quantity: "", variant_stock_json: JSON.stringify([{ options: { gjatesia: " 80 " }, quantity: "3" }, { options: { gjatesia: "120" }, quantity: "" }]) })))
      .toEqual({ stock: { mode: "tracked", quantity: null, variants: [{ options: { gjatesia: "80" }, quantity: 3 }, { options: { gjatesia: "120" }, quantity: null }] } });
    expect(parseStockForm(form({ stock_mode: "unique", stock_quantity: "1" }))).toEqual({ stock: { mode: "unique", quantity: 1, variants: [] } });
    expect(parseStockForm(form({ stock_mode: "off", stock_quantity: "7" }))).toEqual({ stock: { mode: "off", quantity: null, variants: [] } });
  });
  it("refuses tracking with no count anywhere, an unknown mode or a negative count", () => {
    expect(parseStockForm(form({ stock_mode: "tracked", stock_quantity: "" }))).toHaveProperty("error");
    expect(parseStockForm(form({ stock_mode: "sometimes" }))).toHaveProperty("error");
    expect(parseStockForm(form({ stock_mode: "tracked", stock_quantity: "-2" }))).toHaveProperty("error");
  });
});
