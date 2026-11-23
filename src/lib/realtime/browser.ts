"use client";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { invalidationTask, parseChange, matchesChange, type Change, type Resource } from "./invalidation";

type Listener = (change: Change | null) => void;
const listeners = new Set<Listener>();
let stopConnection: (() => void) | undefined;
const emit = (change: Change | null) => { for (const listener of listeners) listener(change); };

declare global {
  interface Window { __agjentiNativeRealtime?: boolean; }
}

function connect() {
  const visible = () => { if (!document.hidden) emit(null); };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("online", visible);
  // The native shell owns the socket. Only hints cross the bridge, never credentials.
  if (window.__agjentiNativeRealtime || /AgjentiRealtime\/1\.0/.test(navigator.userAgent)) {
    const receive = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (detail === null) emit(null);
      else { const change = parseChange(detail); if (change) emit(change); }
    };
    window.addEventListener("agjenti:realtime", receive);
    const bridge = (window as Window & { ReactNativeWebView?: { postMessage: (data: string) => void } }).ReactNativeWebView;
    bridge?.postMessage(JSON.stringify({ type: "realtime_ready" }));
    return () => { window.removeEventListener("agjenti:realtime", receive); document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", visible); };
  }
  const client = createBrowserSupabase();
  let channel: ReturnType<typeof client.channel> | undefined;
  let userId: string | undefined;
  let disposed = false;
  let generation = 0;
  function session(session: { user: { id: string }; access_token: string } | null) {
    const id = session?.user.id;
    if (id === userId && channel) {
      if (session) void client.realtime.setAuth(session.access_token).catch(() => { if (!disposed) window.dispatchEvent(new CustomEvent("agjenti:connection", { detail: "CHANNEL_ERROR" })); });
      return;
    }
    generation++;
    const current = generation;
    if (channel) void client.removeChannel(channel);
    channel = undefined; userId = id;
    if (!session || disposed) return;
    void client.realtime.setAuth(session.access_token).then(() => {
      if (disposed || current !== generation) return;
      channel = client.channel(`updates:${id}`, { config: { private: true } })
        .on("broadcast", { event: "changed" }, ({ payload }) => {
          if (current !== generation) return;
          const change = parseChange(payload); if (change) emit(change);
        }).subscribe(status => {
          if (current !== generation) return;
          window.dispatchEvent(new CustomEvent("agjenti:connection", { detail: status }));
          // Subscribe first, then read: covers changes during initial loading and a disconnect.
          if (status === "SUBSCRIBED") emit(null);
        });
    }).catch(() => { if (!disposed && current === generation) window.dispatchEvent(new CustomEvent("agjenti:connection", { detail: "CHANNEL_ERROR" })); });
  }
  const { data } = client.auth.onAuthStateChange((_event, value) => session(value));
  return () => { disposed = true; generation++; data.subscription.unsubscribe(); if (channel) void client.removeChannel(channel); document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", visible); };
}

/** Shared socket per browser tab; each consumer reads only its own authorized API. */
export function subscribeChanges(wanted: readonly Resource[], read: () => void | Promise<void>, initial = false, slug?: string) {
  const task = invalidationTask(read, () => !document.hidden);
  const listener: Listener = change => {
    const path = window.location?.pathname.split("/");
    const routeSlug = path?.[1] === "b" ? decodeURIComponent(path[2] ?? "") : undefined;
    if (matchesChange(change, wanted, slug ?? routeSlug)) task.invalidate();
  };
  listeners.add(listener);
  if (!stopConnection) stopConnection = connect();
  if (initial) task.invalidate();
  return () => { task.stop(); listeners.delete(listener); if (!listeners.size) { stopConnection?.(); stopConnection = undefined; } };
}
