import Link from "next/link";
import { getSessionUser } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { invitationHash, validInvitationToken } from "@/lib/actions/provision";
import { ActionForm } from "@/components/dashboard/action-form";
import { acceptInvitation } from "./actions";
import { signOut } from "@/lib/auth/actions";
import "../login/auth.css";
export const metadata = {
  title: "Prano ftesën | Agjenti",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request: token = "" } = await searchParams;
  if (!validInvitationToken(token))
    return (
      <main className="auth-content">
        <h1>Ftesa nuk është e vlefshme</h1>
        <p>Kërko një link të ri nga biznesi që të ftoi.</p>
      </main>
    );
  const user = await getSessionUser(),
    next = `/join?request=${token}`;
  if (!user)
    return (
      <main className="auth-content">
        <div className="auth-card">
          <h1>Biznesi yt të pret</h1>
          <p>
            Hyr ose regjistrohu me emailin ku është caktuar ftesa. Më pas mund
            të pranosh administrimin.
          </p>
          <Link
            className="auth-submit"
            href={`/login?mode=signup&next=${encodeURIComponent(next)}`}
          >
            Regjistrohu
          </Link>
          <p>
            <Link href={`/login?next=${encodeURIComponent(next)}`}>
              Kam llogari →
            </Link>
          </p>
        </div>
      </main>
    );
  const { data: i, error } = await createServiceSupabase()
    .from("business_invitations")
    .select("details,email,status,expires_at,accepted_by")
    .eq("token_hash", invitationHash(token))
    .maybeSingle();
  const recipient = i?.email === user.email?.toLowerCase();
  const usable =
    i &&
    recipient &&
    ((i.status === "pending" && new Date(i.expires_at) > new Date()) ||
      (i.status === "accepted" && i.accepted_by === user.id));
  return (
    <main className="auth-content">
      <div className="auth-card">
        <h1>
          {usable
            ? `Prano administrimin e ${i.details?.name ?? "biznesit"}`
            : "Ftesa nuk mund të pranohet"}
        </h1>
        {usable ? (
          <>
            <p>{i.details?.description}</p>
            <p>
              Po hyn si {user.email}. Me pranimin bëhesh pronar i këtij biznesi.
            </p>
            <ActionForm action={acceptInvitation}>
              <input type="hidden" name="request" value={token} />
              <button className="auth-submit">Prano dhe hap biznesin</button>
            </ActionForm>
          </>
        ) : (
          <p role="alert">
            {error
              ? "Ftesa nuk u ngarkua. Provo përsëri."
              : !recipient && i
                ? "Hyr me emailin për të cilin është krijuar ftesa."
                : "Linku ka skaduar, është anuluar ose është përdorur."}
          </p>
        )}
        <form action={signOut}>
          <button className="auth-text-button">Dil nga llogaria</button>
        </form>
      </div>
    </main>
  );
}
