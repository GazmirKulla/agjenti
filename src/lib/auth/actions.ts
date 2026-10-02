"use server";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
export async function signOut() {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Dalja nuk u krye. Provo përsëri.");
  redirect("/login");
}
