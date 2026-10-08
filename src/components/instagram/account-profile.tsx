import Image from "next/image";
import type { InstagramBusinessProfile } from "@/lib/instagram/business-profile";

export function InstagramAccountProfile({ profile, username, businessName }: {
  profile: InstagramBusinessProfile | null;
  username: string | null;
  businessName: string;
}) {
  const name = profile?.name || businessName;
  const handle = username || profile?.username;
  return (
    <div className="instagram-account-profile">
      <div className="flex items-center gap-4">
        <span className="profile-avatar instagram-account-avatar">
          {profile?.profile_picture_url ? (
            <Image src={profile.profile_picture_url} alt={`Foto e profilit ${name}`} width={72} height={72} unoptimized />
          ) : name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h3 className="text-xl wrap-anywhere">{username ? name : "Asnjë llogari e lidhur"}</h3>
          {handle && <a className="instagram-profile-handle" href={`https://www.instagram.com/${encodeURIComponent(handle)}/`} target="_blank" rel="noopener noreferrer">@{handle}</a>}
          {!handle && <p className="muted-copy">{businessName}</p>}
        </div>
      </div>
      {profile?.biography && <p className="instagram-profile-bio">{profile.biography}</p>}
      {profile?.website && (
        <a className="instagram-profile-website" href={profile.website} target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">↗</span>
          <span>{profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
        </a>
      )}
    </div>
  );
}
