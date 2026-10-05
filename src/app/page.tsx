import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/icon";
import {
  LandingHeader,
  DemoInbox,
  ProductDemo,
} from "@/components/landing/landing-interactive";
import "./landing.css";
const start = "/login?mode=signup";
const categories = [
  ["🧸", "Produkte të personalizuara", "peach"],
  ["👕", "Veshje dhe modë", "gray"],
  ["💄", "Produkte bukurie", "pink"],
  ["🎧", "Elektronikë", "blue"],
  ["🧩", "Produkte për fëmijë", "yellow"],
  ["🛋️", "Dekorime", "sand"],
  ["🗓️", "Shërbime", "gray"],
];
export default function HomePage() {
  return (
    <div className="landing-page">
      <a className="lp-skip" href="#permbajtja">
        Kalo te përmbajtja
      </a>
      <div className="lp-hero-background">
        <LandingHeader />
        <main id="permbajtja">
          <section className="lp-hero lp-container">
            <div className="lp-hero-copy">
              <span className="lp-eyebrow">
                <Icon name="agents" size={15} />
                AI për bizneset në Instagram
              </span>
              <h1>
                Shndërro bisedat
                <br />
                në <span>Instagram</span>
                <br />
                <span>në klientë realë</span>
              </h1>
              <p>
                Agjenti AI i përgjigjet klientëve tuaj, kupton produktet tuaja,
                mbledh të dhënat e porosisë dhe ju ndihmon të shisni më shumë —
                24/7.
              </p>
              <div className="lp-hero-actions">
                <Link className="lp-button" href={start}>
                  Fillo tani <Icon name="arrow" />
                </Link>
                <a className="lp-button secondary" href="#si-funksionon">
                  <span className="lp-play">▷</span>Shiko si funksionon
                </a>
              </div>
              <div className="lp-trust">
                <span className="lp-trust-icons">
                  <span>
                    <Icon name="instagram" />
                  </span>
                  <span>
                    <Icon name="agents" />
                  </span>
                  <span>
                    <Icon name="orders" />
                  </span>
                </span>
                <span>
                  Nga mesazhi i parë te porosia.
                  <br />
                  <strong>
                    Më pak punë manuale, më shumë kohë për biznesin.
                  </strong>
                </span>
              </div>
            </div>
            <div
              className="lp-hero-visual"
              aria-label="Shembull i panelit dhe bisedës në Instagram"
            >
              <div className="lp-visual-glow" />
              <div className="lp-desktop-preview">
                <div className="lp-preview-sidebar">
                  <span className="lp-logo mini">
                    <BrandLogo size={22} />
                  </span>
                  <div className="lp-store">
                    <Icon name="instagram" size={14} />
                    Zana Store <span>⌄</span>
                  </div>
                  {[
                    ["dashboard", "Dashboard"],
                    ["inbox", "Inbox"],
                    ["products", "Produkte"],
                    ["orders", "Porosi"],
                    ["customers", "Klientë"],
                    ["agents", "Agjenti AI"],
                    ["knowledge", "Njohuria"],
                    ["settings", "Cilësimet"],
                  ].map(([icon, label]) => (
                    <div
                      key={icon}
                      className={`lp-preview-nav ${icon === "inbox" ? "active" : ""}`}
                    >
                      <Icon name={icon} size={14} />
                      {label}
                      {icon === "inbox" && <b>3</b>}
                    </div>
                  ))}
                </div>
                <div className="lp-preview-main">
                  <div className="lp-preview-search">
                    <Icon name="search" size={12} />
                    Kërko biseda…
                  </div>
                  <h3>Bisedat</h3>
                  <DemoInbox compact />
                </div>
              </div>
              <div className="lp-phone">
                <div className="lp-phone-notch" />
                <div className="lp-phone-status">
                  <span>9:41</span>
                  <span>••• ▰</span>
                </div>
                <div className="lp-phone-contact">
                  <span>‹</span>
                  <span className="lp-avatar rose">EM</span>
                  <span>
                    <strong>elira.m</strong>
                    <small>Instagram</small>
                  </span>
                  <Icon name="inbox" size={18} />
                </div>
                <div className="lp-phone-chat">
                  <span className="lp-chat-time">Sot, 10:24</span>
                  <p className="lp-bubble">Sa kushton puzzle A3?</p>
                  <p className="lp-bubble ai">
                    Përshëndetje! 😊
                    <br />
                    Puzzle A3 kushton 2,500 Lekë. Mund ta personalizojmë me
                    foton dhe tekstin tënd.
                  </p>
                  <div className="lp-chat-product">
                    <span className="lp-puzzle-art">♡</span>
                    <span>
                      <strong>Puzzle A3</strong>
                      <small>2,500 Lekë</small>
                    </span>
                  </div>
                  <p className="lp-bubble">
                    Po, dua të porosis. Si funksionon?
                  </p>
                  <span className="lp-chat-time">10:26</span>
                </div>
                <div className="lp-phone-compose">
                  <span>
                    <Icon name="agents" size={15} />
                  </span>
                  Shkruaj një mesazh…<b>⊕</b>
                </div>
                <div className="lp-phone-home" />
              </div>
              <span className="lp-instagram-float">
                <Icon name="instagram" size={42} />
              </span>
              <span className="lp-hero-spark">✦</span>
              <span className="lp-visual-caption">
                Pamje ilustruese e produktit
              </span>
            </div>
          </section>
          <section
            className="lp-steps lp-container"
            id="si-funksionon"
            aria-label="Si funksionon"
          >
            <div>
              <span className="lp-step-number pink">1</span>
              <span className="lp-step-icon instagram">
                <Icon name="instagram" size={30} />
              </span>
              <span>
                <h2>Lidhu me Instagramin</h2>
                <p>
                  Lidh llogarinë profesionale
                  <br />
                  të biznesit tënd.
                </p>
              </span>
              <Icon name="arrow" />
            </div>
            <div>
              <span className="lp-step-number blue">2</span>
              <span className="lp-step-icon">
                <Icon name="products" size={35} />
              </span>
              <span>
                <h2>Shto produktet</h2>
                <p>
                  Shto produktet, çmimet
                  <br />
                  dhe hapat e porosisë.
                </p>
              </span>
              <Icon name="arrow" />
            </div>
            <div>
              <span className="lp-step-number green">3</span>
              <span className="lp-step-icon">
                <Icon name="spark" size={35} />
              </span>
              <span>
                <h2>Lëre Agjentin të punojë</h2>
                <p>
                  AI përgjigjet, mbledh të dhënat
                  <br />
                  dhe ndihmon me porositë.
                </p>
              </span>
            </div>
          </section>
        </main>
      </div>
      <div className="lp-container">
        <section className="lp-feature-section">
          <ProductDemo />
          <div className="lp-feature-copy">
            <span className="lp-eyebrow">Më shumë se një chatbot</span>
            <h2>
              Kupton produktet tuaja
              <br />
              dhe ndjek çdo hap të porosisë
            </h2>
            <p>
              Agjenti përdor produktet dhe njohuritë e biznesit për të bërë
              pyetjet e duhura. Ndjek workflow-n e llojit të produktit, nga
              zgjedhja e madhësisë te konfirmimi i porosisë.
            </p>
            <div className="lp-feature-list">
              {[
                ["inbox", "Përgjigjet menjëherë"],
                ["orders", "Ndihmon në krijimin e porosive"],
                ["products", "Rekomandon produkte"],
                ["agents", "Punon edhe jashtë orarit"],
                ["workflows", "Mbledh të dhënat e porosisë"],
                ["customers", "Ju jep kontroll mbi bisedën"],
                ["instagram", "Merr fotot e klientëve"],
                ["knowledge", "Përdor njohuritë e biznesit"],
              ].map(([icon, label]) => (
                <div key={label}>
                  <span>
                    <Icon name={icon} size={20} />
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-inbox-section" id="inbox">
          <div>
            <span className="lp-eyebrow">Inbox i zgjuar për biznesin tuaj</span>
            <h2>
              Të gjitha bisedat
              <br />
              në një vend
            </h2>
            <p>
              Një inbox për ju dhe ekipin tuaj. Shikoni statusin e bisedës, të
              dhënat e klientit dhe porositë. Merrni drejtimin kur biseda ka
              nevojë për ju.
            </p>
            <a className="lp-button" href="#inbox-demo">
              Provo pamjen e inbox-it <Icon name="arrow" size={18} />
            </a>
          </div>
          <div id="inbox-demo">
            <DemoInbox />
          </div>
        </section>
        <section className="lp-business-section" id="bizneset">
          <span className="lp-eyebrow">I përshtatshëm për shumë biznese</span>
          <h2>Punon për çdo lloj biznesi</h2>
          <p>Për bizneset që komunikojnë dhe shesin në Instagram.</p>
          <div className="lp-categories">
            {categories.map(([emoji, label, tone]) => (
              <div className="lp-category" key={label}>
                <div className={`lp-category-art ${tone}`} aria-hidden="true">
                  <span>{emoji}</span>
                </div>
                <h3>{label}</h3>
              </div>
            ))}
          </div>
        </section>
        <section className="lp-analytics-section">
          <div className="lp-analytics-demo">
            <div className="lp-analytics-heading">
              <div>
                <span className="lp-logo mini">
                  <BrandLogo size={24} />
                </span>
                <h3>Biznesi yt, në një vështrim</h3>
              </div>
              <span className="lp-demo-label">Shembull</span>
            </div>
            <div className="lp-demo-stats">
              {[
                ["inbox", "128", "Biseda"],
                ["orders", "42", "Porosi"],
                ["customers", "96", "Klientë"],
              ].map(([icon, value, label]) => (
                <div key={label}>
                  <span>
                    <Icon name={icon} />
                  </span>
                  <strong>{value}</strong>
                  <small>{label}</small>
                </div>
              ))}
            </div>
            <div className="lp-analytics-legend">
              <span>● Biseda</span>
              <span>● Porosi</span>
            </div>
            <svg
              className="lp-chart"
              viewBox="0 0 550 180"
              role="img"
              aria-label="Grafik ilustrues i bisedave dhe porosive"
            >
              <defs>
                <linearGradient id="lp-chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a77bff" stopOpacity=".3" />
                  <stop offset="100%" stopColor="#a77bff" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[30, 70, 110, 150].map((y) => (
                <line key={y} x1="25" x2="530" y1={y} y2={y} stroke="#ebeaf5" />
              ))}
              <path
                d="M25 140 C60 132 65 145 95 120 S145 114 170 100 S210 124 240 87 S290 96 320 71 S365 80 395 54 S440 68 470 34 S510 41 530 25 L530 150 L25 150Z"
                fill="url(#lp-chart-fill)"
              />
              <path
                d="M25 140 C60 132 65 145 95 120 S145 114 170 100 S210 124 240 87 S290 96 320 71 S365 80 395 54 S440 68 470 34 S510 41 530 25"
                stroke="#8746ff"
                strokeWidth="3"
                fill="none"
              />
              <path
                d="M25 148 C60 145 65 150 95 139 S145 143 170 130 S210 142 240 126 S290 137 320 110 S365 127 395 97 S440 110 470 86 S510 91 530 80"
                stroke="#40a8ff"
                strokeWidth="2.5"
                fill="none"
              />
              {[
                [25, "Hën"],
                [110, "Mar"],
                [195, "Mër"],
                [280, "Enj"],
                [365, "Pre"],
                [450, "Sht"],
                [525, "Die"],
              ].map(([x, label]) => (
                <text
                  key={label}
                  x={x}
                  y="174"
                  textAnchor="middle"
                  fill="#9793ad"
                  fontSize="11"
                >
                  {label}
                </text>
              ))}
            </svg>
          </div>
          <div>
            <span className="lp-eyebrow">Një pamje e qartë e aktivitetit</span>
            <h2>
              Shihni si po ecën
              <br />
              biznesi juaj
            </h2>
            <p>
              Ndiqni bisedat, porositë dhe klientët nga paneli i biznesit.
              Kuptoni çfarë po ndodh dhe ku duhet vëmendja e ekipit tuaj.
            </p>
            <div className="lp-check-features">
              <span>✓ Bisedat dhe porositë</span>
              <span>✓ Klientët e biznesit</span>
              <span>✓ Aktiviteti gjatë javës</span>
              <span>✓ Statusi i Instagram-it</span>
            </div>
            <Link className="lp-button" href={start}>
              Zbulo panelin <Icon name="arrow" size={18} />
            </Link>
          </div>
        </section>
        <section className="lp-faq-section" id="pyetje">
          <div>
            <span className="lp-eyebrow">Pyetje të shpeshta</span>
            <h2>
              Le ta bëjmë
              <br />
              më të thjeshtë.
            </h2>
            <p>
              Gjithçka nis me biznesin dhe mënyrën si ju komunikoni me klientët.
            </p>
          </div>
          <div className="lp-faq-list">
            {[
              [
                "Çfarë më duhet për të filluar?",
                "Krijo një llogari dhe kërko aktivizimin e biznesit në platformë. Më pas lidh llogarinë profesionale të Instagram-it, shto produktet dhe konfiguro agjentin.",
              ],
              [
                "A mund t’i përgjigjem vetë klientit?",
                "Po. Mund ta pauzosh Agjentin AI në një bisedë dhe të përgjigjesh manualisht nga Inbox-i. Mund ta rifillosh kur të duash.",
              ],
              [
                "Nga i merr Agjenti informacionet?",
                "Nga katalogu, njohuritë dhe udhëzimet që vendosni për biznesin. Workflow-t sipas llojit të produktit përcaktojnë të dhënat që duhen mbledhur për porosinë.",
              ],
              [
                "A funksionon për produkte të personalizuara?",
                "Po. Hapat e porosisë mund të kërkojnë foto, tekst, zgjedhje dhe të dhëna klienti. Produktet lidhen me workflow-n e llojit të tyre.",
              ],
              [
                "A mund ta përdor nga telefoni?",
                "Po. Paneli është përshtatur për desktop dhe telefon, që të ndiqni bisedat dhe porositë edhe në lëvizje.",
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span>+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="lp-final-cta">
          <span className="lp-cta-icon">
            <Icon name="spark" size={27} />
          </span>
          <h2>
            Gati t’i ktheni bisedat
            <br />
            në mundësi për biznesin?
          </h2>
          <p>
            Jepini klientëve përgjigjet që kërkojnë.
            <br />
            Lërini ekipit tuaj më shumë kohë për atë që ka rëndësi.
          </p>
          <Link href={start} className="lp-button white">
            Fillo tani <Icon name="arrow" />
          </Link>
          <small>Instagram, produktet dhe bisedat — në një vend.</small>
        </section>
        <footer className="lp-footer">
          <a className="lp-logo" href="#">
            <BrandLogo size={34} />
          </a>
          <p>Asistenti i biznesit tënd në Instagram.</p>
          <div>
            <a href="#si-funksionon">Si funksionon</a>
            <a href="#pyetje">Pyetje të shpeshta</a>
            <Link href="/privacy">Privatësia</Link>
            <Link href="/terms">Kushtet</Link>
            <Link href="/login">Hyr në platformë</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
