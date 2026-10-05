"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { BrandLogo } from "@/components/brand/logo";
import { ThemeSwitch } from "@/components/theme/theme-switch";
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
  const [error, setError] = useState(() => {
    const err = params.get("error");
    if (!err) return "";
    if (err === "oauth_callback") {
      return "Hyrja me Google/Apple dështoi ose u anulua. Provo përsëri.";
    }
    return "Lidhja e konfirmimit ka skaduar ose nuk është e vlefshme. Provo të hysh ose kërko një lidhje të re.";
  });
  function changeMode(value: typeof mode) {
    setMode(value);
    setError("");
    setMessage("");
  }
  function signInWithOAuth(provider: "google" | "apple") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    // Server route sets the PKCE verifier cookie on the redirect.
    window.location.assign(`/auth/${provider}`);
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
          <BrandLogo size={40} priority />
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
        <div className="auth-top">
          <Link href="/" className="auth-back">
            ← Kthehu te kryefaqja
          </Link>
          <ThemeSwitch />
        </div>
        <div className="auth-card">
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
              : mode === "signup"
                ? "Krijo llogarinë dhe përgatit hapësirën e biznesit tënd në pak hapa."
                : "Hyr në hapësirën tënde për të menaxhuar biznesin."}
          </p>
          {mode !== "reset" && (
            <>
              <div className="auth-oauth">
                <button
                  type="button"
                  className="auth-google"
                  disabled={busy}
                  onClick={() => signInWithOAuth("google")}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                  >
                    <path
                      fill="#4285F4"
                      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                    />
                    <path
                      fill="#34A853"
                      d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
                    />
                    <path
                      fill="#EA4335"
                      d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58z"
                    />
                  </svg>
                  {mode === "signup"
                    ? "Regjistrohu me Google"
                    : "Vazhdo me Google"}
                </button>
                <button
                  type="button"
                  className="auth-apple"
                  disabled={busy}
                  onClick={() => signInWithOAuth("apple")}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="currentColor"
                  >
                    <path d="M14.73 9.48c-.02-2.07 1.69-3.07 1.77-3.12-0.97-1.41-2.47-1.61-3-1.63-1.28-.13-2.5.75-3.15.75-.65 0-1.66-.73-2.73-.71-1.4.02-2.7.82-3.42 2.07-1.46 2.53-.37 6.28 1.05 8.34.69 1.01 1.52 2.14 2.61 2.1 1.05-.04 1.44-.67 2.71-.67 1.26 0 1.62.67 2.73.65 1.13-.02 1.84-1.03 2.53-2.05.8-1.16 1.12-2.29 1.14-2.35-.02-.01-2.19-.84-2.21-3.33zm-2.1-6.2c.58-.7.97-1.67.86-2.64-.83.03-1.84.55-2.44 1.25-.53.61-.99 1.6-.87 2.54.92.07 1.86-.47 2.45-1.15z" />
                  </svg>
                  {mode === "signup"
                    ? "Regjistrohu me Apple"
                    : "Vazhdo me Apple"}
                </button>
              </div>
              <div className="auth-divider" role="separator">
                <span>ose me email</span>
              </div>
            </>
          )}
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
