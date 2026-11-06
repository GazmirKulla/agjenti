import { cookies, headers } from "next/headers";

export const NATIVE_EMBED_COOKIE = "agjenti_native";
export const NATIVE_USER_AGENT = /AgjentiNative\/2\.0/;

/**
 * Layout hint only: hides web navigation inside the app, never grants access.
 * The cookie covers the app's browser preview iframe; cookies are shared across
 * localhost ports, so it must never apply to a top-level browser tab.
 */
export async function isNativeEmbed() {
  const [jar, request] = await Promise.all([cookies(), headers()]);
  if (NATIVE_USER_AGENT.test(request.get("user-agent") ?? "")) return true;
  return jar.get(NATIVE_EMBED_COOKIE)?.value === "1" && request.get("sec-fetch-dest") === "iframe";
}
