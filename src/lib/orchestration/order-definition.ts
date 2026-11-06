import type { Field, Step, ToolPolicy } from "./contracts";
import { digest } from "./definition";
export const orderInputNames = ["productId", "productName", "productTypeId", "unitAmount", "currency", "quantity", "options", "name", "phone", "city", "address"] as const;
export function orderFields(flowId: string, authored: Field[] = [], profileFields?: string[]) {
  const prefix = `order_${digest(flowId).slice(0, 16)}`;
  const key = (name: string) => `${prefix}_${name}`;
  const customerKeys = profileFields ?? ["name", "phone", "city", "address"];
  const customer = customerKeys.map(name => authored.find(f => f.id === `customer_${name}`) ?? {
    id: `customer_${name}`, subject: "customer", label: name, type: name === "phone" ? "phone" : name === "email" ? "email" : "text", required: true,
    ...(name === "name" ? { min: 2, max: 120 } : {}),
  } as Field);
  const fields: Field[] = [
    { id: key("productId"), subject: prefix, label: "Product identifier from verified catalog", type: "text", min: 36, max: 36, required: true },
    { id: key("productName"), subject: prefix, label: "Product", type: "text", source: "server", required: true },
    ...customer,
    ...(profileFields ? [] : [
      { id: key("productTypeId"), label: "Product type", type: "text" },
      { id: key("unitAmount"), label: "Unit price", type: "number", min: 0 },
      { id: key("currency"), label: "Currency", type: "text", min: 3, max: 3 },
      { id: key("quantity"), label: "Quantity", type: "number", min: 1, max: 1 },
      { id: key("options"), label: "Configured product options", type: "text", max: 16000 },
    ].map(f => ({ ...f, subject: prefix, source: "server", required: true }) as Field)),
  ];
  const inputField = (name: string) => ["name", "phone", "city", "address"].includes(name) ? `customer_${name}` : key(name);
  return { key, fields, customer, inputField };
}
export function finishOrder(flowId: string, terminal: string, label: string, fields: Field[], collectionOnly = false, profileFields?: string[]): Step[] {
  const { key, customer, inputField } = orderFields(flowId, fields, collectionOnly ? profileFields ?? [] : undefined);
  const id = (name: string) => `order_${digest([flowId, terminal]).slice(0, 16)}_${name}`;
  const review = id("review"), effect = id("create"), done = id("done"), failed = id("failed"), declined = id("declined");
  const required = [key("productId"), key("productName"), ...customer.map(f => f.id), ...(collectionOnly ? [] : ["productTypeId", "unitAmount", "currency", "quantity", "options"].map(key))];
  return [
    { id: terminal, kind: "condition", fieldId: key("productId"), operator: "present", yes: customer.length ? id("collect_0") : review, no: done },
    ...customer.map((f, i): Step => ({ id: id(`collect_${i}`), kind: "collect", fieldId: f.id, prompt: f.label, next: i + 1 < customer.length ? id(`collect_${i + 1}`) : review })),
    { id: review, kind: "confirm", fieldIds: fields.map(f => f.id), requiredFieldIds: required, label: collectionOnly ? "Review the collected request. No order will be placed." : "Review the product, options, price and delivery details before submitting this order.", yes: effect, no: declined },
    ...(collectionOnly ? [{ id: effect, kind: "message" as const, text: "Request collected only. No order was created or sent.", next: done }] : [
      { id: effect, kind: "effect" as const, tool: "order.create", toolVersion: 1, inputs: Object.fromEntries(orderInputNames.map(name => [name, inputField(name)])), next: done, failed },
      { id: failed, kind: "end" as const, label: "The order could not be submitted. Explain the verified result; do not claim it was created." },
    ]),
    { id: declined, kind: "end", label: "The order request was declined. No order was submitted." },
    { id: done, kind: "end", label },
  ];
}
export function orderToolPolicy(): ToolPolicy {
  const { fields, inputField } = orderFields("policy");
  return { key: "order.create", version: 1, effect: "write", approval: "required", allowed: true,
    inputs: orderInputNames.map(name => { const f = fields.find(f => f.id === inputField(name))!;
      return { key: name, type: f.type, required: f.required, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) }; }) };
}
