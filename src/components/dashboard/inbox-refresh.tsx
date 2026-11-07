"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function InboxRefresh({ title }: { title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
    const refresh = () => {
      if (document.visibilityState === "visible" && !pending) {
        startTransition(() => router.refresh());
      }
    };
    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, pending]);
  return null;
}
