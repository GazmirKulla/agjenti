"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { WhatsAppConnect } from "@/components/whatsapp/connect";
import { Icon } from "./icon";
import styles from "./integration-card.module.css";

type Props = {
  channel: "instagram" | "whatsapp";
  businessId: string;
  slug: string;
  status: string;
  identity?: string | null;
  loadError?: boolean;
  needsAttention?: boolean;
  whatsapp?: { appId: string; configId: string; version: string };
};

export function IntegrationCard({ channel, businessId, slug, status, identity, loadError, needsAttention, whatsapp }: Props) {
  const router = useRouter();
  const [disconnected, setDisconnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = channel === "instagram" ? "Instagram" : "WhatsApp";
  const connected = !disconnected && status === "connected";
  const reconnect = !disconnected && status !== "connected" && status !== "disconnected";

  // Instagram authorization happens in another tab; refresh when the user returns.
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [router]);

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/businesses/${businessId}/${channel}/disconnect`, {
        method: "POST", headers: { Accept: "application/json" },
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Shkëputja dështoi. Provo përsëri.");
      setDisconnected(true);
      router.refresh();
    } catch {
      setError("Shkëputja dështoi. Provo përsëri.");
    } finally {
      setBusy(false);
    }
  }

  return <article className={styles.row} aria-label={name} aria-busy={busy}>
    {connected && !loadError && <button type="button" className={styles.rowTrigger}
      aria-label={`Shiko të gjitha detajet e ${name}`} aria-haspopup="dialog"
      onClick={() => router.push(`/b/${slug}/integrations?detail=${channel}`, { scroll: false })} />}
    <div className={styles.heading}>
      <span className={`${styles.icon} ${connected && !loadError ? channel === "instagram" ? styles.instagramIcon : styles.whatsappIcon : styles.inactiveIcon}`}><Icon name={channel} size={28} /></span>
      <div className={styles.title}>
        <h2>{name}</h2>
        <p className={styles.identity}>{loadError ? "Provo përsëri për të parë gjendjen e lidhjes." : connected || reconnect ? identity || `Llogaria ${name}` : "Lidh llogarinë e biznesit"}</p>
        <p className={`${styles.status}${connected && !loadError ? ` ${styles.connected}` : ""}`} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          {loadError ? "Statusi nuk u ngarkua" : connected ? "E lidhur" : reconnect ? "Kërkon rilidhje" : "E palidhur"}
        </p>
      </div>
    </div>
    <div className={styles.actions}>
      {connected && !loadError && <>
        <button type="button" className={styles.disconnect} disabled={busy} onClick={disconnect}
          aria-label={`Shkëput ${name}`} aria-describedby={`${channel}-disconnect-help`}>{busy ? "Duke shkëputur…" : "Shkëput"}</button>
        <span id={`${channel}-disconnect-help`} className="sr-only">Shkëputja e llogarisë kërkon autorizim për ta rilidhur.</span>
      </>}
      {loadError ? <button type="button" className="btn btn-ghost" onClick={() => router.refresh()}>Provo përsëri</button> : !connected && (
        channel === "instagram" ? <a className="btn btn-primary" href={`/api/instagram/oauth/start?businessId=${businessId}`} target="_blank" rel="noopener noreferrer"><Icon name="plus" size={18} />{reconnect ? "Rilidh" : "Lidh"} Instagram</a>
          : whatsapp && <WhatsAppConnect businessId={businessId} {...whatsapp} connected={false} compact />
      )}
    </div>
    {needsAttention && !disconnected && !loadError && <p className={styles.notice}>{connected ? "Lidhja kërkon vëmendje. Shiko detajet." : "Lidhja kërkon vëmendje. Rilidhe llogarinë."}</p>}
    {busy && <p className={styles.notice} role="status">Duke shkëputur…</p>}
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
  </article>;
}
