import { expect, it } from "vitest";
import { finishOrder, orderFields, orderToolPolicy } from "./order-definition";
import { compileLinearProcess, linearProcessVersion } from "./linear-definition";

const required = (fields: { id: string; required?: boolean }[]) => Object.fromEntries(fields.filter(f => f.id.startsWith("customer_")).map(f => [f.id, f.required]));

it("customer details are required by default, as before", () => {
  expect(required(orderFields("flow").customer)).toEqual({ customer_name: true, customer_phone: true, customer_city: true, customer_address: true });
});

it("a business's optional details are optional; the name never is", () => {
  expect(required(orderFields("flow", [], undefined, ["phone", "city", "address", "name"]).customer))
    .toEqual({ customer_name: false, customer_phone: false, customer_city: false, customer_address: false });
  expect(required(orderFields("flow", [], undefined, ["phone", "city", "address"]).customer))
    .toEqual({ customer_name: true, customer_phone: false, customer_city: false, customer_address: false });
});

it("a field the process author configured keeps its own setting", () => {
  const authored = [{ id: "customer_phone", subject: "customer", label: "Telefoni", type: "phone" as const, required: true }];
  expect(required(orderFields("flow", authored, undefined, ["phone"]).customer).customer_phone).toBe(true);
});

it("the order tool needs only the name; the server checks the rest against the business", () => {
  const inputs = Object.fromEntries(orderToolPolicy().inputs.filter(i => ["name", "phone", "city", "address"].includes(i.key)).map(i => [i.key, i.required]));
  expect(inputs).toEqual({ name: true, phone: false, city: false, address: false });
});

it("a linear process compiled for a business with optional details asks them but does not require them", () => {
  const version = linearProcessVersion({ id: "v1", businessId: "b1", workflowId: "w1", name: "Porosi",
    steps: [{ key: "delivery", kind: "customer", required: true }] as never, productIds: ["11111111-1111-4111-8111-111111111111"] });
  version.customerOptional = ["phone", "city", "address"];
  const definition = compileLinearProcess(version);
  expect(required(definition.fields)).toEqual({ customer_name: true, customer_phone: false, customer_city: false, customer_address: false });
  expect(definition.steps.filter(s => s.kind === "collect" && s.fieldId.startsWith("customer_")).length).toBeGreaterThanOrEqual(4);
  expect(finishOrder).toBeTypeOf("function");
});
