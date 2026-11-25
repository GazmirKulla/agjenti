"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** The Agjenti topics an editor can be opened from; anything else in ?nga= is ignored. */
const topics: Record<string, string> = {
  "agents/business": "Biznesi", knowledge: "Oferta", "agents/orders": "Porositë", "agents/bookings": "Rezervimet", agents: "Komunikimi", "agents/test": "Prova dhe kontrolli",
};
/**
 * Opened from a topic (?nga=agents/bookings), an editor shows the way back to it. The editor stays the one
 * authoritative place for its data; the topic only links to it.
 */
export function TopicReturn({ base }: { base: string }) {
  const from = useSearchParams().get("nga") ?? "";
  if (!Object.hasOwn(topics, from)) return null;
  return <p className="topic-return"><Link href={`${base}/${from}`}>← Kthehu te Agjenti → {topics[from]}</Link></p>;
}
