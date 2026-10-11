import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { whatsappGraphVersion } from "@/lib/whatsapp/api";
export default async function WhatsAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const { data: connection, error } = await createServiceSupabase().from("whatsapp_connections")
    .select("display_phone_number,verified_name,status,last_error").eq("business_id", access.business.id).maybeSingle();
  if (error) throw new Error("Nuk u ngarkua lidhja WhatsApp.");
  return <>
    <PageHeading title="WhatsApp" description="Lidh numrin e biznesit për të marrë mesazhe dhe për t’u përgjigjur nga Agjenti." />
    <div className="configuration-layout">
      <section className="panel section-pad">
        <div className="section-title"><h2>WhatsApp Business</h2><StatusBadge status={connection?.status ?? "disconnected"} /></div>
        {connection && <div className="detail-block"><h3>{connection.verified_name}</h3><p>{connection.display_phone_number}</p></div>}
        <p className="muted-copy">Zgjidh llogarinë WhatsApp Business dhe numrin tënd në dritaren e Meta-s.</p>
        <WhatsAppConnect businessId={access.business.id} appId={process.env.META_APP_ID ?? ""} configId={process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? ""} version={whatsappGraphVersion()} connected={connection?.status === "connected"} />
      </section>
      <aside className="panel section-pad"><h2>Mesazhet në të njëjtin Inbox</h2><p className="muted-copy">Mesazhet e reja shfaqen bashkë me Instagram-in. Përgjigjet automatike ndjekin cilësimet e biznesit dhe mund të ndalen nga stafi.</p><p className="muted-copy">Përgjigjet me tekst lejohen brenda 24 orëve nga mesazhi i klientit. Pas këtij afati, klienti duhet të shkruajë përsëri.</p><a className="soft-link" href={`/b/${slug}/inbox`}>Hap Inbox-in →</a></aside>
    </div>
  </>;
}
