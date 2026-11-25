"use client";
import Image from "next/image";
import { useState } from "react";
import { Modal } from "@/components/modal/modal";

/** The customer's profile photo when stored, otherwise their initials. */
export function ParticipantAvatar({ name, src, size = 36, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  const [open, setOpen] = useState(false);
  const classes = `profile-avatar participant-avatar ${className}`;
  if (!show) return <span className={classes} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>;
  return (
    <>
      <button type="button" className={`${classes} participant-avatar-trigger`}
        aria-label={`Hap foton e profilit të ${name}`} aria-haspopup="dialog"
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
        <Image src={src} alt="" width={size} height={size} unoptimized onError={() => setFailed(src)} />
      </button>
      {open && <Modal title={name} subtitle="Foto e profilit" onClose={() => setOpen(false)} size="md" bodyClassName="participant-avatar-preview">
        <Image src={src} alt={`Foto e profilit të ${name}`} width={640} height={640} unoptimized
          onError={() => { setFailed(src); setOpen(false); }} />
      </Modal>}
    </>
  );
}
