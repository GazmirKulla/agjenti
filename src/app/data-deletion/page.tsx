import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import "../privacy/privacy.css";

export const metadata: Metadata = {
  title: "Fshirja e të dhënave | Agjenti.app",
  description:
    "Si të kërkosh fshirjen e të dhënave të lidhura me Instagram dhe Agjenti.app.",
  alternates: { canonical: "https://agjenti.app/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <div className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand">
          <BrandLogo size={36} />
        </Link>
        <Link href="/login" className="privacy-login">
          Hyr në platformë →
        </Link>
      </header>
      <main>
        <div className="privacy-hero">
          <span className="privacy-kicker">FSHIRJA E TË DHËNAVE</span>
          <h1>Si të kërkosh fshirjen e të dhënave</h1>
          <p>
            Udhëzime publike për përdoruesit e Instagram dhe të panelit
            Agjenti.app. Kjo faqe plotëson kërkesën e Meta për URL udhëzimesh.
          </p>
          <span className="privacy-date">Përditësuar më 3 tetor 2026</span>
        </div>
        <div className="privacy-layout">
          <aside>
            <nav aria-label="Hapat e fshirjes">
              <strong>Në këtë faqe</strong>
              <a href="#instagram">
                <span>01</span>Nga Instagram / Meta
              </a>
              <a href="#panel">
                <span>02</span>Nga paneli Agjenti
              </a>
              <a href="#klient">
                <span>03</span>Si klient i një biznesi
              </a>
              <a href="#status">
                <span>04</span>Statusi i kërkesës
              </a>
            </nav>
          </aside>
          <article className="privacy-article">
            <section id="instagram">
              <h2>01. Fshirja nga Instagram / Meta</h2>
              <p>
                Nëse ke autorizuar aplikacionin Agjenti dhe dëshiron të heqësh
                qasjen ose të kërkosh fshirjen e të dhënave që Meta na dërgon:
              </p>
              <ol>
                <li>
                  Hap Instagram → profili → <strong>Settings and activity</strong>{" "}
                  → <strong>Website permissions</strong> / Apps and websites.
                </li>
                <li>
                  Gjej <strong>Agjenti</strong> dhe hiqe autorizimin (Remove /
                  Deauthorize).
                </li>
                <li>
                  Meta na njofton automatikisht. Ne revokojmë token-in e
                  lidhjes Instagram dhe anonimizojmë të dhënat e lidhura me
                  atë llogari, sipas politikës sonë.
                </li>
              </ol>
              <div className="privacy-callout">
                <h3>Callback teknik për Meta</h3>
                <p>
                  Endpoint-i i automatizuar (jo për shfletues) është:{" "}
                  <code>https://agjenti.app/api/meta/data-deletion</code>. Ai
                  pranon kërkesën e firmosur nga Meta dhe kthen një kod
                  konfirmimi me URL statusi.
                </p>
              </div>
            </section>
            <section id="panel">
              <h2>02. Fshirja nga paneli Agjenti.app</h2>
              <p>
                Nëse je përdorues i biznesit në Agjenti.app:
              </p>
              <ol>
                <li>
                  Hyr në panel → Instagram dhe shkëput llogarinë e lidhur.
                </li>
                <li>
                  Kontakto{" "}
                  <a href="mailto:zanastoreeu@gmail.com">
                    zanastoreeu@gmail.com
                  </a>{" "}
                  me email-in e llogarisë dhe emrin e biznesit për të kërkuar
                  mbylljen e llogarisë ose fshirjen e të dhënave të panelit.
                </li>
              </ol>
            </section>
            <section id="klient">
              <h2>03. Nëse je klient i një biznesi</h2>
              <p>
                Nëse ke shkruar një biznes në Instagram që përdor Agjenti.app,
                biznesi është kontrolluesi kryesor i bisedës dhe porosisë.
                Kontakto atë biznes në të njëjtën bisedë dhe kërko fshirjen.
                Mund të përfshish edhe email-in e mësipërm nëse ke nevojë për
                ndihmë teknike.
              </p>
            </section>
            <section id="status">
              <h2>04. Statusi i kërkesës</h2>
              <p>
                Pas një kërkese automatike nga Meta, merr një{" "}
                <strong>confirmation code</strong> dhe një URL statusi. Hap
                atë URL për të parë nëse kërkesa është{" "}
                <code>completed</code>. Detajet e privatësisë:{" "}
                <Link href="/privacy#te-drejtat">Politika e privatësisë</Link>.
              </p>
            </section>
          </article>
        </div>
      </main>
      <footer className="privacy-footer">
        <Link href="/">← Kthehu te kryefaqja</Link>
        <span>
          <Link href="/privacy">Privatësia</Link>
          {" · "}
          <Link href="/terms">Kushtet</Link>
        </span>
      </footer>
    </div>
  );
}
