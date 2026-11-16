"use client";
import Image from "next/image";
import { useState } from "react";

/**
 * A story reply, story mention or shared post/reel: what it is, with a preview while the
 * channel's link still works. Instagram links expire; the label stays when the preview cannot load.
 */
export function ChatMediaCard({ label, url, alt }: { label: string; url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const preview = url && !failed;
  const body = (
    <>
      <small className="chat-media-card-label">{label}</small>
      {preview && (
        <Image src={url} alt={alt} width={160} height={240} unoptimized referrerPolicy="no-referrer"
          className="chat-media-card-preview" onError={() => setFailed(true)} />
      )}
    </>
  );
  return url ? (
    <a className="chat-media-card" href={url} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className="chat-media-card">{body}</div>
  );
}
