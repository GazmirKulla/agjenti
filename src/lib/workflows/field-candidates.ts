import { isQuestion, safeFieldKey, validValue, type FieldType } from "./context";
import { foldText } from "./engine";

/** Server-supplied definitions, not model-selected persistence destinations.
 * Interpretation is pure: callers still own authorization, provenance and CAS. */
export type CandidateField = {
  key: string;
  type: FieldType;
  label?: string;
  options?: string[];
  maxLength?: number;
  allowQuestions?: boolean;
  validate?: (value: string, labelled: boolean) => boolean;
  /** Conservative evidence of a positional answer intended for another field. */
  recognizes?: (value: string) => boolean;
};
export type FieldCandidate = { key: string } & (
  | { status: "accepted"; value: string }
  | { status: "missing" | "invalid" | "ambiguous" }
);
export function validFieldCandidate(field: CandidateField, value: string, labelled = true) {
  return safeFieldKey(field.key) && field.type !== "photo" && validValue(value, field.type)
    // Preserve configured text fields (including multiline descriptions).
    // Narrower single-line/format constraints belong to the caller's definition.
    && value.length <= (field.maxLength ?? 2000)
    && (field.allowQuestions !== false || !isQuestion(value))
    && (!field.options?.length || field.options.includes(value))
    && (!field.validate || field.validate(value, labelled));
}

/** Structured/labeled answers are deterministic. Natural-language inference is
 * left to the existing evidence-checked extractor, not guessed here. */
export function parseFieldCandidates(message: string, fields: CandidateField[], options: {
  positionalKeys?: string[]; knownHeader?: string;
} = {}): { fields: FieldCandidate[]; issues: Array<"unknown_content" | "ambiguous_layout"> } {
  const values = new Map<string, string[]>();
  const issues: Array<"unknown_content" | "ambiguous_layout"> = [];
  const labels = new Map(fields.map(f => [foldText(f.label ?? f.key), f]));
  const ambiguous = () => ({ fields: fields.map(f => ({ key: f.key, status: "ambiguous" as const })), issues: ["ambiguous_layout" as const] });
  if (!fields.length || fields.length > 32 || fields.some(f => !safeFieldKey(f.key))
    || new Set(fields.map(f => f.key)).size !== fields.length || labels.size !== fields.length) return ambiguous();
  // Semicolons inside a labeled text value are data; only a following label
  // starts a new field. This also keeps unknown labels visible as diagnostics.
  const separator = message.includes(":") ? /\n|;(?=\s*[^;:\n]{1,70}:)/ : /\n|;/;
  let lines = message.split(separator).map(line => line.trim()).filter(Boolean);
  if (options.knownHeader && lines[0] === options.knownHeader) lines = lines.slice(1);
  if (lines.some(line => line.includes(":"))) {
    for (const line of lines) {
      const at = line.indexOf(":"), field = at < 0 ? undefined : labels.get(foldText(line.slice(0, at).trim()));
      if (!field) { if (!issues.includes("unknown_content")) issues.push("unknown_content"); continue; }
      values.set(field.key, [...(values.get(field.key) ?? []), line.slice(at + 1).trim()]);
    }
  } else if (lines.length) {
    const order = options.positionalKeys?.map(key => fields.find(f => f.key === key));
    if (!order || lines.length > order.length || order.some(f => !f)) return ambiguous();
    // Never shift an unlabeled value to a guessed slot after a reordered answer.
    if (lines.some((value, i) => !validFieldCandidate(order[i]!, value, false)
      && fields.some(f => f.key !== order[i]!.key && f.recognizes?.(value)))) return ambiguous();
    lines.forEach((value, i) => values.set(order[i]!.key, [value]));
  }
  const labelled = lines.some(line => line.includes(":"));
  return { issues, fields: fields.map(field => {
    const supplied = values.get(field.key);
    if (!supplied?.length || supplied.length === 1 && !supplied[0]) return { key: field.key, status: "missing" };
    if (supplied.length !== 1) return { key: field.key, status: "ambiguous" };
    return validFieldCandidate(field, supplied[0], labelled)
      ? { key: field.key, status: "accepted", value: supplied[0] }
      : { key: field.key, status: "invalid" };
  }) };
}
