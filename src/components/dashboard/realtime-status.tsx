"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeChanges } from "@/lib/realtime/browser";
import { useDashboardTranslator } from "./language";
export function RealtimeStatus() {
  const [unavailable, setUnavailable] = useState(false);
  const router = useRouter();
  const t = useDashboardTranslator();
  useEffect(() => {
    const status = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      // Native CONNECTING/PAUSED are normal lifecycle states, not failures.
      setUnavailable(value === "CHANNEL_ERROR" || value === "TIMED_OUT" || value === "CLOSED");
    };
    window.addEventListener("agjenti:connection", status);
    const unsubscribe = subscribeChanges(["access", "business"], () => router.refresh());
    return () => { unsubscribe(); window.removeEventListener("agjenti:connection", status); };
  }, [router]);
  return unavailable ? <div role="status" className="panel section-pad mb-4">
    {t("Përditësimi automatik u ndërpre. Të dhënat mund të mos jenë të fundit.")}{" "}
    <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>{t("Rilidh")}</button>
  </div> : null;
}
