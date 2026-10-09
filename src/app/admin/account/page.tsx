import { redirect } from "next/navigation";
import { AccountDetails } from "@/components/account/details";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

export default async function AdminAccountPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  return <AccountDetails />;
}
