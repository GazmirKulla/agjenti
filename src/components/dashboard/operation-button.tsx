"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { prepareManualOperation, confirmManualOperation } from "@/lib/actions/operations/manual";
import { ConfirmationDialog } from "@/components/business-assistant/confirmation-dialog";
import type { Preview } from "@/lib/business-assistant/model";

/** Server-prepared operation with confirmation; the dialog renders wherever `dialog` is placed. */
export function useManualOperation(slug: string, operation: string, redirectTo?: string) {
  const router = useRouter();
  const [proposal, setProposal] = useState<{ token: string; preview: Preview } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function prepare(input: Record<string, unknown>) {
    if (busy) return; setBusy(true); setError("");
    try { const result = await prepareManualOperation(slug, operation, input);
      if (result.error) throw Error(result.error);
      if (result.token && result.preview) setProposal({ token: result.token, preview: result.preview });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    if (busy || !proposal) return; setBusy(true); setError("");
    try { const result = await confirmManualOperation(slug, proposal.token);
      if (result.error) throw Error(result.error);
      setProposal(null); if (redirectTo) router.push(redirectTo); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const dialog = <>
    {error && !proposal && <p role="alert">{error}</p>}
    {proposal && <ConfirmationDialog preview={proposal.preview} busy={busy} canConfirm recovered={false} error={error} onConfirm={() => void confirm()} onClose={() => setProposal(null)} />}
  </>;
  return { prepare, busy, dialog };
}

export function OperationButton({ slug, operation, input, children, redirectTo }: {
  slug: string; operation: string; input: Record<string, unknown>; children: React.ReactNode; redirectTo?: string;
}) {
  const { prepare, busy, dialog } = useManualOperation(slug, operation, redirectTo);
  return <><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void prepare(input)}>{children}</button>{dialog}</>;
}
