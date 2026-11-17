"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/modal/modal";
import { Icon } from "@/components/dashboard/icon";
import "./test-inputs.css";

/** What the simulated customer brings to a test chat, besides their messages.
 * Sent with every test message; the server validates each field again. */
export type TestInputs = { senderInstagram?: string; customerName?: string };

type Field = { key: keyof TestInputs; label: string; placeholder: string; help: string; icon: string; maxLength: number };

/** New simulated customer details are added here (and read in execute-turn). */
export const testInputFields: Field[] = [
  { key: "senderInstagram", label: "Instagram i klientit", placeholder: "@username", icon: "instagram", maxLength: 60,
    help: "Llogaria nga e cila shkruan klienti. Nëse biznesi ka leje skanimi, agjenti lexon profilin publik. Në Real chat ruhet te klienti dhe biseda." },
  { key: "customerName", label: "Emri i klientit", placeholder: "p.sh. Ana Hoxha", icon: "customers", maxLength: 80,
    help: "Në Real chat, emri që merr klienti te Klientët, Lead-et dhe porositë. Pa të, përdoret @username." },
];

export function filledTestInputs(inputs: TestInputs): TestInputs {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value?.trim()]).filter(([, value]) => value)) as TestInputs;
}

export function TestInputsDialog({ inputs, onSave, onClose }: { inputs: TestInputs; onSave: (inputs: TestInputs) => void; onClose: () => void }) {
  const formId = useId();
  const [draft, setDraft] = useState<TestInputs>(inputs);
  return <Modal size="sm" title="Inputs" subtitle="Të dhënat e klientit që simulon. Vlejnë për mesazhet e ardhshme të kësaj bisede." onClose={onClose}
    footer={<>
      <button type="button" className="test-inputs-secondary" onClick={() => setDraft({})}>Pastro</button>
      <span className="test-inputs-spacer" />
      <button type="button" className="test-inputs-secondary" onClick={onClose}>Anulo</button>
      <button type="submit" form={formId} className="test-inputs-primary">Ruaj</button>
    </>}>
    <form id={formId} className="test-inputs-fields" onSubmit={event => { event.preventDefault(); onSave(filledTestInputs(draft)); }}>
      {testInputFields.map(field => <label key={field.key} className="test-inputs-field">
        <span className="test-inputs-label"><Icon name={field.icon} size={15} /> {field.label}</span>
        <input type="text" value={draft[field.key] ?? ""} maxLength={field.maxLength} placeholder={field.placeholder}
          autoComplete="off" autoCapitalize="none" spellCheck={false}
          onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />
        <small>{field.help}</small>
      </label>)}
    </form>
  </Modal>;
}
