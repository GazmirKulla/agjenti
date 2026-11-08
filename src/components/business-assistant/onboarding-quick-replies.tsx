"use client";
import { useState } from "react";
import { SKIP_LABEL, type OnboardingQuestionMeta, type OnboardingQuickReply } from "@/lib/onboarding/assistant-chat-model";

/** Quick replies under an onboarding question asked in the conversation. The
 * person can also answer in their own words in the composer. */
export function OnboardingQuickReplies({ question, disabled, onReply }: {
  question: OnboardingQuestionMeta;
  disabled: boolean;
  onReply: (label: string, reply: OnboardingQuickReply) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const multiple = question.kind === "multiple";
  const label = (values: string[]) => values.map((v) => question.options.find((o) => o.value === v)?.label ?? v).join(", ");
  return (
    <div className="onboarding-quick-replies" key={question.field}>
      <div className="assistant-quick-actions" role={multiple ? "group" : undefined} aria-label="Përgjigje të shpejta">
        {question.options.map((option) => (
          <button
            type="button"
            key={option.value}
            disabled={disabled}
            aria-pressed={multiple ? selected.includes(option.value) : undefined}
            onClick={() => multiple
              ? setSelected((old) => old.includes(option.value) ? old.filter((v) => v !== option.value) : [...old, option.value])
              : onReply(option.label, { field: question.field, values: [option.value] })}
          >
            {option.label}
          </button>
        ))}
        {multiple && (
          <button type="button" className="is-primary" disabled={disabled || !selected.length}
            onClick={() => onReply(label(selected), { field: question.field, values: selected })}>
            Vazhdo
          </button>
        )}
        <button type="button" className="is-quiet" disabled={disabled} onClick={() => onReply(SKIP_LABEL, { field: question.field, skip: true })}>
          {SKIP_LABEL}
        </button>
      </div>
      <small>
        {question.options.length ? "Zgjidh një alternativë ose shkruaj me fjalët e tua." : "Shkruaj përgjigjen më poshtë."}
        {question.progress.total ? ` · ${question.progress.answered} nga ${question.progress.total}` : ""}
      </small>
    </div>
  );
}
