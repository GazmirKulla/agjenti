import type { Metadata } from "next";
import Link from "next/link";
import "../privacy/privacy.css";

export const metadata: Metadata = {
  title: "Kushtet e përdorimit | Agjenti.app",
  description:
    "Kushtet e përdorimit të platformës Agjenti.app për bizneset dhe përdoruesit e panelit.",
  alternates: { canonical: "https://agjenti.app/terms" },
};

const sections = [
  ["pranim", "Pranimi i kushteve"],
  ["sherbimi", "Çfarë ofron shërbimi"],
  ["llogaria", "Llogaria dhe përgjegjësia"],
  ["instagram", "Instagram dhe Meta"],
  ["permbajtja", "Përmbajtja dhe të dhënat"],
  ["ndalimet", "Përdorime të ndaluara"],
  ["disponueshmeria", "Disponueshmëria"],
  ["pergjegjesia", "Kufizimi i përgjegjësisë"],
  ["ndryshimet", "Ndryshimet dhe përfundimi"],
  ["kontakt", "Kontakti"],
];

export default function TermsPage() {
  return (
    <div className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand">
          <span>A</span>Agjenti.app
        </Link>
        <Link href="/login" className="privacy-login">
          Hyr në platformë →
        </Link>
      </header>
      <main>
        <div className="privacy-hero">
          <span className="privacy-kicker">KUSHTET E PËRDORIMIT</span>
          <h1>Kushtet e përdorimit</h1>
          <p>
            Rregullat që zbatohen kur përdor Agjenti.app për menaxhimin e
            bisedave, produkteve dhe porosive të biznesit.
          </p>
          <span className="privacy-date">Përditësuar më 3 tetor 2026</span>
        </div>
        <div className="privacy-layout">
          <aside>
            <nav aria-label="Përmbajtja e kushteve">
              <strong>Në këtë faqe</strong>
              {sections.map(([id, title], i) => (
                <a href={`#${id}`} key={id}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {title}
                </a>
              ))}
            </nav>
          </aside>
          <article className="privacy-article">
            <section id="pranim">
              <h2>01. Pranimi i kushteve</h2>
              <p>
                Duke krijuar llogari, duke hyrë në panel ose duke lidhur një
                llogari Instagram me Agjenti.app, pranon këto kushte dhe{" "}
                <Link href="/privacy">politikën e privatësisë</Link>. Nëse nuk
                pajtohesh, mos e përdor shërbimin.
              </p>
            </section>
            <section id="sherbimi">
              <h2>02. Çfarë ofron shërbimi</h2>
              <p>
                Agjenti.app është një platformë për bizneset që duan të
                menaxhojnë bisedat me klientët në Instagram, katalogun,
                porositë dhe automatizimin e përgjigjeve me ndihmën e AI-së.
                Shërbimi ofrohet “as-is” sipas funksioneve të disponueshme në
                panel.
              </p>
            </section>
            <section id="llogaria">
              <h2>03. Llogaria dhe përgjegjësia</h2>
              <ul>
                <li>
                  Je përgjegjës për ruajtjen e kredencialeve të llogarisë dhe
                  për veprimet e anëtarëve që fton në biznesin tënd.
                </li>
                <li>
                  Duhet të japësh informacion të saktë gjatë regjistrimit dhe të
                  mbash të përditësuar të dhënat e biznesit.
                </li>
                <li>
                  Nëse përdor platformën për një biznes, garanton se ke
                  autorizimin për ta përfaqësuar atë biznes.
                </li>
              </ul>
            </section>
            <section id="instagram">
              <h2>04. Instagram dhe Meta</h2>
              <p>
                Lidhja me Instagram bëhet përmes Meta. Duhet të respektosh
                kushtet, politikat dhe limitet e Meta/Instagram, përfshirë
                rregullat për mesazhet, privatësinë e përdoruesve dhe përdorimin
                e API-ve. Revokimi i lejeve në Meta mund të ndërpresë
                funksionet e lidhura me Instagram.
              </p>
            </section>
            <section id="permbajtja">
              <h2>05. Përmbajtja dhe të dhënat</h2>
              <p>
                Ti (ose biznesi yt) mban të drejtat mbi përmbajtjen, produktet,
                bisedat dhe porositë që fut në platformë. Na jep një licencë të
                kufizuar për t’i përpunuar ato vetëm për ofrimin e shërbimit
                (përfshirë ruajtjen, shfaqjen në panel dhe dërgimin e
                përgjigjeve të konfiguruar).
              </p>
              <p>
                Je përgjegjës që komunikimet me klientët, ofertat dhe porositë
                të jenë të ligjshme, të sakta dhe të përputhshme me të
                drejtat e konsumatorëve.
              </p>
            </section>
            <section id="ndalimet">
              <h2>06. Përdorime të ndaluara</h2>
              <ul>
                <li>Përdorimi për spam, mashtrim, ngacmim ose përmbajtje të paligjshme.</li>
                <li>Tentativa për qasje të paautorizuar, ndërhyrje në shërbim ose abuzim me API-të.</li>
                <li>Shkelja e të drejtave të palëve të treta ose e politikave të Meta.</li>
                <li>Rishitja ose rivendosja e shërbimit pa marrëveshje të shkruar.</li>
              </ul>
            </section>
            <section id="disponueshmeria">
              <h2>07. Disponueshmëria</h2>
              <p>
                Mund të ketë ndërprerje për mirëmbajtje, gabime të ofruesve të
                tretë (p.sh. Meta, hosting, AI) ose rrethana jashtë kontrollit
                tonë. Nuk garantojmë funksionim të pandërprerë ose se çdo
                mesazh Instagram do të dorëzohet pa vonesë.
              </p>
            </section>
            <section id="pergjegjesia">
              <h2>08. Kufizimi i përgjegjësisë</h2>
              <p>
                Në masën maksimale të lejuar nga ligji, Agjenti.app nuk mban
                përgjegjësi për dëme indirekte, humbje fitimi, humbje të
                të dhënave ose ndërprerje të biznesit që rrjedhin nga përdorimi
                i platformës ose nga shërbimet e palëve të treta. Përgjegjësia
                totale, kur zbatohet, kufizohet në shumën e paguar për
                shërbimin në 3 muajt para ngjarjes, ose zero nëse shërbimi
                ofrohet falas.
              </p>
            </section>
            <section id="ndryshimet">
              <h2>09. Ndryshimet dhe përfundimi</h2>
              <p>
                Mund të përditësojmë këto kushte; data e versionit aktual
                shfaqet në këtë faqe. Mund të pezullojmë ose mbyllim qasjen në
                rast shkeljeje, rreziku sigurie ose kërkese nga Meta/ligji. Ti
                mund të ndërpresësh përdorimin duke shkëputur Instagram dhe duke
                kërkuar mbylljen e llogarisë sipas{" "}
                <Link href="/data-deletion">udhëzimeve të fshirjes</Link>.
              </p>
            </section>
            <section id="kontakt">
              <h2>10. Kontakti</h2>
              <p>
                Për pyetje mbi këto kushte:{" "}
                <a href="mailto:zanastoreeu@gmail.com">zanastoreeu@gmail.com</a>
                . Shih edhe{" "}
                <Link href="/privacy">politikën e privatësisë</Link>.
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
          <Link href="/data-deletion">Fshirja e të dhënave</Link>
        </span>
      </footer>
    </div>
  );
}
