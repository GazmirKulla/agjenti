"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import "./auth.css";
function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">(
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    params.has("error")
      ? "Lidhja e konfirmimit ka skaduar ose nuk është e vlefshme. Provo të hysh ose kërko një lidhje të re."
      : "",
  );
  function changeMode(value: typeof mode) {
    setMode(value);
    setError("");
    setMessage("");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const supabase = createBrowserSupabase();
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
          },
        );
        if (error) throw error;
        setMessage(
          "Nëse ekziston një llogari me këtë email, do të marrësh lidhjen për ndryshimin e fjalëkalimit. Kontrollo edhe dosjen Spam.",
        );
        return;
      }
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage(
            "Kontrollo email-in për të konfirmuar llogarinë, pastaj hyr në platformë.",
          );
          return;
        }
      }
      window.location.assign("/auth/continue");
    } catch (error) {
      const code = (error as { code?: string }).code;
      setError(
        code === "invalid_credentials"
          ? "Email-i ose fjalëkalimi nuk është i saktë."
          : code === "email_not_confirmed"
            ? "Konfirmo fillimisht email-in nga lidhja që të kemi dërguar."
            : code === "user_already_exists"
              ? "Ky email ka një llogari. Provo të hysh."
              : code === "weak_password"
                ? "Zgjidh një fjalëkalim më të fortë, me të paktën 8 karaktere."
                : code?.includes("rate_limit")
                  ? "Shumë tentativa. Prit pak dhe provo përsëri."
                  : "Nuk u krye veprimi. Kontrollo lidhjen dhe provo përsëri.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <aside className="auth-story">
        <Link href="/" className="auth-brand">
          <span>A</span> Agjenti.app
        </Link>
        <div>
          <p className="auth-eyebrow">BIZNESI YT, GJITHMONË NË KONTAKT</p>
          <h2>
            Nga një bisedë,
            <br />
            te porosia e radhës.
          </h2>
          <p>
            Bisedat, produktet dhe klientët në një hapësirë të vetme. Agjenti yt
            AI kujdeset për hapin tjetër.
          </p>
          <div className="auth-preview">
            <span>✦ Agjenti AI</span>
            <p>Përshëndetje! Si mund t’ju ndihmoj sot?</p>
            <small>Një panel për të gjithë ekipin tënd</small>
          </div>
        </div>
        <small>Agjenti.app · Për bizneset që shesin në Instagram</small>
      </aside>
      <section className="auth-content">
        <Link href="/" className="auth-back">
          ← Kthehu te kryefaqja
        </Link>
        <div className="auth-card">
          <span className="auth-icon">✦</span>
          <h1>
            {mode === "signin"
              ? "Mirë se u ktheve"
              : mode === "signup"
                ? "Krijo llogarinë tënde"
                : "Harrove fjalëkalimin?"}
          </h1>
          <p>
            {mode === "reset"
              ? "Vendos email-in dhe do të të dërgojmë udhëzimet për rikuperim."
              : "Hyr në hapësirën tënde për të menaxhuar biznesin."}
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <label>
                Email-i
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="emri@biznesi.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {mode !== "reset" && (
                <label>
                  Fjalëkalimi
                  <div className="auth-password">
                    <input
                      type={show ? "text" : "password"}
                      required
                      minLength={mode === "signup" ? 8 : undefined}
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === "signup"
                          ? "Të paktën 8 karaktere"
                          : "Fjalëkalimi yt"
                      }
                    />
                    <button
                      type="button"
                      aria-label={
                        show ? "Fshih fjalëkalimin" : "Shfaq fjalëkalimin"
                      }
                      onClick={() => setShow(!show)}
                    >
                      {show ? "Fshih" : "Shfaq"}
                    </button>
                  </div>
                </label>
              )}
              {mode === "signin" && (
                <button
                  type="button"
                  className="auth-text-button"
                  onClick={() => changeMode("reset")}
                >
                  Harrove fjalëkalimin?
                </button>
              )}
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
              {message && (
                <p role="status" className="auth-success">
                  {message}
                </p>
              )}
              <button className="auth-submit" type="submit">
                {busy
                  ? "Duke u përpunuar…"
                  : mode === "signin"
                    ? "Hyr në panel →"
                    : mode === "signup"
                      ? "Krijo llogari →"
                      : "Dërgo lidhjen"}
              </button>
            </fieldset>
          </form>
          <button
            disabled={busy}
            className="auth-toggle"
            onClick={() => changeMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Nuk ke llogari? Regjistrohu"
              : "Ke llogari? Hyr"}
          </button>
          <p className="auth-footnote">
            Qasja në panel përcaktohet nga roli dhe biznesi i lidhur me
            llogarinë tënde.
          </p>
        </div>
      </section>
    </main>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={<main className="p-8">Duke ngarkuar…</main>}>
      <LoginForm />
    </Suspense>
  );
}
