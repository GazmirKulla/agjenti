"use client";
import Image from "next/image";
import { useState } from "react";

/** The customer's profile photo when stored, otherwise their initials. */
export function ParticipantAvatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <span className="profile-avatar participant-avatar" aria-hidden="true">
      {show ? (
        <Image src={src} alt="" width={size} height={size} unoptimized onError={() => setFailed(src)} />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
