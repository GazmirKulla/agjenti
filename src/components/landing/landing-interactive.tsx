"use client";
import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "@/components/dashboard/icon";
export function LandingHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="lp-header">
      <a className="lp-logo" href="#">
        <BrandLogo size={36} priority />
      </a>
      <nav
        className={open ? "lp-navigation open" : "lp-navigation"}
        aria-label="Navigimi kryesor"
      >
        {[
          ["#", "Kryefaqja"],
          ["#si-funksionon", "Si funksionon"],
          ["#bizneset", "Për kë është"],
          ["#pyetje", "Pyetje të shpeshta"],
        ].map(([href, label]) => (
          <a href={href} key={label} onClick={() => setOpen(false)}>
            {label}
          </a>
        ))}
      </nav>
      <div className="lp-header-actions">
        <Link className="lp-signin" href="/login">
          Hyr
        </Link>
        <Link className="lp-button small" href="/login?mode=signup">
          Fillo tani <Icon name="arrow" size={16} />
        </Link>
        <button
          className="lp-menu"
          type="button"
          aria-label={open ? "Mbyll menunë" : "Hap menunë"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            "×"
          ) : (
            <span>
              <i />
              <i />
              <i />
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
const people = [
  {
    name: "elira.m",
    initials: "EM",
    message: "Sa kushton puzzle A3?",
    reply:
      "Përshëndetje! 😊 Puzzle A3 kushton 2,500 Lekë. Mund ta personalizojmë me foton dhe tekstin tënd.",
    color: "rose",
    status: "Në proces",
  },
  {
    name: "arbër.k",
    initials: "AK",
    message: "A mund ta personalizoj me foto?",
    reply:
      "Po, sigurisht! Dërgo foton që dëshiron dhe të ndihmojmë me hapat e porosisë. 💜",
    color: "blue",
    status: "Në proces",
  },
  {
    name: "linda.s",
    initials: "LS",
    message: "Dua të porosis një bluzë.",
    reply: "Me kënaqësi! Çfarë madhësie dhe ngjyre dëshiron për bluzën?",
    color: "peach",
    status: "E re",
  },
  {
    name: "besir.al",
    initials: "BA",
    message: "Faleminderit shumë!",
    reply: "Faleminderit ty! Na shkruaj kur të të duhet ndihmë. 😊",
    color: "mint",
    status: "E mbyllur",
  },
];
export function DemoInbox({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("all");
  const current = people[selected];
  const visible = people
    .map((p, i) => ({ ...p, index: i }))
    .filter(
      (p) =>
        filter === "all" ||
        (filter === "new" ? p.status === "E re" : p.status === "Në proces"),
    );
  return (
    <div className={`lp-inbox-demo ${compact ? "compact" : ""}`}>
      <div className="lp-demo-top">
        <span className="lp-logo mini">
          <BrandLogo size={24} />
        </span>
        <span className="lp-demo-label">Pamje ilustruese</span>
        <Icon name="search" size={15} />
      </div>
      <div className="lp-demo-columns">
        <div className="lp-demo-list">
          <div className="lp-demo-tabs">
            {[
              ["all", "Të gjitha"],
              ["new", "Të reja"],
              ["active", "Në proces"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  if (value === "new") setSelected(2);
                  if (value === "active") setSelected(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {visible.map((p) => (
            <button
              type="button"
              key={p.name}
              className={`lp-person ${selected === p.index ? "selected" : ""}`}
              onClick={() => setSelected(p.index)}
              aria-pressed={selected === p.index}
            >
              <span className={`lp-avatar ${p.color}`}>{p.initials}</span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.message}</small>
              </span>
              <span
                className={`lp-mini-status ${p.status === "E mbyllur" ? "done" : ""}`}
              >
                {p.status}
              </span>
            </button>
          ))}
        </div>
        <div className="lp-demo-thread">
          <div className="lp-contact">
            <span className={`lp-avatar ${current.color}`}>
              {current.initials}
            </span>
            <span>
              <strong>{current.name}</strong>
              <small>Instagram</small>
            </span>
            <Icon name="instagram" size={17} />
          </div>
          <div className="lp-demo-chat">
            <span className="lp-chat-time">Sot, 10:24</span>
            <p className="lp-bubble">{current.message}</p>
            <p className="lp-bubble ai">{current.reply}</p>
            {selected === 0 && (
              <div className="lp-chat-product">
                <span className="lp-puzzle-art">♡</span>
                <span>
                  <strong>Puzzle A3</strong>
                  <small>2,500 Lekë</small>
                </span>
              </div>
            )}
            <p className="lp-bubble">Po, dua të porosis. Si funksionon?</p>
          </div>
          <div className="lp-demo-compose">
            Shkruaj një mesazh… <Icon name="arrow" size={16} />
          </div>
        </div>
      </div>
    </div>
  );
}
export function ProductDemo() {
  const [size, setSize] = useState("A3");
  return (
    <div className="lp-product-demo">
      <div className="lp-product-card">
        <div className="lp-product-head">
          <span className="lp-puzzle-art large">♡</span>
          <span>
            <strong>Puzzle i personalizuar</strong>
            <small>{size === "A3" ? "2,500" : "1,800"} Lekë</small>
          </span>
        </div>
        <div className="lp-size-select">
          <span>Madhësia</span>
          {["A4", "A3"].map((s) => (
            <button
              type="button"
              key={s}
              aria-pressed={size === s}
              onClick={() => setSize(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="lp-product-field">
          <span>Foto e klientit</span>
          <span className="lp-file-chip">
            <Icon name="products" size={15} />
            Foto e marrë ✓
          </span>
        </div>
        <div className="lp-product-field">
          <span>Teksti</span>
          <span className="lp-fake-input">Për gjithmonë ♡</span>
        </div>
        <p className="lp-example-note">Shembull produkti</p>
      </div>
      <span className="lp-flow-connector">
        ••• <Icon name="spark" size={17} />
      </span>
      <div className="lp-checklist">
        <strong>Agjenti mbledh:</strong>
        {[
          "Foton",
          "Madhësinë",
          "Tekstin",
          "Të dhënat e klientit",
          "Konfirmimin e porosisë",
        ].map((x) => (
          <p key={x}>
            <span>✓</span>
            {x}
          </p>
        ))}
      </div>
    </div>
  );
}
