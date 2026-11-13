import Link from "next/link";
import type { ConversationContext } from "@/lib/conversations/context";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { BookingForm, CopyInvitationLink, LeadStatusControl, ManualOrderForm, SaveCustomerForm } from "./conversation-panel-controls";
import { formatDate, money } from "./ui";

/** Inbox side panel: what the business already knows about this conversation. */
export async function ConversationPanel({ context, businessId, slug }: { context: ConversationContext; businessId: string; slug: string }) {
  const t = await getDashboardTranslator();
  const locale = t("sq-AL");
  const { conversation, customer, profile } = context;
  const when = (value: string) =>
    new Date(value).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" });
  const collected = [
    [t("Emri"), profile.name],
    [t("Telefoni"), profile.phone],
    [t("Email"), profile.email],
    [t("Qyteti"), profile.city],
    [t("Adresa"), profile.address],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <>
      <section className="panel section-pad">
        <h2 className="text-base mb-5">{customer.linked ? t("Informacioni i klientit") : t("Pjesëmarrësi i bisedës")}</h2>
        <div className="flex items-center gap-3 mb-6">
          <span className="profile-avatar">{conversation.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <h3>{conversation.name}</h3>
            <p className="muted-copy">{conversation.handle}</p>
          </div>
        </div>
        {context.handoffRequested && <p className="conversation-flag" role="status">{t("Klienti kërkoi të flasë me një person.")}</p>}
        {customer.linked ? (
          <dl className="detail-fields">
            <div><dt>{t("Emri")}</dt><dd>{customer.name || "—"}</dd></div>
            <div><dt>{t("Telefoni")}</dt><dd>{customer.phone || profile.phone || "—"}</dd></div>
            <div><dt>{t("Klient që nga")}</dt><dd>{formatDate(customer.since, locale)}</dd></div>
          </dl>
        ) : (
          <>
            <p className="muted-copy mb-3">{t("Ende jo klient CRM. Të dhënat më poshtë janë marrë nga biseda; kontrolloji para se ta ruash.")}</p>
            <SaveCustomerForm businessId={businessId} conversationId={conversation.id} name={profile.name ?? ""} phone={profile.phone ?? ""} />
          </>
        )}
      </section>

      {(collected.length > 0 || context.processes.length > 0) && (
        <section className="panel section-pad">
          <h2 className="text-base mb-4">{t("Çfarë mblodhi agjenti")}</h2>
          {collected.length > 0 && (
            <dl className="detail-fields mb-4">
              {collected.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          )}
          {context.processes.map((process) => (
            <div key={process.id} className="conversation-process">
              <div className="conversation-process-head">
                <strong>{process.name}</strong>
                <span className="muted-copy">{t(process.statusLabel)}</span>
              </div>
              {process.fields.length > 0 && (
                <dl className="detail-fields">
                  {process.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
                </dl>
              )}
              {process.missing.length > 0 && <p className="muted-copy">{t("Mungon")}: {process.missing.join(", ")}</p>}
            </div>
          ))}
        </section>
      )}

      <section className="panel section-pad">
        <h2 className="text-base mb-4">{t("Porositë")}</h2>
        {context.pendingOrder && (
          <p className="conversation-flag" role="status">
            {t("Një porosi pret konfirmimin tënd")} ({context.pendingOrder.process}). {t("Konfirmoje nga menuja e bisedës.")}
          </p>
        )}
        {context.orders.length ? (
          context.orders.map((order) => (
            <Link className="customer-order" key={order.id} href={`/b/${slug}/orders`}>
              <div><strong>#{order.id.slice(0, 8)}</strong><span className="muted-copy">{t(order.statusLabel)}</span></div>
              <p>{formatDate(order.createdAt, locale)}<strong>{money(order.total, order.currency ?? undefined)}</strong></p>
            </Link>
          ))
        ) : (
          <p className="muted-copy">{t("Nuk ka porosi për këtë bisedë.")}</p>
        )}
        {context.forms.order.enabled && (
          <ManualOrderForm
            businessId={businessId}
            conversationId={conversation.id}
            productId={context.forms.order.productId}
            productName={context.forms.order.productName}
            quantity={context.forms.order.quantity}
            customer={{
              name: customer.name ?? profile.name ?? "",
              phone: customer.phone ?? profile.phone ?? "",
              city: profile.city ?? "",
              address: profile.address ?? "",
            }}
          />
        )}
      </section>

      {(context.bookings.length > 0 || (context.forms.booking.enabled && context.forms.booking.services.length > 0)) && (
        <section className="panel section-pad">
          <h2 className="text-base mb-4">{t("Takimet")}</h2>
          {context.bookings.map((booking) => (
            <Link className="customer-order" key={booking.id} href={`/b/${slug}/bookings`}>
              <div><strong>{booking.service}</strong><span className="muted-copy">{t(booking.statusLabel)}</span></div>
              <p>{when(booking.startsAt)}</p>
            </Link>
          ))}
          {!context.bookings.length && <p className="muted-copy">{t("Nuk ka takime për këtë bisedë.")}</p>}
          {context.forms.booking.enabled && context.forms.booking.services.length > 0 && (
            <BookingForm
              businessId={businessId}
              conversationId={conversation.id}
              services={context.forms.booking.services}
              serviceId={context.forms.booking.serviceId}
              date={context.forms.booking.date}
              time={context.forms.booking.time}
              name={customer.name ?? profile.name ?? ""}
              contact={customer.phone ?? profile.phone ?? ""}
            />
          )}
        </section>
      )}

      {context.lead && (
        <section className="panel section-pad">
          <h2 className="text-base mb-4">{t("Kontakti")}</h2>
          {context.lead.interest && <p className="muted-copy mb-3">{context.lead.interest}</p>}
          <LeadStatusControl businessId={businessId} conversationId={conversation.id} leadId={context.lead.id} status={context.lead.status} />
        </section>
      )}

      {(context.invitation || context.prospectScans.length > 0) && (
        <section className="panel section-pad">
          <h2 className="text-base mb-4">{t("Ftesa për biznesin")}</h2>
          {context.invitation ? (
            <>
              <dl className="detail-fields">
                <div><dt>{t("Statusi")}</dt><dd>{t(context.invitation.statusLabel)}</dd></div>
                {context.invitation.businessName && <div><dt>{t("Biznesi")}</dt><dd>{context.invitation.businessName}</dd></div>}
                <div><dt>{t("Email")}</dt><dd>{context.invitation.email}</dd></div>
                {context.invitation.instagram && <div><dt>Instagram</dt><dd>@{context.invitation.instagram}</dd></div>}
                <div><dt>{t("Dërguar")}</dt><dd>{when(context.invitation.createdAt)}</dd></div>
                <div>
                  <dt>{context.invitation.acceptedAt ? t("Pranuar") : t("Skadon")}</dt>
                  <dd>{when(context.invitation.acceptedAt ?? context.invitation.expiresAt)}</dd>
                </div>
              </dl>
              {context.invitation.description && <p className="muted-copy mt-3">{context.invitation.description}</p>}
              {context.invitation.url && <CopyInvitationLink url={context.invitation.url} />}
            </>
          ) : (
            <p className="muted-copy">{t("Ende nuk është dërguar ftesë.")}</p>
          )}
          {context.prospectScans.map((scan) => (
            <p key={scan.username} className="muted-copy mt-3">
              {t("Instagram-i i lexuar")}: @{scan.username} · {t(scan.statusLabel)}
              {scan.posts ? ` · ${scan.posts} ${t("postime")}` : ""}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
