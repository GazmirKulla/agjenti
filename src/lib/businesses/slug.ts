type SlugQuery = {
  select: (columns: string) => {
    or: (filter: string) => PromiseLike<{ data: { slug: string }[] | null }>;
  };
};

/** Kthen slug të pastër nga emri i biznesit, ose null nëse nuk mbetet asgjë. */
export function slugifyBusinessName(name: string): string | null {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

/**
 * Zgjedh slug të lirë: baza, pastaj baza-2, baza-3, …
 * `db.from("businesses")` duhet të kthejë query me select/or.
 */
export async function allocateUniqueBusinessSlug(
  db: { from: (table: "businesses") => unknown },
  base: string,
): Promise<string> {
  const query = db.from("businesses") as SlugQuery;
  const { data } = await query
    .select("slug")
    .or(`slug.eq.${base},slug.like.${base}-%`);
  const taken = new Set((data ?? []).map((row) => row.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
