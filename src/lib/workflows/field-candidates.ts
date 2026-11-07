import { safeFieldKey, validValue, type FieldType } from "./context";

/** Server-supplied definitions, not model-selected persistence destinations.
 * Interpretation is pure: callers still own authorization, provenance and CAS. */
export type CandidateField = {
  key: string;
  type: FieldType;
  label?: string;
  options?: string[];
  maxLength?: number;
  validate?: (value: string, labelled: boolean) => boolean;
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
    && (!field.options?.length || field.options.includes(value))
    && (!field.validate || field.validate(value, labelled));
}

