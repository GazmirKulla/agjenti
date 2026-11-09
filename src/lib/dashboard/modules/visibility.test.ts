import { describe, expect, it } from "vitest";
import { hiddenModuleHint, moduleForAction, withRequiredModules } from "./visibility";

describe("hidden module hints", () => {
  it("maps saved assistant changes to the menu section they appear in", () => {
    expect(moduleForAction("product_create")).toBe("products");
    expect(moduleForAction("service_update")).toBe("services");
    expect(moduleForAction("knowledge_create")).toBe("knowledge");
    expect(moduleForAction("booking_create")).toBe("bookings");
    expect(moduleForAction("workflow_publish")).toBe("workflows");
    expect(moduleForAction("workflow_read")).toBeNull();
    expect(moduleForAction("agent_update")).toBeNull();
    expect(moduleForAction("operation", "product.create")).toBe("products");
    expect(moduleForAction("operation", "service.save")).toBe("services");
    expect(moduleForAction("operation", "product.delete")).toBeNull();
    expect(moduleForAction("operation", "unknown.key")).toBeNull();
    expect(moduleForAction("operation")).toBeNull();
  });
  it("offers to show a module only when the owner hid it", () => {
    expect(hiddenModuleHint("product_create", ["products", "orders"])).toEqual({ id: "products", label: "Produkte" });
    expect(hiddenModuleHint("product_create", ["orders"])).toBeNull();
    expect(hiddenModuleHint("agent_update", ["products"])).toBeNull();
  });
  it("shows the modules a section needs together with it", () => {
    expect(withRequiredModules("calendar").sort()).toEqual(["bookings", "calendar", "services"]);
    expect(withRequiredModules("orders").sort()).toEqual(["orders", "products"]);
    expect(withRequiredModules("knowledge")).toEqual(["knowledge"]);
  });
});
