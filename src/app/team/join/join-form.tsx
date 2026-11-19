"use client";
import { useState, useTransition } from "react";
import { acceptTeamInvitation } from "@/lib/team/actions";

export function JoinTeamForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return <form action={form => start(async () => { const result = await acceptTeamInvitation(form); if (result?.error) setError(result.error); })}>
    <input type="hidden" name="token" value={token} />
    <button className="auth-submit" type="submit" disabled={pending}>{pending ? "Duke pranuar…" : "Prano ftesën"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
