import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), channel: vi.fn(), remove: vi.fn(), setAuth: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ auth: { onAuthStateChange: m.auth }, channel: m.channel, removeChannel: m.remove, realtime: { setAuth: m.setAuth } }) }));
let auth: (event: string, value: unknown) => void;
let changes: ((event: { payload: unknown }) => void)[];
let statuses: ((status: string) => void)[];
let stops: (() => void)[];
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); stops=[]; changes=[]; statuses=[];
  vi.stubGlobal("navigator", { userAgent: "browser" });
  vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  m.auth.mockImplementation(callback => { auth=callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
  m.channel.mockImplementation(() => {
    const channel = { on: (_kind: string, _filter: unknown, callback: typeof changes[number]) => { changes.push(callback); return channel; }, subscribe: (callback: typeof statuses[number]) => { statuses.push(callback); return channel; } };
    return channel;
  });
});
afterEach(() => { for (const stop of stops) stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const session = (id: string) => ({ user: { id }, access_token: `token-${id}` });
it("shares one channel, reads after subscription and reconnect, and is silent for ten idle minutes", async () => {
  const { subscribeChanges }=await import("./browser");
  const inbox=vi.fn(async()=>{}), reactions=vi.fn(async()=>{});
  stops.push(subscribeChanges(["inbox"],inbox),subscribeChanges(["reactions"],reactions));
  auth("INITIAL_SESSION",session("one")); await vi.advanceTimersByTimeAsync(0);
  expect(m.channel).toHaveBeenCalledTimes(1); statuses[0]("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(100);
  expect(inbox).toHaveBeenCalledTimes(1); expect(reactions).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600_000); expect(inbox).toHaveBeenCalledTimes(1);
  changes[0]({payload:{resource:"inbox"}}); await vi.advanceTimersByTimeAsync(100);
  expect(inbox).toHaveBeenCalledTimes(2); expect(reactions).toHaveBeenCalledTimes(1);
  statuses[0]("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(100); expect(reactions).toHaveBeenCalledTimes(2);
});
it("rejects stale events after an account switch and unknown event types",async()=>{
  const {subscribeChanges}=await import("./browser"); const read=vi.fn(async()=>{});
  stops.push(subscribeChanges(["inbox"],read)); auth("INITIAL_SESSION",session("one")); await vi.advanceTimersByTimeAsync(0);
  auth("SIGNED_IN",session("two")); await vi.advanceTimersByTimeAsync(0);
  changes[0]({payload:{resource:"inbox"}}); changes[1]({payload:{resource:"run_action"}});
  await vi.advanceTimersByTimeAsync(100); expect(read).not.toHaveBeenCalled(); expect(m.remove).toHaveBeenCalledTimes(1);
  changes[1]({payload:{resource:"inbox"}}); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(1);
});
it("uses the native bridge without opening another socket",async()=>{
  window.__agjentiNativeRealtime=true;
  const {subscribeChanges}=await import("./browser"); const read=vi.fn(async()=>{});
  stops.push(subscribeChanges(["inbox"],read));
  window.dispatchEvent(new CustomEvent("agjenti:realtime",{detail:{resource:"inbox"}}));
  await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(1); expect(m.channel).not.toHaveBeenCalled();
});

it("recognizes the native user agent before early script injection and requests a snapshot", async () => {
  vi.stubGlobal("navigator", { userAgent: "AgjentiNative/2.0 AgjentiRealtime/1.0" });
  const postMessage = vi.fn();
  Object.assign(window, { ReactNativeWebView: { postMessage } });
  const { subscribeChanges } = await import("./browser");
  stops.push(subscribeChanges(["inbox"], vi.fn()));
  expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "realtime_ready" }));
  expect(m.auth).not.toHaveBeenCalled();
});
