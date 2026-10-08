"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TrainingInput, TrainingTarget } from "@/lib/agents/training/model";
import { TrainingEditor, TrainingSpark, emptyTraining } from "./training-editor";
import "./training-session.css";

export type TrainingFeedback = { receipt: string; question: string; response: string; workflowId: string | null; stepKey: string | null };
export type TrainingRequest = { key: number; feedback: TrainingFeedback };

export function TrainingSession({ target, feedback, request, memoryHref, busy = false, onBusyChange, onChanged }: {
  target: TrainingTarget; feedback?: TrainingFeedback | null; request?: TrainingRequest | null; memoryHref: string; busy?: boolean;
  onBusyChange?: (busy: boolean) => void; onChanged?: () => void;
}) {
  const [editor, setEditor] = useState<{ input: TrainingInput; feedback?: TrainingFeedback } | null>(null);
  useEffect(() => {
    if (request) setEditor({ input: feedbackInput(request.feedback), feedback: request.feedback });
  }, [request]);
  return <>
    <div className="training-toolbar">
      <TrainingSpark />
      <div className="training-toolbar-copy"><strong>Unik për biznesin tënd.</strong><span>Një korrigjim sot, përgjigje më të mira nesër.</span></div>
      <div className="training-toolbar-actions">
        <button className="training-action" disabled={busy} onClick={() => setEditor(feedback ? { input: feedbackInput(feedback), feedback } : { input: emptyTraining() })}>{feedback ? "Korrigjo përgjigjen" : "Mësoji diçka të re"}<span aria-hidden>↗</span></button>
        <Link className="training-memory-link" href={memoryHref}>Memoria e Agjentit <span aria-hidden>→</span></Link>
      </div>
    </div>
    {editor && <TrainingEditor target={target} initial={editor.input} feedback={editor.feedback} memoryHref={memoryHref} onClose={() => setEditor(null)} onBusyChange={onBusyChange} onSaved={onChanged} />}
  </>;
}

function feedbackInput(feedback: TrainingFeedback): TrainingInput {
  return { kind: "example", instruction: "", customerMessage: feedback.question, desiredResponse: feedback.response.slice(0, 3000), receipt: feedback.receipt, workflowId: null, stepKey: null };
}
