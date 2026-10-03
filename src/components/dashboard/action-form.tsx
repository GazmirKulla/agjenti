"use client";
import { startTransition, useActionState, type ReactNode } from "react";

export type ActionResult = { error?: string; success?: string };

export function ActionForm({
  action,
  children,
  className,
  successMessage = "U ruajt me sukses.",
}: {
  action: (data: FormData) => Promise<ActionResult | void>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const [result, submit, pending] = useActionState(
    async (
      _previous: ActionResult | null,
      data: FormData,
    ): Promise<ActionResult> => {
      try {
        const response = await action(data);
        return response?.error
          ? response
          : { success: response?.success || successMessage };
      } catch {
        return {
          error:
            "Veprimi nuk u përfundua. Kontrollo të dhënat dhe provo përsëri.",
        };
      }
    },
    null,
  );
  return (
    <form
      action={submit}
      className={className}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(event.currentTarget, submitter);
        startTransition(() => submit(data));
      }}
    >
      <fieldset disabled={pending} className="action-form-fields">
        {children}
      </fieldset>
      {pending ? (
        <p role="status" className="form-feedback">
          Duke ruajtur…
        </p>
      ) : result?.error ? (
        <p role="alert" className="form-feedback form-feedback-error">
          {result.error}
        </p>
      ) : result?.success ? (
        <p role="status" className="form-feedback form-feedback-success">
          {result.success}
        </p>
      ) : null}
    </form>
  );
}
