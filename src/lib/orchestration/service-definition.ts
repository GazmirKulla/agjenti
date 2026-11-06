import type { Field } from "./contracts";
import { digest } from "./definition";
export function serviceFields(flowId: string) {
  const prefix = `service_${digest(flowId).slice(0, 16)}`;
  const key = (name: string) => `${prefix}_${name}`;
  const fields: Field[] = [{ id: key("id"), subject: prefix, label: "Service identifier from verified catalog", type: "text", required: true, min: 36, max: 36 },
    { id: key("name"), subject: prefix, label: "Service", type: "text", source: "server", required: true }];
  return { key, fields };
}
