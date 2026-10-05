"use client";
import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand/logo";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import "../../login/auth.css";
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirm) {
      setError("Fjalëkalimet nuk përputhen.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError(
          "Lidhja ka skaduar. Kërko një lidhje të re nga faqja e hyrjes.",
        );
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
    } catch {
      setError(
        "Fjalëkalimi nuk u ndryshua. Provo një fjalëkalim tjetër ose kërko një lidhje të re.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className="auth-page"
      style={{ display: "flex", justifyContent: "center" }}
    >
      <section
        className="auth-content"
        style={{ width: "100%", maxWidth: 560 }}
      >
        <Link href="/" className="auth-brand">
          <BrandLogo size={40} />
        </Link>
        <div className="auth-card">
          <h1>Fjalëkalimi i ri</h1>
          {done ? (
            <>
              <p role="status">Fjalëkalimi u ndryshua me sukses.</p>
              <Link className="btn btn-primary mt-6" href="/auth/continue">
                Vazhdo në panel
              </Link>
            </>
          ) : (
            <form onSubmit={submit}>
              <fieldset disabled={busy}>
                <label>
                  Fjalëkalimi i ri
                  <input
                    type="password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  Përsërit fjalëkalimin
                  <input
                    type="password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                {error && (
                  <p role="alert" className="auth-error">
                    {error}
                  </p>
                )}
                <button className="auth-submit">
                  {busy ? "Duke ruajtur…" : "Ruaj fjalëkalimin"}
                </button>
                <Link href="/login">Kthehu te hyrja</Link>
              </fieldset>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
