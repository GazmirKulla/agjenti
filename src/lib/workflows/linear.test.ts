import { expect, it } from "vitest";
import { parseLinearDefinition } from "./linear";
it("validates bound profile fields and rejects unsupported or ambiguous steps", () => {
    const d = { name: "Porosi", steps: [{ key: "phone", kind: "text", fieldKey: "customer_phone", fieldType: "phone" }, { key: "customer", kind: "customer" }] };
    expect(parseLinearDefinition(d).steps[0].fieldKey).toBe("customer_phone");
    expect(() => parseLinearDefinition({ ...d, steps: [{ key: "payment", kind: "payment" }, ...d.steps] })).toThrow();
    expect(parseLinearDefinition({ ...d, steps: [{ key: "size", kind: "choice" }, ...d.steps] }).steps[0].kind).toBe("choice");
    expect(() => parseLinearDefinition({ ...d, steps: [...d.steps, ...d.steps] })).toThrow();
    expect(() => parseLinearDefinition({ ...d, steps: [{ key: "x", kind: "photo", fieldKey: "customer_name" }, ...d.steps] })).toThrow();
});
