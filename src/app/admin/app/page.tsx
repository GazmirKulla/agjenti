import { redirect } from "next/navigation";

/** The platform settings page moved to /admin/settings ("Cilësimet"). */
export default function LegacyAppSettingsPage() {
  redirect("/admin/settings");
}
