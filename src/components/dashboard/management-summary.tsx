import Link from "next/link";
import type { ManagementSummary as Summary } from "@/lib/dashboard/management-summary";
import type { ModuleId } from "@/lib/dashboard/modules/types";
import s from "./management.module.css";

export function ManagementSummary({ base, modules, summary }: { base: string; modules: readonly ModuleId[]; summary: Summary }) {
  return <div className={s.summary}>
    {modules.includes("orders") && <section className={s.panel} aria-labelledby="management-orders">
      <div className={s.heading}><h2 id="management-orders">Porositë që kërkojnë vëmendje</h2><Link href={`${base}/orders`}>Shiko porositë →</Link></div>
      {summary.orders ? <div className={s.counts}>
        <div><strong>{summary.orders.confirmed}</strong><span>Të konfirmuara, ende të papërcjella</span></div>
        <div><strong>{summary.orders.review}</strong><span>Të dështuara ose për verifikim</span></div>
      </div> : <p role="status" className="muted-copy">Porositë nuk u ngarkuan. Hape listën për të riprovuar.</p>}
    </section>}
    {modules.includes("bookings") && <section className={s.panel} aria-labelledby="management-bookings">
      <div className={s.heading}><h2 id="management-bookings">Rezervimet e ardhshme</h2><Link href={`${base}/bookings`}>Shiko rezervimet →</Link></div>
      {!summary.bookings ? <p role="status" className="muted-copy">Rezervimet nuk u ngarkuan. Hape listën për të riprovuar.</p> : <>
        <p className={s.note}>Deri në 5 rezervimet e radhës · {summary.bookings.timezone}</p>
        {summary.bookings.items.length ? <ul className={s.bookings}>{summary.bookings.items.map(booking => <li key={booking.id}>
          <Link href={`${base}/bookings?date=${booking.date}`}>
            <span><strong>{booking.customer_name}</strong><small>{booking.service_name} · {booking.status === "pending" ? "Në pritje" : "E konfirmuar"}</small></span>
            <time dateTime={booking.starts_at}>{booking.time}</time>
          </Link>
        </li>)}</ul> : <p className="muted-copy">Nuk ka rezervime të ardhshme. Mund të shtosh një nga faqja e rezervimeve.</p>}
      </>}
    </section>}
  </div>;
}
