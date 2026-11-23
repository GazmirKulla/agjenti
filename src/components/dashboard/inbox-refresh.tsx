"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribeChanges } from "@/lib/realtime/browser";

/** Inbox reads are driven by committed changes and reconnects, never a timer. */
export function InboxRefresh({ title, businessId, conversationId }: {
  title: string;
  businessId?: string;
  conversationId?: string | null;
  version?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => {
    const native = (window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } }).ReactNativeWebView;
    if (native) native.postMessage(JSON.stringify({ type: "chrome", title }));
  }, [title]);
  useEffect(() => subscribeChanges(["inbox"], () => {
    startTransition(() => router.refresh());
  }), [router, businessId, conversationId]);
  return null;
}
