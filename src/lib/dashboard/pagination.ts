export const PAGE_SIZE = 25;
export function parseListParams(
  params: Record<string, string | string[] | undefined>,
) {
  const raw = typeof params.page === "string" ? params.page : "1";
  const page = /^\d+$/.test(raw)
    ? Math.min(100000, Math.max(1, Number(raw)))
    : 1;
  // Only literal search characters are allowed in PostgREST's filter grammar.
  const search = (typeof params.q === "string" ? params.q : "")
    .trim()
    .slice(0, 100);
  const filter = search
    .replace(/[^\p{L}\p{N}\s@._+-]/gu, "")
    .replace(/_/g, "\\_");
  return {
    page,
    search,
    filter,
    from: (page - 1) * PAGE_SIZE,
    to: page * PAGE_SIZE - 1,
  };
}
