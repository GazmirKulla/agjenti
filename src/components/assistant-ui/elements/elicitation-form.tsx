"use client";

import "./elicitation-form.css";
import { useId, type ReactNode } from "react";

/** Adapted from assistant-ui's MIT-licensed standalone ElicitationForm.
 * The surrounding ActionForm owns submission, validation and the server receipt. */
export type ElicitationField = {
  name: string;
  label: string;
  value: string;
  kind: "text" | "choice";
  options?: readonly string[];
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
};

export function ElicitationForm({ fields, onFieldChange, children }: {
  fields: readonly ElicitationField[];
  onFieldChange: (name: string, value: string) => void;
  children?: ReactNode;
}) {
  const fieldPrefix = useId();
  return <div data-slot="elicitation-form" className="booking-elicitation">
    {fields.map((item, index) => {
      const labelId = `${fieldPrefix}-${index}`;
      const inputId = `${labelId}-input`;
      if (item.kind === "choice") return <div key={item.name}>
        <span id={labelId}>{item.label}</span>
        <div role="group" aria-labelledby={labelId} className="booking-time-options">
          {item.options?.map(option => <button key={option} type="button"
            aria-pressed={option === item.value} onClick={() => onFieldChange(item.name, option)}>
            {option}
          </button>)}
        </div>
        <input type="hidden" name={item.name} value={item.value} />
      </div>;
      return <label key={item.name} htmlFor={inputId}>{item.label}
        <input id={inputId} className="field" name={item.name} value={item.value}
          required={item.required} minLength={item.minLength} maxLength={item.maxLength}
          autoComplete={item.autoComplete}
          onChange={event => onFieldChange(item.name, event.currentTarget.value)} />
      </label>;
    })}
    {children}
  </div>;
}
