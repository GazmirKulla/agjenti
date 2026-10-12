import { cookies } from "next/headers";
import { dashboardLanguage, LANGUAGE_COOKIE, translator } from "./core";

export async function getDashboardLanguage() {
  return dashboardLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
}
export async function getDashboardTranslator() {
  return translator(await getDashboardLanguage());
}
