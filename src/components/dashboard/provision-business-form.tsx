"use client";
import { useState } from "react";
import { prepareBusiness } from "@/lib/actions/manage";
export function ProvisionBusinessForm({ slug }: { slug: string }) {
  const [requestId, setRequestId] = useState<string>(),
    [pending, setPending] = useState(false),
    [result, setResult] = useState<{
      error?: string;
      success?: string;
      invitationUrl?: string;
    }>();
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        const form = new FormData(e.currentTarget);
        const id = requestId ?? crypto.randomUUID();
        setRequestId(id);
        form.set("request_id", id);
        setPending(true);
        try {
          setResult(await prepareBusiness(slug, form));
        } catch {
          setResult({
            error: "Përgjigjja nuk u konfirmua. Riprovo të njëjtën kërkesë.",
          });
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending || !!result?.success} className="grid gap-3">
        <label>
          Emri i biznesit
          <input
            className="field"
            name="name"
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <label>
          Emaili i pronarit
          <input className="field" name="email" type="email" required />
        </label>
        <label>
          Përshkrimi
          <textarea className="field" name="description" maxLength={2000} />
        </label>
        <button className="btn btn-primary">
          {pending ? "Duke përgatitur…" : "Përgatit biznesin"}
        </button>
      </fieldset>
      {result?.error && <p role="alert">{result.error}</p>}
      {result?.success && (
        <>
          <p role="status">{result.success}</p>
          <a className="soft-link" href={result.invitationUrl}>
            {result.invitationUrl}
          </a>
          <p>Kopjo linkun dhe dërgoje në bisedën me klientin.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={(e) => {
              e.currentTarget.form?.reset();
              setRequestId(undefined);
              setResult(undefined);
            }}
          >
            Përgatit biznes tjetër
          </button>
        </>
      )}
    </form>
  );
}
