import { createServiceSupabase } from "@/lib/supabase/service";

/** Includes inactive items so a draft can be prepared before catalog activation. */
export async function loadFlowBindingCatalog(businessId: string) {
  const db = createServiceSupabase();
  async function list(table: "products" | "booking_services") {
    const rows: { id: string; name: string; is_active: boolean; booking_enabled?: boolean }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table)
        .select(table === "products" ? "id,name,is_active" : "id,name,is_active,booking_enabled")
        .eq("business_id", businessId).order("id").range(from, from + 999);
      if (error) {
        if (["42P01", "42703", "PGRST205", "PGRST204"].includes(error.code)) return [];
        throw new Error("Nuk u ngarkuan produktet dhe shërbimet për rrjedhën.");
      }
      const page = (data ?? []) as unknown as typeof rows;
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  const [products, services] = await Promise.all([list("products"), list("booking_services")]);
  return {
    products: products.map(row => ({ id: row.id, name: row.name, isActive: row.is_active })),
    services: services.map(row => ({ id: row.id, name: row.name, isActive: row.is_active, bookingEnabled: row.booking_enabled ?? false })),
  };
}
