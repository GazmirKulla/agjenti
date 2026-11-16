"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** How often a visible Inbox asks whether anything changed (one light read). */
export const INBOX_CHECK_MS = 8000;
/** A full re-render at least this often, for panel details that are not in the fingerprint. */
export const INBOX_FULL_REFRESH_MS = 60_000;

/**
 * Keeps the Inbox current without re-rendering the whole page (and its layout) on a timer:
 * it compares a server fingerprint of what is shown and refreshes only when it changed.
 * Hidden tabs do nothing; returning to the tab checks at once.
 */
export function InboxRefresh({ title, businessId, conversationId, version }: {
  title: string;
  businessId?: string;
  conversationId?: string | null;
  /** Fingerprint of the page as rendered; null when the server could not compute it. */
  version?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const known = useRef<string | null>(version ?? null);
  const lastFull = useRef(Date.now());
  const checking = useRef(false);

  // A server render carries the fingerprint it was built from.
  useEffect(() => { known.current = version ?? null; lastFull.current = Date.now(); }, [version]);

  useEffect(() => {
    const native = (
      window as Window & {
        ReactNativeWebView?: { postMessage: (value: string) => void };
      }
    ).ReactNativeWebView;
    if (!native || !/AgjentiNative\/2\.0/.test(navigator.userAgent)) return;
    native.postMessage(JSON.stringify({ type: "chrome", title }));
  }, [title]);

  useEffect(() => {
    const refresh = () => startTransition(() => router.refresh());
    const check = async () => {
      if (document.visibilityState !== "visible" || pending || checking.current) return;
      if (!businessId || Date.now() - lastFull.current >= INBOX_FULL_REFRESH_MS) { lastFull.current = Date.now(); refresh(); return; }
      checking.current = true;
      try {
        const query = conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : "";
        const res = await fetch(`/api/businesses/${businessId}/inbox/version${query}`, { cache: "no-store" });
        if (!res.ok) return; // Try again on the next tick; never re-render on an error.
        const { version: current } = (await res.json()) as { version?: unknown };
        if (typeof current !== "string") return;
        if (known.current === null) { known.current = current; return; }
        if (current !== known.current) { known.current = current; refresh(); }
      } catch {
        // Offline or a transient failure: the next tick tries again.
      } finally {
        checking.current = false;
      }
    };
    const interval = window.setInterval(check, INBOX_CHECK_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, pending, businessId, conversationId]);
  return null;
}
