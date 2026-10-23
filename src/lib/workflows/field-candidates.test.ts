import { expect, it } from "vitest";
import { parseFieldCandidates, validFieldCandidate, type CandidateField } from "./field-candidates";

it.each([
  { domain: "retail", fields: [{ key: "size", type: "text", label: "Masa", options: ["S", "M"] }, { key: "quantity", type: "number", label: "Sasia" }], message: "Masa: M; Sasia: many", statuses: ["accepted", "invalid"] },
  { domain: "service", fields: [{ key: "project_type", type: "text", label: "Projekti" }, { key: "budget", type: "number", label: "Buxheti" }], message: "Projekti: Website; Buxheti: 1500", statuses: ["accepted", "accepted"] },
  // Existing text field type, not a new date type or a claim of date interpretation.
  { domain: "appointment", fields: [{ key: "preferred_date", type: "text", label: "Preferenca" }, { key: "contact", type: "email", label: "Kontakti" }], message: "Preferenca: nesër në 10:30; Kontakti: wrong", statuses: ["accepted", "invalid"] },
  { domain: "support", fields: [{ key: "customer_questions", type: "text", label: "Pyetjet", allowQuestions: true }, { key: "device_count", type: "number", label: "Pajisjet" }], message: "Pyetjet: si konfigurohet? sa kushton?; Pajisjet: 4", statuses: ["accepted", "accepted"] },
] satisfies Array<{ domain: string; fields: CandidateField[]; message: string; statuses: string[] }>)
("$domain derives parsing/validation from server definitions, not onboarding keys", ({ fields, message, statuses }) => {
  expect(parseFieldCandidates(message, fields).fields.map(f => f.status)).toEqual(statuses);
  expect(fields.some(f => f.key === "child_age")).toBe(false);
});
it("unknown and duplicate labels cannot choose persistence keys", () => {
  const result = parseFieldCandidates("Sasia: 2; Sasia: 3; admin: true", [{ key: "quantity", type: "number", label: "Sasia" }]);
  expect(result).toEqual({ fields: [{ key: "quantity", status: "ambiguous" }], issues: ["unknown_content"] });
});
it("requires unambiguous server definitions and explicit positional authority", () => {
  const fields: CandidateField[] = [{ key: "amount", type: "number", label: "Amount" }];
  expect(parseFieldCandidates("5", fields).fields[0].status).toBe("ambiguous");
  expect(parseFieldCandidates("5", fields, { positionalKeys: ["amount"] }).fields[0]).toEqual({ key: "amount", status: "accepted", value: "5" });
  expect(parseFieldCandidates("", fields).fields[0].status).toBe("missing");
  expect(validFieldCandidate({ key: "constructor", type: "text" }, "bad")).toBe(false);
  expect(validFieldCandidate({ key: "photo", type: "photo" }, "photo_received")).toBe(false);
});
