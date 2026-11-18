"use client";
import Image from "next/image";
import { useState } from "react";
import type { SharedMedia } from "@/lib/instagram/shared-media";

/**
 * A story reply, story mention or shared post/reel: what it is, with a preview while the
 * channel's link still works. Instagram links expire; the label stays when the preview cannot load.
 * A public post/reel link is shown through Instagram's own embed page, which carries its caption.
 */
export function ChatMediaCard({ label, url, alt, media, openLabel }: {
  label: string; url: string | null; alt: string; media?: SharedMedia | null; openLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (media?.embedUrl && media.permalink) {
    return (
      <div className="chat-media-card">
        <small className="chat-media-card-label">{label}</small>
        <iframe src={media.embedUrl} title={alt} loading="lazy" className="chat-media-card-embed"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
        <a className="chat-media-card-open" href={media.permalink} target="_blank" rel="noopener noreferrer">{openLabel ?? "Instagram"}</a>
      </div>
    );
  }
  const source = media ? media.mediaUrl : url;
  const video = media?.type === "ig_reel" || media?.type === "reel";
  const preview = source && !failed;
  const body = (
    <>
      <small className="chat-media-card-label">{label}</small>
      {preview && (video ? (
        <video src={source} className="chat-media-card-preview" muted playsInline preload="metadata" onError={() => setFailed(true)} />
      ) : (
        <Image src={source} alt={alt} width={160} height={240} unoptimized referrerPolicy="no-referrer"
          className="chat-media-card-preview" onError={() => setFailed(true)} />
      ))}
      {media?.caption && <span className="chat-media-card-caption">{media.caption}</span>}
    </>
  );
  return source ? (
    <a className="chat-media-card" href={source} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className="chat-media-card">{body}</div>
  );
}
