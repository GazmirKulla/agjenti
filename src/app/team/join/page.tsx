import Link from "next/link";
import { getSessionUser } from "@/lib/tenant/access";
import { validInvitationToken } from "@/lib/actions/provision";
import { JoinTeamForm } from "./join-form";

export const metadata = { title: "Bashkohu me ekipin | Agjenti", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

/** An invitation to a business's team: sign in (or up) with the invited email, then accept. */
export default async function JoinTeamPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  if (!validInvitationToken(token)) return <main className="auth-content"><h1>Ftesa nuk është e vlefshme</h1><p>Kërko një lidhje të re nga pronari i biznesit.</p></main>;
  const next = `/team/join?token=${token}`;
  const user = await getSessionUser();
  if (!user) return <main className="auth-content"><div className="auth-card">
    <h1>Je ftuar në një ekip</h1>
    <p>Hyr ose regjistrohu me emailin ku të erdhi ftesa. Pastaj e pranon me një klik.</p>
    <Link className="auth-submit" href={`/login?mode=signup&next=${encodeURIComponent(next)}`}>Regjistrohu</Link>
    <p><Link href={`/login?next=${encodeURIComponent(next)}`}>Kam llogari →</Link></p>
  </div></main>;
  return <main className="auth-content"><div className="auth-card">
    <h1>Bashkohu me ekipin</h1>
    <p>Do të hysh në biznes si {user.email}. Ftesa pranohet vetëm nëse është për këtë email.</p>
    <JoinTeamForm token={token} />
  </div></main>;
}
