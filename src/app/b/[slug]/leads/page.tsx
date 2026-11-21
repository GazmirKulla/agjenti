import { redirect } from "next/navigation";

/** Leads are a state of the conversation now: the old page opens Bisedat filtered to the interested ones. */
export default async function LeadsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const view = (await searchParams).view;
  redirect(`/b/${encodeURIComponent(slug)}/inbox?lead=${view === "waiting" ? "waiting" : view === "won" ? "won" : view === "lost" ? "lost" : "open"}`);
}
