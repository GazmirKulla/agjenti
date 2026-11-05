import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import "../privacy/privacy.css";

export const metadata: Metadata = {
  title: "Support | Agjenti",
  description: "Get help with Agjenti on iOS, Android and the web. Contact us about account access, app issues or feedback.",
  alternates: { canonical: "https://www.agjenti.app/support" },
};

export default function SupportPage() {
  return (
    <div className="privacy-page" lang="en">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand" aria-label="Agjenti home">
          <BrandLogo size={36} />
        </Link>
        <Link href="/login" className="privacy-login">Sign in →</Link>
      </header>
      <main>
        <div className="privacy-hero">
          <span className="privacy-kicker">AGJENTI SUPPORT</span>
          <h1>How can we help?</h1>
          <p>Get help with Agjenti on iOS, Android or the web. Contact us about app issues, account access, feedback or feature requests.</p>
          <a className="privacy-login" href="mailto:zanastoreeu@gmail.com?subject=Agjenti%20support">Email support →</a>
        </div>
        <div className="privacy-layout">
          <aside>
            <nav aria-label="Support topics">
              <strong>On this page</strong>
              <a href="#contact">Contact support</a>
              <a href="#app-issues">Report an issue</a>
              <a href="#account">Account and privacy</a>
            </nav>
          </aside>
          <article className="privacy-article">
            <section id="contact">
              <h2>Contact support</h2>
              <p>Email <a href="mailto:zanastoreeu@gmail.com">zanastoreeu@gmail.com</a>. You can contact us without signing in to Agjenti.</p>
              <p>Na shkruaj në shqip ose anglisht. You can write to us in Albanian or English.</p>
            </section>
            <section id="app-issues">
              <h2>Report an app issue</h2>
              <p>To help us investigate, include:</p>
              <ul>
                <li>Your device model, operating system and Agjenti app version.</li>
                <li>What you were trying to do and what happened instead.</li>
                <li>The error message and steps to reproduce the issue, if available.</li>
              </ul>
              <p>If you attach a screenshot, hide private customer information. Never send your password, verification codes or payment card details.</p>
              <p>For connection problems, check your internet connection, reopen the app and check for an update. If the problem continues, email us with the details above.</p>
            </section>
            <section id="account">
              <h2>Account and privacy</h2>
              <p>If you cannot access your account, contact support from the email address associated with it and include your business name.</p>
              <p>For account or data deletion, follow our <Link href="/data-deletion#panel">deletion instructions</Link>.</p>
              <p>Read our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link> for more information.</p>
            </section>
          </article>
        </div>
      </main>
      <footer className="privacy-footer">
        <Link href="/">Agjenti</Link>
        <a href="mailto:zanastoreeu@gmail.com">zanastoreeu@gmail.com</a>
      </footer>
    </div>
  );
}
