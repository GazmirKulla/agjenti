import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidationTask } from "./invalidation";

/** A bounded server wait subscribes BEFORE its first read, with one final read
 * at the deadline. No timer queries the database while nothing changes.
 * Only service-role callers can join internal topics (no client RLS policy).
 */
export async function waitForStoredChange<T>(db: SupabaseClient, topic: string, until: number, read: () => Promise<T>, settled: (value: T) => boolean): Promise<T> {
  // Injectable database test doubles and unavailable transports still get an
  // authoritative read. Never turn missing realtime into polling.
  if (typeof db.channel !== "function" || until <= Date.now()) return read();
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let last: T;
    let hasLast = false;
    const channel = db.channel(topic, { config: { private: true } });
    const finish = (value: T) => {
      if (done) return; done = true; task.stop(); if (deadline) clearTimeout(deadline);
      void db.removeChannel(channel); resolve(value);
    };
    const fail = (error: unknown) => {
      if (done) return; done = true; task.stop(); if (deadline) clearTimeout(deadline);
      void db.removeChannel(channel); reject(error);
    };
    const task = invalidationTask(async () => {
      try { const value=await read(); last=value; hasLast=true; if (settled(value)) finish(value); }
      catch (error) { fail(error); }
    }, () => !done, 0);
    const deadline = setTimeout(() => { void read().then(finish, fail); }, Math.max(0, until-Date.now()));
    channel.on("broadcast", { event: "changed" }, () => task.invalidate()).subscribe(status => {
      if (status === "SUBSCRIBED") task.invalidate();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (hasLast) finish(last); else void read().then(finish, fail);
      }
    });
  });
}
