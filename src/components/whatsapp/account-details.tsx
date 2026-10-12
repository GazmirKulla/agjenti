import { LocalizedStatusBadge } from "@/components/dashboard/language";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { IntegrationAccountPanel } from "@/components/dashboard/integration-account-panel";
import styles from "@/components/dashboard/integration-card.module.css";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { whatsappGraphVersion } from "@/lib/whatsapp/api";
export default async function WhatsAppAccountDetails({ params }: { params: Promise<{ slug: string }> }) {
  const t = await getDashboardTranslator();
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const { data: connection, error } = await createServiceSupabase().from("whatsapp_connections")
    .select("display_phone_number,verified_name,status,last_error").eq("business_id", access.business.id).maybeSingle();
  if (error) throw new Error(t("Nuk u ngarkua lidhja WhatsApp."));
  return <IntegrationAccountPanel name="WhatsApp" status={connection?.status ?? "disconnected"}>
    <div className={styles.accountIdentity}>
      <span className={`profile-avatar ${styles.accountAvatar}`} aria-hidden="true">{(connection?.verified_name || access.business.name).slice(0, 2).toUpperCase()}</span>
      <div>
        <h3>{connection?.status !== "disconnected" && connection ? connection.verified_name || access.business.name : t("Asnjë llogari e lidhur")}</h3>
        <p className="muted-copy">{connection?.status !== "disconnected" && connection ? connection.display_phone_number : access.business.name}</p>
      </div>
    </div>
    {connection && connection.status !== "disconnected" && <div className="detail-block">
      <dl className="detail-fields">
        <div><dt>{t("Statusi i lidhjes")}</dt><dd><LocalizedStatusBadge status={connection.status} /></dd></div>
        <div><dt>{t("Numri i telefonit")}</dt><dd>{connection.display_phone_number || "—"}</dd></div>
        <div><dt>{t("Emri i verifikuar")}</dt><dd>{connection.verified_name || "—"}</dd></div>
      </dl>
    </div>}
    {connection?.last_error && connection.status !== "disconnected" && <p className="mt-5 rounded-lg bg-danger-soft p-4 text-sm text-danger" role="alert">{connection.last_error}</p>}
    <WhatsAppConnect businessId={access.business.id} appId={process.env.META_APP_ID ?? ""} configId={process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? ""} version={whatsappGraphVersion()} connected={connection?.status === "connected"} />
    <p className="muted-copy mt-3">{t("Zgjidh llogarinë WhatsApp Business dhe numrin tënd në dritaren e Meta-s.")}</p>
  </IntegrationAccountPanel>;
}
