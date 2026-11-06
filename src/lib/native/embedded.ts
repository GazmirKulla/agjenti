import { cookies, headers } from "next/headers";

export const NATIVE_EMBED_COOKIE = "agjenti_native";
export const NATIVE_USER_AGENT = /AgjentiNative\/2\.0/;

/** Layout hint only: hides web navigation inside the app, never grants access. */
export async function isNativeEmbed() {
  const [jar, request] = await Promise.all([cookies(), headers()]);
  return jar.get(NATIVE_EMBED_COOKIE)?.value === "1" || NATIVE_USER_AGENT.test(request.get("user-agent") ?? "");
}
