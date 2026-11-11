"use client";
import { useState } from "react";
import Link from "next/link";
import { checkInstructionFacts, moveInstructionFacts } from "@/lib/agents/instruction-facts-actions";
import type { InstructionFact } from "@/lib/agents/instruction-facts";

type Proposal = { agentId: string; updatedAt: string; instructions: string; facts: InstructionFact[]; notes?: string[] };

/** Keeps the instructions about behaviour: facts written into them (prices,
 * delivery, payment…) are proposed as Knowledge, moved only on confirmation. */
export function InstructionFacts({ slug }: { slug: string }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "clean" | "moving">("idle");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [preview, setPreview] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);

  async function check() {
    setState("checking"); setMessage(null);
    const result = await checkInstructionFacts(slug);
    if ("error" in result) { setMessage({ text: result.error, error: true }); setState("idle"); return; }
    setProposal(result.proposal);
    setNotes(result.notes);
    setState(result.proposal ? "idle" : "clean");
  }
  async function move() {
    if (!proposal) return;
    setState("moving"); setMessage(null);
    const result = await moveInstructionFacts(slug, proposal);
    if ("error" in result) { setMessage({ text: result.error, error: true }); setState("idle"); return; }
    setProposal(null); setState("idle"); setMessage({ text: result.success });
  }

  return (
    <section className="panel section-pad instruction-facts" aria-labelledby="instruction-facts-title">
      <div className="instruction-facts-head">
        <div>
          <h2 id="instruction-facts-title">Faktet mbahen te Njohuritë</h2>
          <p className="muted-copy">
            Udhëzimet tregojnë si sillet Agjenti. Çmimet, oferta, dërgesa dhe pagesa ruhen te{" "}
            <Link className="instruction-facts-link" href={`/b/${slug}/knowledge`}>Njohuritë</Link>, ku i përditëson në një vend.
          </p>
        </div>
        {!proposal && (
          <button type="button" className="btn btn-ghost" disabled={state === "checking"} onClick={() => void check()}>
            {state === "checking" ? "Duke kontrolluar…" : "Kontrollo udhëzimet"}
          </button>
        )}
      </div>
      {state === "clean" && <p className="instruction-facts-ok" role="status">✓ Udhëzimet nuk kanë fakte për të kaluar.</p>}
      {notes.length > 0 && <ul className="instruction-facts-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {proposal && (
        <div className="instruction-facts-proposal">
          <p><strong>Gjetëm {proposal.facts.length} {proposal.facts.length === 1 ? "fakt" : "fakte"} brenda udhëzimeve.</strong> Kalimi i tyre te Njohuritë shmang përgjigjet me çmime të vjetra.</p>
          <ul>
            {proposal.facts.map((fact, index) => (
              <li key={index}><strong>{fact.title}</strong><span>{fact.body}</span></li>
            ))}
          </ul>
          <button type="button" className="instruction-facts-more" onClick={() => setPreview(!preview)}>
            {preview ? "Fshih udhëzimet e reja" : "Shiko udhëzimet pa faktet"}
          </button>
          {preview && <pre className="instruction-facts-preview">{proposal.instructions}</pre>}
          <p className="muted-copy">Udhëzimet e reja publikohen si version i ri; versioni i mëparshëm mund të rikthehet nga historiku.</p>
          <div className="instruction-facts-actions">
            <button type="button" className="btn btn-primary" disabled={state === "moving"} onClick={() => void move()}>
              {state === "moving" ? "Duke kaluar…" : "Kaloji te Njohuritë"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={state === "moving"} onClick={() => setProposal(null)}>Jo tani</button>
          </div>
        </div>
      )}
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "instruction-facts-error" : "instruction-facts-ok"}>{message.text}</p>}
    </section>
  );
}
