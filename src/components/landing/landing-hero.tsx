"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/icon";

// Isolated marketing examples: these never read or create business records.
const examples = [
  {
    label: "Shitje", icon: "orders", business: "Studio Drita", channel: "Instagram",
    question: "Dua një çantë bezhë. Sa kushton?",
    answer: "Çanta kushton 2,500 Lekë. Për porosinë, më duhen emri, telefoni dhe adresa e dorëzimit.",
    reply: "Elira, 06X XXX XXXX, Rruga e Dibrës, Tiranë. Konfirmoj porosinë.",
    finish: "Faleminderit, Elira! Porosia u regjistrua për t’u ndjekur nga ekipi.",
    result: "Porosi e regjistruar", detail: "Çantë bezhë · 2,500 Lekë", destination: "Porositë",
    mobile: "Një porosi e re për t’u ndjekur.",
  },
  {
    label: "Rezervime", icon: "calendar", business: "Studio Drita", channel: "WhatsApp",
    question: "A keni orar nesër për një prerje flokësh?",
    answer: "Orari 10:00 është i lirë. Prerja zgjat 30 minuta. Në cilin emër ta rezervoj?",
    reply: "Elira. Po, konfirmoj orarin 10:00.",
    finish: "Rezervimi u regjistrua për nesër, në orën 10:00. Të mirëpresim!",
    result: "Rezervim i regjistruar", detail: "Elira · Nesër, 10:00–10:30", destination: "Kalendari",
    mobile: "Një rezervim i ri në kalendar.",
  },
  {
    label: "Pyetje", icon: "knowledge", business: "Studio Drita", channel: "Instagram",
    question: "Ku ndodheni dhe deri në ç’orë jeni hapur?",
    answer: "Na gjeni në Rrugën e Dibrës, Tiranë. Nga e hëna në të shtunë jemi hapur 09:00–18:00.",
    reply: "Faleminderit! Për një kërkesë të veçantë mund të flas me dikë?",
    finish: "Sigurisht. Po ia kaloj kërkesën ekipit që të të ndihmojë më tej.",
    result: "Kërkon vëmendjen e ekipit", detail: "Elira · Kërkesë e veçantë", destination: "Bisedat",
    mobile: "Një bisedë ka nevojë për ty.",
  },
];

export function LandingHero() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return (
    <>
      <section className="lp-intro lp-container" aria-labelledby="landing-title">
        <div className="lp-intro-copy">
          <span className="lp-eyebrow"><Icon name="agents" size={15} /> Asistenti AI për biznesin tënd</span>
          <h1 id="landing-title">Kujdesu për biznesin.<br /><span>Agjenti kujdeset<br className="lp-intro-break" /> për bisedat.</span></h1>
          <p>Përgjigju pyetjeve të klientëve dhe ndihmo me porositë e rezervimet — me një asistent që përdor informacionin dhe udhëzimet e biznesit tënd.</p>
          <div className="lp-hero-actions">
            <Link className="lp-button" href="/login?mode=signup">Fillo tani <Icon name="arrow" size={17} /></Link>
            <a className="lp-button secondary" href="#shiko-agjentin">Shiko si funksionon <span aria-hidden="true">↗</span></a>
          </div>
          <div className="lp-channel-line"><span><Icon name="instagram" size={16} /> Instagram</span><span><Icon name="whatsapp" size={16} /> WhatsApp</span><span>Ti ruan kontrollin.</span></div>
        </div>
        <div className="lp-device-stage" id="mobile-web">
          <div className="lp-web-preview" role="img" aria-label="Pamje ilustruese e Agjentit në web: bisedat dhe puna e ekipit">
            <div className="lp-device-heading"><BrandLogo size={23} /><span>Web · Hapësira e ekipit</span></div>
            <div className="lp-web-body">
              <div className="lp-web-menu">{[["inbox", "Bisedat"], ["products", "Produktet"], ["calendar", "Kalendari"], ["knowledge", "Shërbimet"]].map(([icon, title]) => <span key={title}><Icon name={icon} size={15} />{title}</span>)}</div>
              <div className="lp-web-content"><small>BIZNESI YT, NË NJË VEND</small><h3>Puna vazhdon këtu.</h3><p>Bisedat, katalogët dhe shërbimet për ty dhe ekipin.</p><div className="lp-preview-record"><Icon name="inbox" /><span><strong>Elira</strong><small>Kërkesë e re nga klienti</small></span><span className="lp-status-dot" /></div><div className="lp-preview-record"><Icon name="calendar" /><span><strong>Kalendari</strong><small>Rezervimet dhe oraret e biznesit</small></span></div></div>
            </div>
          </div>
          <div className="lp-app-preview" role="img" aria-label="Pamje ilustruese e aplikacionit Agjenti: asistenti dhe përmbledhja e biznesit">
            <div className="lp-app-island" />
            <div className="lp-app-brand"><BrandLogo size={22} /><span>Aplikacioni mobile</span></div>
            <small>MIRË SE ERDHE</small><h3>Biznesi yt,<br />me vete.</h3>
            <div className="lp-app-summary"><Icon name="spark" size={21} /><strong>Çfarë kërkon vëmendjen tënde?</strong><p>Ndiq bisedat dhe punët e hapura nga telefoni.</p></div>
            <div className="lp-app-prompt">Më trego përmbledhjen e sotme <Icon name="arrow" size={15} /></div>
            <div className="lp-app-nav"><span><Icon name="spark" size={17} />Asistenti</span><span><Icon name="inbox" size={17} />Bisedat</span><span><Icon name="businesses" size={17} />Biznesi</span></div>
          </div>
          <p className="lp-devices-caption">Një biznes. Në telefon dhe në kompjuter.<small>Pamje ilustruese të produktit</small></p>
        </div>
      </section>
      <section className="lp-scenario lp-container" id="shiko-agjentin" aria-labelledby="scenario-title">
        <div className="lp-scenario-heading"><div><span className="lp-eyebrow">Nga biseda te veprimi</span><h2 id="scenario-title">Klientë të ndryshëm.<br />I njëjti kujdes.</h2></div><p>Nga pyetja e parë te hapi i radhës. Shih si mund të ndihmojë Agjenti në përditshmërinë e biznesit tënd.</p></div>
        <div className="lp-scenario-options" role="group" aria-label="Zgjidh shembullin">{examples.map((item, index) => <button key={item.label} type="button" aria-pressed={selected === index} aria-controls="landing-example" onClick={() => setSelected(index)}><Icon name={item.icon} size={18} />{item.label}</button>)}<span>Demonstrim ilustrues · të dhëna shembull</span></div>
        <div className="lp-scenario-grid" id="landing-example" aria-live="polite" aria-atomic="true">
          <div className="lp-example-chat"><div className="lp-example-header"><span className="lp-avatar rose">E</span><span><strong>Elira</strong><small>Klienti · {example.channel}</small></span><span className="lp-example-business">{example.business}</span></div><div className="lp-example-messages"><p>{example.question}</p><p className="agent"><small>Agjenti AI</small>{example.answer}</p><p>{example.reply}</p><p className="agent">{example.finish}</p></div></div>
          <div className="lp-example-outcome"><span className="lp-eyebrow">Në hapësirën e biznesit</span><h3>Biseda merr<br />hapin e radhës.</h3><div className="lp-outcome-card"><Icon name={example.icon} size={24} /><strong>{example.result}</strong><p>{example.detail}</p><small>Shfaqet te {example.destination}</small></div><div className="lp-outcome-mobile"><Icon name="spark" size={19} /><span><strong>Nga aplikacioni mobile</strong><small>{example.mobile}</small></span></div><p className="lp-outcome-note">Ti dhe ekipi mund ta ndiqni kërkesën dhe të merrni drejtimin e bisedës kur nevojitet.</p></div>
        </div>
      </section>
    </>
  );
}
