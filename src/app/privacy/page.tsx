import type { Metadata } from "next";
import Link from "next/link";
import "./privacy.css";

export const metadata: Metadata = {
  title: "Politika e privatësisë | Agjenti.app",
  description:
    "Si përpunohen të dhënat e llogarisë, bisedat në Instagram dhe porositë në Agjenti.app.",
  alternates: { canonical: "https://agjenti.app/privacy" },
};
const sections = [
  ["rreth", "Rreth kësaj politike"],
  ["te-dhenat", "Të dhënat që përpunojmë"],
  ["perdorimi", "Si përdoren të dhënat"],
  ["instagram", "Instagram dhe lejet"],
  ["ofruesit", "AI dhe ofruesit e shërbimeve"],
  ["ruajtja", "Ruajtja dhe siguria"],
  ["cookies", "Cookies"],
  ["te-drejtat", "Të drejtat dhe fshirja"],
  ["kontakt", "Kontakti dhe ndryshimet"],
];
export default function PrivacyPage() {
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
          <span className="privacy-kicker">PRIVATËSIA JOTE</span>
          <h1>Politika e privatësisë</h1>
          <p>
            Një shpjegim i qartë për të dhënat që përpunohen kur përdor
            Agjenti.app ose komunikon me një biznes që përdor platformën.
          </p>
          <span className="privacy-date">Përditësuar më 2 tetor 2026</span>
        </div>
        <div className="privacy-layout">
          <aside>
            <nav aria-label="Përmbajtja e politikës">
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
            <section id="rreth">
              <h2>01. Rreth kësaj politike</h2>
              <p>
                Agjenti.app është një platformë për menaxhimin e bisedave me
                klientët, produkteve dhe porosive, me ndihmën e inteligjencës
                artificiale. Kjo politikë mbulon përdoruesit e panelit dhe të
                dhënat që bizneset përpunojnë përmes platformës.
              </p>
              <p>
                Biznesi me të cilin komunikon përcakton qëllimin e përdorimit të
                bisedave dhe porosive të tua. Agjenti.app ofron mjetet teknike
                për përpunimin e tyre sipas konfigurimit të biznesit. Për
                përdorimin e mëtejshëm të të dhënave nga biznesi, konsulto edhe
                politikën e tij të privatësisë.
              </p>
            </section>
            <section id="te-dhenat">
              <h2>02. Të dhënat që përpunojmë</h2>
              <ul>
                <li>
                  <strong>Llogaria dhe biznesi:</strong> email-i, emri i
                  profilit, emri i biznesit, anëtarësia dhe roli i përdoruesit.
                </li>
                <li>
                  <strong>Lidhja me Instagram:</strong> identifikuesi i
                  llogarisë profesionale, emri i përdoruesit, token-i i
                  autorizimit, afati dhe statusi i lidhjes.
                </li>
                <li>
                  <strong>Bisedat:</strong> identifikuesit dhe emrat e
                  klientëve, teksti i mesazheve, bashkëngjitjet ose lidhjet
                  drejt tyre, koha dhe gjendja e dërgimit të mesazheve.
                </li>
                <li>
                  <strong>Porositë:</strong> produktet e zgjedhura dhe
                  informacionet e dhëna gjatë bisedës, si numri i telefonit,
                  adresa e dërgesës dhe kërkesat e personalizimit, kur nevojiten
                  për porosinë.
                </li>
                <li>
                  <strong>Përmbajtja e biznesit:</strong> katalogu, njohuritë,
                  udhëzimet e agjentit dhe hapat e procesit të porosisë.
                </li>
                <li>
                  <strong>Të dhëna teknike:</strong> gjendja e sesionit,
                  ngjarjet e integrimit dhe gabimet që ndihmojnë funksionimin
                  dhe diagnostikimin e shërbimit.
                </li>
              </ul>
              <p>
                Mos dërgo fjalëkalime, të dhëna karte bankare ose informacione
                të ndjeshme që nuk nevojiten për kërkesën tënde.
              </p>
            </section>
            <section id="perdorimi">
              <h2>03. Si përdoren të dhënat</h2>
              <p>
                Të dhënat përdoren për identifikimin e përdoruesve dhe
                kontrollin e qasjes, shfaqjen e bisedave, përgjigjet automatike
                ose manuale, mbledhjen e informacionit të porosisë dhe kalimin e
                bisedës te stafi. Ato mund të përdoren edhe për përmbledhjen e
                aktivitetit të biznesit, diagnostikimin e gabimeve dhe mbrojtjen
                nga përdorimi i paautorizuar.
              </p>
              <p>
                Përpunimi lidhet me ofrimin e shërbimit të kërkuar, funksionimin
                dhe sigurinë e platformës, detyrimet e zbatueshme dhe, kur
                kërkohet, pëlqimin. Autorizimi i një integrimi mund të tërhiqet.
              </p>
            </section>
            <section id="instagram">
              <h2>04. Instagram dhe lejet</h2>
              <p>
                Lidhja me Instagram kryhet përmes autorizimit të Meta. Platforma
                përdor lejet e dhëna për të marrë dhe dërguar mesazhe në emër të
                llogarisë profesionale të lidhur. Nuk kërkon fjalëkalimin tënd
                të Instagram-it.
              </p>
              <p>
                Mund ta shkëputësh lidhjen nga seksioni Instagram në panel dhe
                të revokosh autorizimin nga cilësimet përkatëse të Meta.
                Shkëputja nuk fshin automatikisht bisedat dhe porositë e
                ruajtura më parë. Për fshirjen e tyre ndiq udhëzimet më poshtë.
              </p>
            </section>
            <section id="ofruesit">
              <h2>05. AI dhe ofruesit e shërbimeve</h2>
              <p>
                Kur përgjigjet me AI janë aktive, teksti i mesazhit, konteksti i
                bisedës, informacioni i mbledhur për porosinë dhe përmbajtja
                përkatëse e biznesit mund t’i dërgohen OpenAI për të gjeneruar
                përgjigjen. Përgjigjet mund të jenë të pasakta; mund të kërkosh
                ndihmën e stafit të biznesit.
              </p>
              <p>
                Platforma përdor Supabase për autentikimin dhe bazën e të
                dhënave, Meta për komunikimin me Instagram dhe OpenAI për
                gjenerimin e përgjigjeve. Nëse biznesi aktivizon një integrim të
                jashtëm për porositë, të dhënat përkatëse të porosisë mund t’i
                dërgohen atij shërbimi.
              </p>
              <p>
                Personat e autorizuar të biznesit dhe administratorët e
                platformës kanë qasje sipas përgjegjësive të tyre. Ofruesit mund
                t’i përpunojnë të dhënat në vende të tjera, sipas marrëveshjeve
                dhe konfigurimit të shërbimeve përkatëse.
              </p>
              <p>
                Për hollësi, shiko{" "}
                <a href="https://developers.openai.com/api/docs/guides/your-data">
                  përpunimin e të dhënave në OpenAI API
                </a>
                ,{" "}
                <a href="https://supabase.com/privacy">politikën e Supabase</a>{" "}
                dhe{" "}
                <a href="https://www.facebook.com/privacy/policy/">
                  politikën e Meta
                </a>
                .
              </p>
            </section>
            <section id="ruajtja">
              <h2>06. Ruajtja dhe siguria</h2>
              <p>
                Të dhënat e llogarisë, bisedat dhe porositë ruhen për të
                mbështetur shërbimin dhe historikun e biznesit. Kohëzgjatja
                varet nga qëllimi i përpunimit, marrëdhënia me biznesin,
                kërkesat për fshirje dhe detyrimet e zbatueshme. Nuk zbatohet
                një afat i vetëm automatik fshirjeje për të gjitha kategoritë.
              </p>
              <p>
                Platforma përdor autentikim, kontrolle qasjeje sipas biznesit
                dhe enkriptim të token-ëve të lidhjes me Instagram. Asnjë sistem
                nuk garanton siguri absolute. Pas një kërkese për fshirje,
                kopjet rezervë dhe regjistrat e ofruesve mund t’u nënshtrohen
                cikleve të veçanta të ruajtjes.
              </p>
            </section>
            <section id="cookies">
              <h2>07. Cookies</h2>
              <p>
                Përdorim cookies të sesionit për hyrjen, mbajtjen e sesionit dhe
                qasjen në panel. Bllokimi ose fshirja e tyre mund të të nxjerrë
                nga llogaria ose të pengojë funksionimin e pjesëve të mbrojtura
                të platformës.
              </p>
            </section>
            <section id="te-drejtat">
              <h2>08. Të drejtat dhe fshirja e të dhënave</h2>
              <p>
                Në varësi të ligjit që zbatohet, mund të kërkosh qasje,
                korrigjim, fshirje, kufizim të përpunimit ose një kopje të të
                dhënave të tua, si dhe të kundërshtosh përpunimin ose të
                tërheqësh pëlqimin kur ai është baza e përpunimit. Mund t’i
                drejtohesh gjithashtu autoritetit përkatës për mbrojtjen e të
                dhënave.
              </p>
              <div className="privacy-callout">
                <h3>Si të kërkosh fshirjen</h3>
                <ol>
                  <li>
                    Nëse je klient që ka komunikuar në Instagram, kontakto
                    biznesin në të njëjtën bisedë dhe kërko fshirjen e të
                    dhënave të përpunuara përmes Agjenti.app.
                  </li>
                  <li>
                    Nëse je përdorues i panelit, kontakto administratorin me të
                    cilin ke aktivizuar llogarinë.
                  </li>
                  <li>
                    Përfshi email-in ose emrin e përdoruesit në Instagram dhe
                    biznesin përkatës, që kërkesa të identifikohet. Mos dërgo
                    fjalëkalime.
                  </li>
                </ol>
                <p>
                  Mund të kërkohet verifikim i identitetit. Të dhënat që duhen
                  ruajtur për një detyrim ligjor ose zgjidhjen e një
                  mosmarrëveshjeje mund të përjashtohen nga fshirja, sipas
                  rastit.
                </p>
              </div>
            </section>
            <section id="kontakt">
              <h2>09. Kontakti dhe ndryshimet</h2>
              <p>
                Për pyetje mbi privatësinë e llogarisë së platformës, përdor
                kanalin e kontaktit me administratorin që të ka dhënë qasje. Për
                bisedat dhe porositë, kontakto drejtpërdrejt biznesin me të
                cilin ke komunikuar.
              </p>
              <p>
                Kjo politikë mund të përditësohet kur ndryshojnë shërbimet ose
                mënyra e përpunimit të të dhënave. Versioni aktual dhe data e
                përditësimit publikohen në këtë faqe.
              </p>
            </section>
          </article>
        </div>
      </main>
      <footer className="privacy-footer">
        <Link href="/">← Kthehu te kryefaqja</Link>
        <span>Agjenti.app · Politika e privatësisë</span>
      </footer>
    </div>
  );
}
